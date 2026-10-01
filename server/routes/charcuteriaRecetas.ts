import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { validarUsuarioActivo } from "../lib/rolesCharcuteria";
import type { Prisma } from "@prisma/client";

export const charcuteriaRecetasRouter = Router();

const recetaConIncludes = {
  ingredientes: { include: { item: true } },
  productoElaborado: true,
} satisfies Prisma.RecetaInclude;

charcuteriaRecetasRouter.get("/", async (req, res) => {
  const productoElaboradoId = req.query.productoElaboradoId ? Number(req.query.productoElaboradoId) : undefined;
  const soloActivas = req.query.soloActivas === "true";
  const recetas = await prisma.receta.findMany({
    where: {
      ...(productoElaboradoId ? { productoElaboradoId } : {}),
      ...(soloActivas ? { activa: true } : {}),
    },
    include: recetaConIncludes,
    orderBy: [{ productoElaboradoId: "asc" }, { version: "desc" }],
  });
  res.json(recetas);
});

charcuteriaRecetasRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const receta = await prisma.receta.findUnique({ where: { id }, include: recetaConIncludes });
  if (!receta) return res.status(404).json({ error: "Receta no encontrada" });
  res.json(receta);
});

const ingredienteSchema = z.object({
  itemId: z.number().int().positive(),
  cantidadPorLoteBase: z.number().positive("La cantidad debe ser mayor a 0"),
  unidad: z.enum(["gramos", "unidad"]),
});

// Crea SIEMPRE una versión nueva — no hay edición de una receta existente
// (ni siquiera la activa) para que "de qué versión salió cada lote" nunca
// quede ambiguo. Para "corregir" una receta, se crea una versión nueva con
// el ajuste; la anterior queda de solo lectura.
const crearRecetaSchema = z.object({
  usuarioId: z.number().int().positive(),
  productoElaboradoId: z.number().int().positive(),
  rendimientoEsperadoPct: z.number().positive().max(100, "El rendimiento esperado no puede superar 100%"),
  dosisSalesCurantesPorKg: z.number().positive().optional().nullable(),
  parametrosProceso: z.string().trim().optional().nullable(),
  notas: z.string().trim().optional().nullable(),
  ingredientes: z.array(ingredienteSchema).min(1, "La receta necesita al menos un ingrediente"),
});

charcuteriaRecetasRouter.post("/", async (req, res) => {
  const parsed = crearRecetaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const productoElaborado = await prisma.itemCharcuteria.findUnique({ where: { id: data.productoElaboradoId } });
  if (!productoElaborado || productoElaborado.tipoItem !== "producto_elaborado") {
    return res.status(400).json({ error: "El producto elaborado indicado no existe o no es del tipo correcto" });
  }

  for (const ing of data.ingredientes) {
    const item = await prisma.itemCharcuteria.findUnique({ where: { id: ing.itemId } });
    if (!item) return res.status(400).json({ error: `El ingrediente con id ${ing.itemId} no existe` });
  }

  const receta = await prisma.$transaction(async (tx) => {
    const ultima = await tx.receta.findFirst({
      where: { productoElaboradoId: data.productoElaboradoId },
      orderBy: { version: "desc" },
    });
    const versionNueva = (ultima?.version ?? 0) + 1;

    // Desactiva cualquier versión previa antes de crear la nueva — nunca
    // conviven dos activas para el mismo producto elaborado.
    await tx.receta.updateMany({
      where: { productoElaboradoId: data.productoElaboradoId, activa: true },
      data: { activa: false },
    });

    return tx.receta.create({
      data: {
        productoElaboradoId: data.productoElaboradoId,
        version: versionNueva,
        activa: true,
        rendimientoEsperadoPct: data.rendimientoEsperadoPct,
        dosisSalesCurantesPorKg: data.dosisSalesCurantesPorKg ?? null,
        parametrosProceso: data.parametrosProceso ?? null,
        notas: data.notas ?? null,
        creadoPorId: data.usuarioId,
        ingredientes: {
          create: data.ingredientes.map((ing) => ({
            itemId: ing.itemId,
            cantidadPorLoteBase: ing.cantidadPorLoteBase,
            unidad: ing.unidad,
          })),
        },
      },
      include: recetaConIncludes,
    });
  });

  res.status(201).json(receta);
});

// --- Importar recetas desde el programa anterior ---
//
// Formato propio del programa viejo ("La Gran Carnicería · Programa de
// Recetas"): un objeto "recetas" con una entrada por fórmula. Solo se trae
// eso — el array "pruebas" (bitácora de pruebas con fecha/calificación/
// notas) se deja afuera a propósito: no son lotes de producción reales, y
// el sistema actual no tiene un lugar para guardar ese tipo de bitácora
// sin mezclarla con los lotes que sí consumen stock de verdad. El resto
// del archivo ("eliminadas", "formato", "version" de arriba, "actualizado")
// tampoco tiene equivalente acá y se ignora.
//
// Cada receta entra como versión 1, SIN rendimiento esperado (el programa
// viejo no lo registraba) — queda inactiva y no se puede usar para crear
// un lote hasta que alguien la complete creando una versión nueva desde
// esta misma pantalla con el % real, que reemplaza a la importada (mismo
// versionado que ya usa el resto del módulo). Es seguro volver a correr la
// importación con un archivo actualizado: un producto elaborado que ya
// existe (mismo nombre) se deja intacto, para no pisar algo que el equipo
// ya haya empezado a completar a mano.
const ingredienteViejoSchema = z.object({
  nombre: z.string().trim().min(1),
  cantidad: z.number(),
  unidad: z.string(),
});

const recetaViejaSchema = z.object({
  nombre: z.string().trim(),
  categoria: z.string().trim().optional().nullable(),
  preparacion: z.string().trim().optional().nullable(),
  ingredientes: z.array(ingredienteViejoSchema).optional().default([]),
});

const importarRecetasSchema = z.object({
  usuarioId: z.number().int().positive(),
  datos: z
    .object({
      recetas: z.record(z.string(), recetaViejaSchema),
    })
    .passthrough(),
});

function slugCodigo(nombre: string, prefijo: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${prefijo}-${base || "ITEM"}`;
}

async function codigoUnicoDisponible(tx: Prisma.TransactionClient, base: string): Promise<string> {
  let candidato = base;
  let sufijo = 2;
  while (await tx.itemCharcuteria.findUnique({ where: { codigo: candidato } })) {
    candidato = `${base}-${sufijo}`;
    sufijo++;
  }
  return candidato;
}

// "g" y "ml" se tratan como gramos sin convertir (para los líquidos de
// estas recetas — agua, vino, vinagre — 1 ml ≈ 1 g, suficiente para el
// detalle de una receta de condimentos); "diente" (ej. ajo) se trata como
// unidad. Cualquier otra unidad desconocida se omite con una advertencia
// en vez de adivinar.
function mapearUnidadVieja(unidad: string): "gramos" | "unidad" | null {
  const u = unidad.trim().toLowerCase();
  if (u === "g" || u === "ml" || u === "gramos") return "gramos";
  if (u === "diente" || u === "unidad") return "unidad";
  return null;
}

charcuteriaRecetasRouter.post("/importar-json", async (req, res) => {
  const parsed = importarRecetasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, datos } = parsed.data;

  const usuario = await validarUsuarioActivo(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  // Case-insensitive a mano (SQLite no soporta mode: "insensitive" como
  // Postgres) — se precargan los nombres existentes y se van agregando acá
  // mismo a medida que se crean, para que dos recetas del mismo archivo que
  // comparten un ingrediente (ej. "Sal") lo reutilicen una sola vez en vez
  // de crearlo dos veces.
  const productosElaboradosExistentes = new Set(
    (await prisma.itemCharcuteria.findMany({ where: { tipoItem: "producto_elaborado" }, select: { nombre: true } })).map((p) =>
      p.nombre.trim().toLowerCase()
    )
  );
  const insumosPorNombre = new Map(
    (
      await prisma.itemCharcuteria.findMany({
        where: { tipoItem: { in: ["insumo", "materia_prima"] } },
        select: { id: true, nombre: true },
      })
    ).map((i) => [i.nombre.trim().toLowerCase(), i.id])
  );

  const creadas: { nombre: string; recetaId: number; ingredientesCreados: number; ingredientesReusados: number; ingredientesOmitidos: string[] }[] = [];
  const omitidas: { nombre: string; motivo: string }[] = [];

  for (const r of Object.values(datos.recetas)) {
    const nombre = r.nombre.trim();
    if (!nombre) {
      omitidas.push({ nombre: "(sin nombre)", motivo: "Entrada sin nombre, se omitió" });
      continue;
    }
    if (productosElaboradosExistentes.has(nombre.toLowerCase())) {
      omitidas.push({ nombre, motivo: "Ya existe un producto elaborado con ese nombre en el catálogo" });
      continue;
    }

    const ingredientesOmitidos: string[] = [];
    let ingredientesReusados = 0;
    let ingredientesCreadosCont = 0;

    const receta = await prisma.$transaction(async (tx) => {
      const codigoElaborado = await codigoUnicoDisponible(tx, slugCodigo(nombre, "PE"));
      const productoElaborado = await tx.itemCharcuteria.create({
        data: {
          codigo: codigoElaborado,
          nombre,
          tipoItem: "producto_elaborado",
          unidadMedida: "gramos",
          categoria: r.categoria?.trim() || null,
          creadoPorId: usuarioId,
        },
      });

      const ingredientesCreados: { itemId: number; cantidadPorLoteBase: number; unidad: "gramos" | "unidad" }[] = [];
      for (const ing of r.ingredientes) {
        if (!(ing.cantidad > 0)) {
          ingredientesOmitidos.push(`${ing.nombre} (cantidad 0, todavía sin dosificar en el programa viejo)`);
          continue;
        }
        const unidad = mapearUnidadVieja(ing.unidad);
        if (!unidad) {
          ingredientesOmitidos.push(`${ing.nombre} (unidad "${ing.unidad}" no reconocida)`);
          continue;
        }
        const nombreIng = ing.nombre.trim();
        const claveIng = nombreIng.toLowerCase();
        let itemId = insumosPorNombre.get(claveIng);
        if (itemId != null) {
          ingredientesReusados++;
        } else {
          const codigoIng = await codigoUnicoDisponible(tx, slugCodigo(nombreIng, "INS"));
          const item = await tx.itemCharcuteria.create({
            data: {
              codigo: codigoIng,
              nombre: nombreIng,
              tipoItem: "insumo",
              unidadMedida: "gramos",
              creadoPorId: usuarioId,
            },
          });
          itemId = item.id;
          insumosPorNombre.set(claveIng, itemId);
          ingredientesCreadosCont++;
        }
        ingredientesCreados.push({ itemId, cantidadPorLoteBase: ing.cantidad, unidad });
      }

      return tx.receta.create({
        data: {
          productoElaboradoId: productoElaborado.id,
          version: 1,
          activa: false,
          rendimientoEsperadoPct: null,
          parametrosProceso: r.preparacion?.trim() || null,
          notas:
            "Importada desde el programa anterior — falta confirmar el rendimiento esperado antes de poder usarla en un lote (ver Recetas → crear una versión nueva).",
          creadoPorId: usuarioId,
          ingredientes: { create: ingredientesCreados },
        },
      });
    });

    productosElaboradosExistentes.add(nombre.toLowerCase());
    creadas.push({
      nombre,
      recetaId: receta.id,
      ingredientesCreados: ingredientesCreadosCont,
      ingredientesReusados,
      ingredientesOmitidos,
    });
  }

  res.status(201).json({ creadas, omitidas });
});

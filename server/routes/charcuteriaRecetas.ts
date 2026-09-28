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

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { rangoFechasDesdeTexto, parsearFechaSoloDia } from "./reportes";

export const gastosRouter = Router();

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// --- Categorías de gasto (manejadas a mano) ---
//
// A pedido del usuario: antes la categoría era un campo libre (con las ya
// usadas como sugerencia) — ahora hay una lista manejada para poder
// "generar categorías" a propósito. Un Gasto sigue guardando el nombre
// como texto (no una relación), así que esto solo decide qué aparece para
// elegir al cargar un gasto nuevo — no afecta los gastos ya cargados.

gastosRouter.get("/categorias", async (req, res) => {
  const incluirInactivas = req.query.incluirInactivas === "true";
  const categorias = await prisma.categoriaGasto.findMany({
    where: incluirInactivas ? {} : { activo: true },
    orderBy: { nombre: "asc" },
  });
  res.json(categorias);
});

const crearCategoriaGastoSchema = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la categoría"),
});

gastosRouter.post("/categorias", async (req, res) => {
  const parsed = crearCategoriaGastoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const nombre = parsed.data.nombre.trim();

  const existente = await prisma.categoriaGasto.findFirst({ where: { nombre: { equals: nombre } } });
  if (existente) {
    if (!existente.activo) {
      const reactivada = await prisma.categoriaGasto.update({ where: { id: existente.id }, data: { activo: true } });
      return res.status(200).json(reactivada);
    }
    return res.status(400).json({ error: `Ya existe la categoría "${nombre}"` });
  }

  const categoria = await prisma.categoriaGasto.create({ data: { nombre } });
  res.status(201).json(categoria);
});

gastosRouter.put("/categorias/:id/desactivar", async (req, res) => {
  const id = Number(req.params.id);
  const categoria = await prisma.categoriaGasto.findUnique({ where: { id } });
  if (!categoria) return res.status(404).json({ error: "Categoría no encontrada" });

  const actualizada = await prisma.categoriaGasto.update({ where: { id }, data: { activo: false } });
  res.json(actualizada);
});

gastosRouter.get("/", async (req, res) => {
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
  const categoria = typeof req.query.categoria === "string" ? req.query.categoria : undefined;

  const gastos = await prisma.gasto.findMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      ...(categoria ? { categoria } : {}),
    },
    include: { usuario: true },
    orderBy: { fecha: "desc" },
  });
  res.json(gastos);
});

export async function calcularReporteGastos(desdeTexto?: unknown, hastaTexto?: unknown) {
  const { desde, hasta } = rangoFechasDesdeTexto(desdeTexto, hastaTexto);
  const gastos = await prisma.gasto.findMany({ where: { fecha: { gte: desde, lte: hasta } } });

  const totalPorCategoria: Record<string, number> = {};
  // Desglose dentro de cada categoría (ej. "Transporte" → "Transportista" /
  // "Combustible") — a pedido del usuario, para poder agrupar gastos
  // manualmente sin que cada uno (con su propia fecha/descripción) cuente
  // aparte. Los que no tienen concepto cargado se agrupan en "Sin concepto".
  const totalPorCategoriaYConcepto: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const g of gastos) {
    totalPorCategoria[g.categoria] = (totalPorCategoria[g.categoria] ?? 0) + g.monto;
    const concepto = g.concepto?.trim() || "Sin concepto";
    totalPorCategoriaYConcepto[g.categoria] ??= {};
    totalPorCategoriaYConcepto[g.categoria][concepto] = (totalPorCategoriaYConcepto[g.categoria][concepto] ?? 0) + g.monto;
    total += g.monto;
  }

  return { desde: desde.toISOString(), hasta: hasta.toISOString(), total, totalPorCategoria, totalPorCategoriaYConcepto };
}

gastosRouter.get("/reporte", async (req, res) => {
  res.json(await calcularReporteGastos(req.query.desde, req.query.hasta));
});

// descripcion pasó a ser obligatorio (el nombre del gasto, no una nota
// opcional) — a pedido del usuario, para no terminar con una lista de
// gastos que solo dice la categoría y nada de qué fue en concreto. Queda
// igual de nullable en la base de datos: los gastos ya cargados antes de
// este cambio no se tocan.
const crearGastoSchema = z.object({
  fecha: z.string().trim().optional(),
  categoria: z.string().trim().min(1, "Falta la categoría"),
  // Sub-agrupación opcional dentro de la categoría (ver Gasto.concepto en
  // el schema) — ej. "Transportista" o "Combustible" dentro de "Transporte".
  concepto: z.string().trim().optional(),
  descripcion: z.string().trim().min(1, "Falta el nombre del gasto"),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  usuarioId: z.number().int().positive(),
});

gastosRouter.post("/", async (req, res) => {
  const parsed = crearGastoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { fecha, categoria, concepto, descripcion, monto, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const gasto = await prisma.gasto.create({
    data: {
      categoria,
      concepto: concepto || null,
      descripcion: descripcion || null,
      monto,
      usuarioId,
      ...(parsearFechaSoloDia(fecha) ? { fecha: parsearFechaSoloDia(fecha)! } : {}),
    },
    include: { usuario: true },
  });
  res.status(201).json(gasto);
});

gastosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const gasto = await prisma.gasto.findUnique({ where: { id } });
  if (!gasto) return res.status(404).json({ error: "Gasto no encontrado" });

  await prisma.gasto.delete({ where: { id } });
  res.status(204).send();
});

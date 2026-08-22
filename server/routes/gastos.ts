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
  let total = 0;
  for (const g of gastos) {
    totalPorCategoria[g.categoria] = (totalPorCategoria[g.categoria] ?? 0) + g.monto;
    total += g.monto;
  }

  return { desde: desde.toISOString(), hasta: hasta.toISOString(), total, totalPorCategoria };
}

gastosRouter.get("/reporte", async (req, res) => {
  res.json(await calcularReporteGastos(req.query.desde, req.query.hasta));
});

const crearGastoSchema = z.object({
  fecha: z.string().trim().optional(),
  categoria: z.string().trim().min(1, "Falta la categoría"),
  descripcion: z.string().trim().optional().nullable(),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  usuarioId: z.number().int().positive(),
});

gastosRouter.post("/", async (req, res) => {
  const parsed = crearGastoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { fecha, categoria, descripcion, monto, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const gasto = await prisma.gasto.create({
    data: {
      categoria,
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

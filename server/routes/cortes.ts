import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";

export const cortesRouter = Router();

cortesRouter.get("/", async (_req, res) => {
  const cortes = await prisma.corteOpcion.findMany({
    where: { activo: true },
    orderBy: [{ familia: "asc" }, { orden: "asc" }],
  });
  res.json(cortes);
});

const crearCorteSchema = z.object({
  familia: z.string().trim().min(1, "La familia no puede estar vacía"),
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  orden: z.number().int().min(0).optional().default(0),
});

cortesRouter.post("/", async (req, res) => {
  const parsed = crearCorteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.corteOpcion.findUnique({
    where: { familia_nombre: { familia: parsed.data.familia, nombre: parsed.data.nombre } },
  });
  if (existente) {
    return res.status(409).json({ error: "Ya existe ese corte para esa familia" });
  }

  const corte = await prisma.corteOpcion.create({ data: parsed.data });
  void sincronizarCatalogoConWeb();
  res.status(201).json(corte);
});

const actualizarCorteSchema = z.object({
  familia: z.string().trim().min(1, "La familia no puede estar vacía"),
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  orden: z.number().int().min(0).optional().default(0),
});

cortesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.corteOpcion.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Corte no encontrado" });

  const parsed = actualizarCorteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.familia !== existente.familia || parsed.data.nombre !== existente.nombre) {
    const otro = await prisma.corteOpcion.findUnique({
      where: { familia_nombre: { familia: parsed.data.familia, nombre: parsed.data.nombre } },
    });
    if (otro) return res.status(409).json({ error: "Ya existe ese corte para esa familia" });
  }

  const corte = await prisma.corteOpcion.update({ where: { id }, data: parsed.data });
  void sincronizarCatalogoConWeb();
  res.json(corte);
});

cortesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.corteOpcion.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Corte no encontrado" });

  await prisma.corteOpcion.update({ where: { id }, data: { activo: false } });
  void sincronizarCatalogoConWeb();
  res.status(204).send();
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";

export const comunasRouter = Router();

comunasRouter.get("/", async (_req, res) => {
  const comunas = await prisma.comuna.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
  });
  res.json(comunas);
});

const crearComunaSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  costoEnvio: z.number().min(0, "El costo de envío no puede ser negativo"),
});

comunasRouter.post("/", async (req, res) => {
  const parsed = crearComunaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.comuna.findUnique({ where: { nombre: parsed.data.nombre } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe una comuna con ese nombre" });
  }

  const comuna = await prisma.comuna.create({ data: parsed.data });
  void sincronizarCatalogoConWeb();
  res.status(201).json(comuna);
});

const actualizarComunaSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  costoEnvio: z.number().min(0, "El costo de envío no puede ser negativo"),
});

comunasRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.comuna.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Comuna no encontrada" });

  const parsed = actualizarComunaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  if (parsed.data.nombre !== existente.nombre) {
    const otra = await prisma.comuna.findUnique({ where: { nombre: parsed.data.nombre } });
    if (otra) return res.status(409).json({ error: "Ya existe una comuna con ese nombre" });
  }

  const comuna = await prisma.comuna.update({ where: { id }, data: parsed.data });
  void sincronizarCatalogoConWeb();
  res.json(comuna);
});

comunasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.comuna.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Comuna no encontrada" });

  await prisma.comuna.update({ where: { id }, data: { activo: false } });
  void sincronizarCatalogoConWeb();
  res.status(204).send();
});

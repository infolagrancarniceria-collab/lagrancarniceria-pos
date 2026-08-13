import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { actualizarBalanzas } from "../lib/balanza";

export const balanzaRouter = Router();

async function obtenerOConfigDefault() {
  const existente = await prisma.configuracionBalanza.findFirst();
  if (existente) return existente;
  return prisma.configuracionBalanza.create({ data: {} });
}

balanzaRouter.get("/configuracion", async (_req, res) => {
  const config = await obtenerOConfigDefault();
  res.json(config);
});

const configurarBalanzaSchema = z.object({
  ip1: z.string().trim().min(1, "Falta la IP de la balanza 1"),
  ip2: z.string().trim().min(1, "Falta la IP de la balanza 2"),
  puerto: z.number().int().positive(),
});

balanzaRouter.post("/configuracion", async (req, res) => {
  const parsed = configurarBalanzaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const existente = await obtenerOConfigDefault();
  const actualizado = await prisma.configuracionBalanza.update({
    where: { id: existente.id },
    data: parsed.data,
  });
  res.json(actualizado);
});

balanzaRouter.post("/actualizar", async (_req, res) => {
  const config = await obtenerOConfigDefault();

  const productos = await prisma.producto.findMany({
    where: { activo: true, flagBalanza: { in: ["PESABLE", "IMPORTE"] } },
  });

  const resultados = await actualizarBalanzas(
    [config.ip1, config.ip2],
    config.puerto,
    productos.map((p) => ({
      plu: p.plu,
      descripcion: p.descripcion,
      precio: p.precio,
      flagBalanza: p.flagBalanza,
    }))
  );

  res.json({ cantidadProductos: productos.length, resultados });
});

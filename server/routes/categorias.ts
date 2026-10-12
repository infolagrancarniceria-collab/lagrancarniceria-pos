import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const categoriasRouter = Router();

categoriasRouter.get("/", async (_req, res) => {
  const categorias = await prisma.categoria.findMany({
    orderBy: { codigo: "asc" },
  });
  res.json(categorias);
});

const crearCategoriaSchema = z.object({
  codigo: z.string().trim().min(1, "El código no puede estar vacío"),
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  nivel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  padreId: z.number().int().positive().nullable().optional(),
});

categoriasRouter.post("/", async (req, res) => {
  const parsed = crearCategoriaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { codigo, nombre, nivel, padreId } = parsed.data;

  if (nivel === 1 && padreId) {
    return res.status(400).json({ error: "Una categoría de nivel 1 no puede tener categoría padre" });
  }
  if (nivel > 1) {
    if (!padreId) {
      return res.status(400).json({ error: "Falta la categoría padre" });
    }
    const padre = await prisma.categoria.findUnique({ where: { id: padreId } });
    if (!padre) {
      return res.status(400).json({ error: "La categoría padre indicada no existe" });
    }
    if (padre.nivel !== nivel - 1) {
      return res.status(400).json({ error: "El nivel de la categoría padre no corresponde" });
    }
  }

  const existente = await prisma.categoria.findUnique({ where: { codigo } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe una categoría con ese código" });
  }

  const categoria = await prisma.categoria.create({
    data: { codigo, nombre, nivel, padreId: nivel === 1 ? null : padreId },
  });
  res.status(201).json(categoria);
});

// El % de cobro de Venta Mayorista (ver obtenerCategoriaRaiz) solo tiene
// sentido en una categoría raíz — las subcategorías heredan el de su raíz,
// así que no tienen su propio campo editable.
const porcentajeCobroMayoristaSchema = z.object({
  porcentajeCobroMayorista: z.number().min(0, "El % no puede ser negativo").max(5, "¿Seguro? Eso es más de 500%"),
});

categoriasRouter.put("/:id/porcentaje-cobro-mayorista", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = porcentajeCobroMayoristaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const categoria = await prisma.categoria.findUnique({ where: { id } });
  if (!categoria) return res.status(404).json({ error: "Categoría no encontrada" });
  if (categoria.nivel !== 1) {
    return res.status(400).json({ error: "El % de cobro mayorista solo se configura en una categoría raíz (nivel 1)" });
  }

  const actualizada = await prisma.categoria.update({
    where: { id },
    data: { porcentajeCobroMayorista: parsed.data.porcentajeCobroMayorista },
  });
  res.json(actualizada);
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const proveedoresRouter = Router();

proveedoresRouter.get("/", async (_req, res) => {
  const proveedores = await prisma.proveedor.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
  });
  res.json(proveedores);
});

const crearProveedorSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
  contacto: z.string().trim().optional().nullable(),
});

proveedoresRouter.post("/", async (req, res) => {
  const parsed = crearProveedorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.proveedor.findUnique({ where: { nombre: parsed.data.nombre } });
  if (existente) {
    return res.status(409).json({ error: "Ya existe un proveedor con ese nombre" });
  }

  const proveedor = await prisma.proveedor.create({
    data: { nombre: parsed.data.nombre, contacto: parsed.data.contacto || null },
  });
  res.status(201).json(proveedor);
});

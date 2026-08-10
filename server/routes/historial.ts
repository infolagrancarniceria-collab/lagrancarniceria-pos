import { Router } from "express";
import { prisma } from "../db";

export const historialRouter = Router();

historialRouter.get("/", async (req, res) => {
  const productoId = req.query.productoId ? Number(req.query.productoId) : undefined;

  const historial = await prisma.historialPrecio.findMany({
    where: productoId ? { productoId } : undefined,
    include: { producto: true, usuario: true },
    orderBy: { fecha: "desc" },
    take: 500,
  });
  res.json(historial);
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";

export const productosRouter = Router();

productosRouter.get("/", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;

  let categoriaIds: number[] | undefined;
  if (categoriaId) {
    categoriaIds = await obtenerIdsCategoriaYDescendientes(categoriaId);
  }

  const productos = await prisma.producto.findMany({
    where: {
      activo: true,
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
      ...(buscar
        ? {
            OR: [
              { plu: { contains: buscar } },
              { descripcion: { contains: buscar } },
              { nombreCorto: { contains: buscar } },
            ],
          }
        : {}),
    },
    include: { categoria: true },
    orderBy: { descripcion: "asc" },
  });
  res.json(productos);
});

productosRouter.get("/:id", async (req, res) => {
  const producto = await prisma.producto.findUnique({
    where: { id: Number(req.params.id) },
    include: { categoria: true },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(producto);
});

const flagBalanzaEnum = z.enum(["NORMAL", "PESABLE", "IMPORTE"]);

const productoBaseSchema = z.object({
  plu: z.string().trim().min(1, "El PLU no puede estar vacío"),
  descripcion: z.string().trim().min(1, "La descripción no puede estar vacía"),
  nombreCorto: z.string().trim().optional().nullable(),
  marca: z.string().trim().optional().nullable(),
  categoriaId: z.number().int().positive("Falta la categoría"),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  flagBalanza: flagBalanzaEnum,
  codigoBarras: z.string().trim().optional().nullable(),
  contenido: z.string().trim().optional().nullable(),
  capacidadPorCaja: z.string().trim().optional().nullable(),
  envase: z.string().trim().optional().nullable(),
  impuestoAdicional: z.number().min(0).optional().nullable(),
  duracion: z.string().trim().optional().nullable(),
  codigoProveedor: z.string().trim().optional().nullable(),
  umbralStockBajo: z.number().min(0).optional().nullable(),
});

function validarCodigoBarrasVsFlag(data: {
  flagBalanza: string;
  codigoBarras?: string | null;
}): string | null {
  if (data.flagBalanza !== "NORMAL" && data.codigoBarras) {
    return "El código de barras (EAN) solo aplica a productos con Flag Balanza = Normal; los productos pesables/importe usan el código que imprime la balanza";
  }
  return null;
}

productosRouter.post("/", async (req, res) => {
  const parsed = productoBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const errorFlag = validarCodigoBarrasVsFlag(data);
  if (errorFlag) return res.status(400).json({ error: errorFlag });

  const categoria = await prisma.categoria.findUnique({ where: { id: data.categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  const pluExistente = await prisma.producto.findUnique({ where: { plu: data.plu } });
  if (pluExistente) return res.status(409).json({ error: "Ya existe un producto con ese PLU" });

  if (data.codigoBarras) {
    const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: data.codigoBarras } });
    if (eanExistente) return res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  }

  const producto = await prisma.producto.create({
    data: { ...data, codigoBarras: data.codigoBarras || null },
    include: { categoria: true },
  });
  res.status(201).json(producto);
});

// El precio NO se edita por esta vía a propósito: todo cambio de precio debe
// pasar por /:id/precio para quedar registrado en el historial.
const productoUpdateSchema = productoBaseSchema.omit({ precio: true });

productosRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  const parsed = productoUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const errorFlag = validarCodigoBarrasVsFlag(data);
  if (errorFlag) return res.status(400).json({ error: errorFlag });

  const categoria = await prisma.categoria.findUnique({ where: { id: data.categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  if (data.plu !== existente.plu) {
    const pluExistente = await prisma.producto.findUnique({ where: { plu: data.plu } });
    if (pluExistente) return res.status(409).json({ error: "Ya existe un producto con ese PLU" });
  }
  if (data.codigoBarras && data.codigoBarras !== existente.codigoBarras) {
    const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: data.codigoBarras } });
    if (eanExistente) return res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  }

  const producto = await prisma.producto.update({
    where: { id },
    data: { ...data, codigoBarras: data.codigoBarras || null },
    include: { categoria: true },
  });
  res.json(producto);
});

productosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  await prisma.producto.update({ where: { id }, data: { activo: false } });
  res.status(204).send();
});

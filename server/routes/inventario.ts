import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";
import { parsearFechaSoloDia } from "./reportes";

export const inventarioRouter = Router();

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// --- Stock actual ---

inventarioRouter.get("/stock", async (req, res) => {
  const soloBajoStock = req.query.bajo === "true";
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;
  const categoriaIds = categoriaId ? await obtenerIdsCategoriaYDescendientes(categoriaId) : undefined;

  const productos = await prisma.producto.findMany({
    where: { activo: true, ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}) },
    include: { categoria: true },
    orderBy: { descripcion: "asc" },
  });

  const conBandera = productos.map((p) => ({
    ...p,
    bajoStock: p.umbralStockBajo != null && p.stockActual <= p.umbralStockBajo,
  }));

  res.json(soloBajoStock ? conBandera.filter((p) => p.bajoStock) : conBandera);
});

// --- Entrada de mercadería ---

const entradaSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  motivo: z.enum(["compra", "ajuste"]),
  proveedorId: z.number().int().positive().optional().nullable(),
  costoUnitario: z.number().positive().optional().nullable(),
  numeroFactura: z.string().trim().optional().nullable(),
  usuarioId: z.number().int().positive(),
});

inventarioRouter.post("/entrada", async (req, res) => {
  const parsed = entradaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, cantidad, motivo, proveedorId, costoUnitario, numeroFactura, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (proveedorId) {
    const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } });
    if (!proveedor) return res.status(400).json({ error: "El proveedor indicado no existe" });
  }

  const [productoActualizado] = await prisma.$transaction([
    prisma.producto.update({
      where: { id: productoId },
      data: { stockActual: { increment: cantidad } },
    }),
    prisma.movimientoInventario.create({
      data: {
        productoId,
        usuarioId,
        tipo: "entrada",
        motivo,
        cantidad,
        proveedorId: proveedorId || null,
        costoUnitario: costoUnitario || null,
        numeroFactura: numeroFactura || null,
      },
    }),
  ]);

  res.json(productoActualizado);
});

// --- Salida / merma ---

const salidaSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  motivo: z.enum(["venta", "descarte", "ajuste"]),
  usuarioId: z.number().int().positive(),
});

inventarioRouter.post("/salida", async (req, res) => {
  const parsed = salidaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, cantidad, motivo, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (producto.stockActual < cantidad) {
    return res.status(400).json({
      error: `Stock insuficiente: quedan ${producto.stockActual}, se intentó sacar ${cantidad}`,
    });
  }

  const [productoActualizado] = await prisma.$transaction([
    prisma.producto.update({
      where: { id: productoId },
      data: { stockActual: { decrement: cantidad } },
    }),
    prisma.movimientoInventario.create({
      data: { productoId, usuarioId, tipo: "salida", motivo, cantidad },
    }),
  ]);

  res.json(productoActualizado);
});

// --- Cargar una factura completa (varias líneas de una vez) ---
//
// A pedido del usuario, como alternativa manual a pedirle al asistente de
// IA que lea el texto de una factura — mismo resultado final (una entrada
// de inventario por línea, motivo "compra", mismo proveedor y N° de
// factura), pero en una sola transacción atómica en vez de N llamadas
// sueltas al endpoint /entrada.

const lineaFacturaSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  costoUnitario: z.number().positive("El costo debe ser mayor a 0"),
});

const facturaSchema = z.object({
  proveedorId: z.number().int().positive(),
  numeroFactura: z.string().trim().min(1, "Falta el N° de factura"),
  fecha: z.string().trim().optional(),
  usuarioId: z.number().int().positive(),
  lineas: z.array(lineaFacturaSchema).min(1, "Agrega al menos una línea"),
});

inventarioRouter.post("/entrada-factura", async (req, res) => {
  const parsed = facturaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { proveedorId, numeroFactura, fecha, usuarioId, lineas } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } });
  if (!proveedor) return res.status(400).json({ error: "El proveedor indicado no existe" });

  const productos = await prisma.producto.findMany({ where: { id: { in: lineas.map((l) => l.productoId) } } });
  if (productos.length !== new Set(lineas.map((l) => l.productoId)).size) {
    return res.status(404).json({ error: "Uno de los productos indicados no existe" });
  }

  const fechaMovimientos = parsearFechaSoloDia(fecha) ?? new Date();

  const movimientos = await prisma.$transaction(async (tx) => {
    const creados = [];
    for (const linea of lineas) {
      await tx.producto.update({
        where: { id: linea.productoId },
        data: { stockActual: { increment: linea.cantidad } },
      });
      const movimiento = await tx.movimientoInventario.create({
        data: {
          productoId: linea.productoId,
          usuarioId,
          tipo: "entrada",
          motivo: "compra",
          cantidad: linea.cantidad,
          costoUnitario: linea.costoUnitario,
          proveedorId,
          numeroFactura,
          fecha: fechaMovimientos,
        },
        include: { producto: true },
      });
      creados.push(movimiento);
    }
    return creados;
  });

  res.status(201).json({ movimientos });
});

// --- Reporte de facturas (movimientos de compra agrupados por proveedor + N° factura) ---

inventarioRouter.get("/facturas", async (req, res) => {
  const desde = typeof req.query.desde === "string" && req.query.desde ? new Date(req.query.desde) : undefined;
  const hasta = typeof req.query.hasta === "string" && req.query.hasta ? new Date(`${req.query.hasta}T23:59:59`) : undefined;

  const movimientos = await prisma.movimientoInventario.findMany({
    where: {
      tipo: "entrada",
      motivo: "compra",
      numeroFactura: { not: null },
      proveedorId: { not: null },
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    },
    include: { producto: true, proveedor: true, usuario: true },
    orderBy: { fecha: "desc" },
  });

  const grupos = new Map<
    string,
    {
      proveedorId: number;
      proveedor: string;
      numeroFactura: string;
      fecha: Date;
      usuario: string;
      totalNeto: number;
      lineas: { producto: string; plu: string; cantidad: number; costoUnitario: number | null; subtotal: number }[];
    }
  >();
  for (const m of movimientos) {
    const clave = `${m.proveedorId}|${m.numeroFactura}`;
    const subtotal = (m.costoUnitario ?? 0) * m.cantidad;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        proveedorId: m.proveedorId!,
        proveedor: m.proveedor!.nombre,
        numeroFactura: m.numeroFactura!,
        fecha: m.fecha,
        usuario: m.usuario.nombre,
        totalNeto: 0,
        lineas: [],
      });
    }
    const grupo = grupos.get(clave)!;
    grupo.totalNeto += subtotal;
    if (m.fecha < grupo.fecha) grupo.fecha = m.fecha;
    grupo.lineas.push({
      producto: m.producto.descripcion,
      plu: m.producto.plu,
      cantidad: m.cantidad,
      costoUnitario: m.costoUnitario,
      subtotal,
    });
  }

  const facturas = Array.from(grupos.values()).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  res.json(facturas);
});

// --- Historial de movimientos ---

inventarioRouter.get("/movimientos", async (req, res) => {
  const productoId = req.query.productoId ? Number(req.query.productoId) : undefined;
  const tipo = typeof req.query.tipo === "string" ? req.query.tipo : undefined;
  const numeroFactura = typeof req.query.numeroFactura === "string" ? req.query.numeroFactura.trim() : undefined;

  const movimientos = await prisma.movimientoInventario.findMany({
    where: {
      ...(productoId ? { productoId } : {}),
      ...(tipo ? { tipo } : {}),
      ...(numeroFactura ? { numeroFactura: { contains: numeroFactura } } : {}),
    },
    include: { producto: true, usuario: true, proveedor: true },
    orderBy: { fecha: "desc" },
    take: 500,
  });
  res.json(movimientos);
});

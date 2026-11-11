import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";
import { verificarClaveConLimite } from "../lib/clave";

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
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";

  const productos = await prisma.producto.findMany({
    where: {
      activo: true,
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
      ...(buscar
        ? { OR: [{ plu: { contains: buscar } }, { descripcion: { contains: buscar } }] }
        : {}),
    },
    include: { categoria: true },
    orderBy: { descripcion: "asc" },
  });

  const conBandera = productos.map((p) => ({
    ...p,
    bajoStock: p.umbralStockBajo != null && p.stockActual <= p.umbralStockBajo,
  }));

  res.json(soloBajoStock ? conBandera.filter((p) => p.bajoStock) : conBandera);
});

// --- Reinicio de stock (auditado) ---
//
// A pedido del usuario, para empezar una cuadratura física de inventario
// desde 0: lleva a 0 el stock de todos los productos activos ("global") o
// solo los de una categoría raíz y sus subcategorías ("categoria"), con
// motivo + clave de supervisor. Cada producto afectado queda con un
// MovimientoInventario motivo "ajuste" (como un ajuste manual normal) para
// no perder rastro de por qué cambió — un producto con stock ya en 0 no
// genera movimiento (no hay nada que ajustar).

inventarioRouter.get("/reiniciar/preview", async (req, res) => {
  const alcance = req.query.alcance === "categoria" ? "categoria" : "global";
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;
  if (alcance === "categoria" && !categoriaId) {
    return res.status(400).json({ error: "Falta la categoría a reiniciar" });
  }
  const categoriaIds = alcance === "categoria" ? await obtenerIdsCategoriaYDescendientes(categoriaId!) : undefined;
  const cantidadProductos = await prisma.producto.count({
    where: {
      activo: true,
      stockActual: { not: 0 },
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
    },
  });
  res.json({ cantidadProductos });
});

const reiniciarStockSchema = z.object({
  alcance: z.enum(["global", "categoria"]),
  categoriaId: z.number().int().positive().optional(),
  motivo: z.string().trim().min(1, "Falta el motivo del reinicio"),
  usuarioId: z.number().int().positive(),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

inventarioRouter.post("/reiniciar", async (req, res) => {
  const parsed = reiniciarStockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { alcance, categoriaId, motivo, usuarioId, clave } = parsed.data;

  if (alcance === "categoria" && !categoriaId) {
    return res.status(400).json({ error: "Falta la categoría a reiniciar" });
  }

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res
      .status(429)
      .json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const categoriaIds = alcance === "categoria" ? await obtenerIdsCategoriaYDescendientes(categoriaId!) : undefined;

  const productos = await prisma.producto.findMany({
    where: {
      activo: true,
      stockActual: { not: 0 },
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
    },
  });

  const reinicio = await prisma.$transaction(async (tx) => {
    for (const producto of productos) {
      await tx.producto.update({ where: { id: producto.id }, data: { stockActual: 0 } });
      await tx.movimientoInventario.create({
        data: {
          productoId: producto.id,
          usuarioId,
          tipo: producto.stockActual > 0 ? "salida" : "entrada",
          motivo: "ajuste",
          cantidad: Math.abs(producto.stockActual),
        },
      });
    }
    return tx.reinicioInventario.create({
      data: {
        alcance,
        categoriaId: alcance === "categoria" ? categoriaId : null,
        motivo: motivo.trim(),
        usuarioAutorizoId: usuarioId,
        cantidadProductosAfectados: productos.length,
      },
      include: { usuarioAutorizo: true, categoria: true },
    });
  });

  res.status(201).json(reinicio);
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

// --- Reporte de facturas (movimientos de compra agrupados por proveedor + N° factura) ---
//
// Solo lectura, para ver lo cargado antes de retirar "Cargar factura" (ver
// POST /entrada-factura, eliminado) — toda compra nueva entra por Ingreso a
// cámara (ver server/routes/camara.ts).

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

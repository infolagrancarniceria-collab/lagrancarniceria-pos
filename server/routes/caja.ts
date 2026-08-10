import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashClave, verificarClave } from "../lib/clave";

export const cajaRouter = Router();

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// --- Clave de supervisor ---

cajaRouter.get("/clave-supervisor/estado", async (_req, res) => {
  const clave = await prisma.claveSupervisor.findFirst();
  res.json({ configurada: !!clave });
});

const claveSupervisorSchema = z.object({
  claveActual: z.string().optional(),
  claveNueva: z.string().min(4, "La clave debe tener al menos 4 caracteres"),
});

cajaRouter.post("/clave-supervisor", async (req, res) => {
  const parsed = claveSupervisorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { claveActual, claveNueva } = parsed.data;

  const existente = await prisma.claveSupervisor.findFirst();
  if (existente) {
    if (!claveActual || !verificarClave(claveActual, existente.hashClave)) {
      return res.status(400).json({ error: "La clave actual no es correcta" });
    }
    await prisma.claveSupervisor.update({
      where: { id: existente.id },
      data: { hashClave: hashClave(claveNueva) },
    });
  } else {
    await prisma.claveSupervisor.create({ data: { hashClave: hashClave(claveNueva) } });
  }
  res.status(204).send();
});

cajaRouter.post("/clave-supervisor/verificar", async (req, res) => {
  const clave = typeof req.body?.clave === "string" ? req.body.clave : "";
  const existente = await prisma.claveSupervisor.findFirst();
  if (!existente) return res.json({ valida: false });
  res.json({ valida: verificarClave(clave, existente.hashClave) });
});

// --- Sesiones de caja (apertura / cierre) ---

cajaRouter.get("/sesiones", async (_req, res) => {
  const sesiones = await prisma.sesionCaja.findMany({
    include: { usuarioApertura: true, usuarioCierre: true },
    orderBy: { fechaApertura: "desc" },
    take: 100,
  });
  res.json(sesiones);
});

cajaRouter.get("/sesiones/actual", async (_req, res) => {
  const sesion = await prisma.sesionCaja.findFirst({
    where: { estado: "abierta" },
    include: { usuarioApertura: true },
  });
  res.json(sesion);
});

const abrirSesionSchema = z.object({
  fondoFijoInicial: z.number().min(0, "El fondo fijo no puede ser negativo"),
  usuarioId: z.number().int().positive(),
});

cajaRouter.post("/sesiones", async (req, res) => {
  const parsed = abrirSesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { fondoFijoInicial, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const yaAbierta = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (yaAbierta) return res.status(409).json({ error: "Ya hay una caja abierta" });

  const sesion = await prisma.sesionCaja.create({
    data: { fondoFijoInicial, usuarioAperturaId: usuarioId },
  });
  res.status(201).json(sesion);
});

async function calcularResumenSesion(sesionId: number) {
  const ventas = await prisma.venta.findMany({
    where: { sesionCajaId: sesionId, estado: "pagada" },
    include: { pagos: true },
  });

  const totalPorMedio: Record<string, number> = { efectivo: 0, tarjeta: 0 };
  let totalVentas = 0;
  for (const venta of ventas) {
    totalVentas += venta.total;
    for (const pago of venta.pagos) {
      totalPorMedio[pago.medio] = (totalPorMedio[pago.medio] ?? 0) + pago.monto;
    }
  }

  return { cantidadVentas: ventas.length, totalVentas, totalPorMedio };
}

cajaRouter.get("/sesiones/:id/resumen", async (req, res) => {
  const id = Number(req.params.id);
  const sesion = await prisma.sesionCaja.findUnique({ where: { id } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });

  const resumen = await calcularResumenSesion(id);
  const efectivoEsperado = sesion.fondoFijoInicial + resumen.totalPorMedio.efectivo;

  res.json({
    sesion,
    ...resumen,
    efectivoEsperado,
    diferencia: sesion.efectivoContado != null ? sesion.efectivoContado - efectivoEsperado : null,
  });
});

const cerrarSesionSchema = z.object({
  efectivoContado: z.number().min(0, "El efectivo contado no puede ser negativo"),
  usuarioId: z.number().int().positive(),
});

cajaRouter.post("/sesiones/:id/cerrar", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = cerrarSesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { efectivoContado, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesion = await prisma.sesionCaja.findUnique({ where: { id } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (sesion.estado !== "abierta") return res.status(400).json({ error: "Esta caja ya está cerrada" });

  const ventaAbierta = await prisma.venta.findFirst({ where: { sesionCajaId: id, estado: "abierta" } });
  if (ventaAbierta) {
    return res.status(400).json({ error: "Hay una venta sin terminar — confírmala o cancélala antes de cerrar la caja" });
  }

  await prisma.sesionCaja.update({
    where: { id },
    data: { estado: "cerrada", efectivoContado, fechaCierre: new Date(), usuarioCierreId: usuarioId },
  });

  const sesionActualizada = await prisma.sesionCaja.findUnique({ where: { id } });
  const resumen = await calcularResumenSesion(id);
  const efectivoEsperado = sesionActualizada!.fondoFijoInicial + resumen.totalPorMedio.efectivo;

  res.json({
    sesion: sesionActualizada,
    ...resumen,
    efectivoEsperado,
    diferencia: efectivoContado - efectivoEsperado,
  });
});

// --- Ventas ---

cajaRouter.get("/ventas/abierta", async (_req, res) => {
  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.json(null);

  const venta = await prisma.venta.findFirst({
    where: { sesionCajaId: sesion.id, estado: "abierta" },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.json(venta);
});

cajaRouter.get("/ventas/:id", async (req, res) => {
  const venta = await prisma.venta.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: { include: { producto: true } }, pagos: true, usuario: true },
  });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  res.json(venta);
});

const crearVentaSchema = z.object({ usuarioId: z.number().int().positive() });

cajaRouter.post("/ventas", async (req, res) => {
  const parsed = crearVentaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta" });

  const yaAbierta = await prisma.venta.findFirst({ where: { sesionCajaId: sesion.id, estado: "abierta" } });
  if (yaAbierta) return res.status(409).json({ error: "Ya hay una venta en curso", ventaId: yaAbierta.id });

  const venta = await prisma.venta.create({
    data: { sesionCajaId: sesion.id, usuarioId },
    include: { items: true, pagos: true },
  });
  res.status(201).json(venta);
});

const agregarItemSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});

cajaRouter.post("/ventas/:id/items", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, cantidad } = parsed.data;

  const venta = await prisma.venta.findUnique({ where: { id: ventaId }, include: { items: true } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  const yaEnCarrito = venta.items
    .filter((i) => i.productoId === productoId && !i.anulado)
    .reduce((suma, i) => suma + i.cantidad, 0);
  if (producto.stockActual < yaEnCarrito + cantidad) {
    return res.status(400).json({
      error: `Stock insuficiente: quedan ${producto.stockActual - yaEnCarrito} disponibles`,
    });
  }

  const subtotal = producto.precio * cantidad;
  await prisma.itemVenta.create({
    data: { ventaId, productoId, cantidad, precioUnitario: producto.precio, subtotal },
  });

  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.status(201).json(ventaActualizada);
});

async function recalcularTotal(ventaId: number) {
  const items = await prisma.itemVenta.findMany({ where: { ventaId, anulado: false } });
  const total = items.reduce((suma, i) => suma + i.subtotal, 0);
  await prisma.venta.update({ where: { id: ventaId }, data: { total } });
}

const anularItemSchema = z.object({
  clave: z.string().min(1, "Falta la clave de supervisor"),
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().optional().nullable(),
});

cajaRouter.delete("/ventas/:id/items/:itemId", async (req, res) => {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const parsed = anularItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { clave, usuarioId, motivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor || !verificarClave(clave, claveSupervisor.hashClave)) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const item = await prisma.itemVenta.findUnique({ where: { id: itemId } });
  if (!item || item.ventaId !== ventaId) return res.status(404).json({ error: "Ítem no encontrado" });

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta || venta.estado !== "abierta") {
    return res.status(400).json({ error: "Esta venta ya no admite cambios" });
  }

  await prisma.itemVenta.update({
    where: { id: itemId },
    data: {
      anulado: true,
      usuarioAnulacionId: usuarioId,
      motivoAnulacion: motivo || null,
      fechaAnulacion: new Date(),
    },
  });
  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.json(ventaActualizada);
});

const agregarPagoSchema = z.object({
  medio: z.enum(["efectivo", "tarjeta"]),
  monto: z.number().positive("El monto debe ser mayor a 0"),
});

cajaRouter.post("/ventas/:id/pagos", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarPagoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  await prisma.pagoVenta.create({ data: { ventaId, ...parsed.data } });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.status(201).json(ventaActualizada);
});

cajaRouter.delete("/ventas/:id/pagos/:pagoId", async (req, res) => {
  const ventaId = Number(req.params.id);
  const pagoId = Number(req.params.pagoId);

  const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId } });
  if (!pago || pago.ventaId !== ventaId) return res.status(404).json({ error: "Pago no encontrado" });

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta || venta.estado !== "abierta") {
    return res.status(400).json({ error: "Esta venta ya no admite cambios" });
  }

  await prisma.pagoVenta.delete({ where: { id: pagoId } });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.json(ventaActualizada);
});

const confirmarVentaSchema = z.object({ usuarioId: z.number().int().positive() });

cajaRouter.post("/ventas/:id/confirmar", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = confirmarVentaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const venta = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya fue procesada" });

  const itemsActivos = venta.items.filter((i) => !i.anulado);
  if (itemsActivos.length === 0) {
    return res.status(400).json({ error: "La venta no tiene productos" });
  }

  const totalPagado = venta.pagos.reduce((suma, p) => suma + p.monto, 0);
  if (Math.abs(totalPagado - venta.total) > 0.01) {
    return res.status(400).json({
      error: `Los pagos ($${totalPagado}) no coinciden con el total de la venta ($${venta.total})`,
    });
  }

  // Suma por producto, por si el mismo producto se agregó más de una vez.
  const cantidadPorProducto = new Map<number, number>();
  for (const item of itemsActivos) {
    cantidadPorProducto.set(item.productoId, (cantidadPorProducto.get(item.productoId) ?? 0) + item.cantidad);
  }
  for (const [productoId, cantidad] of cantidadPorProducto) {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto || producto.stockActual < cantidad) {
      return res.status(400).json({
        error: `Stock insuficiente para ${producto?.descripcion ?? "un producto"}: quedan ${producto?.stockActual ?? 0}`,
      });
    }
  }

  await prisma.$transaction([
    prisma.venta.update({ where: { id: ventaId }, data: { estado: "pagada" } }),
    ...Array.from(cantidadPorProducto.entries()).flatMap(([productoId, cantidad]) => [
      prisma.producto.update({ where: { id: productoId }, data: { stockActual: { decrement: cantidad } } }),
      prisma.movimientoInventario.create({
        data: { productoId, usuarioId, tipo: "salida", motivo: "venta", cantidad },
      }),
    ]),
  ]);

  const ventaFinal = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true },
  });
  res.json(ventaFinal);
});

cajaRouter.post("/ventas/:id/cancelar", async (req, res) => {
  const ventaId = Number(req.params.id);

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya fue procesada" });

  const ventaCancelada = await prisma.venta.update({ where: { id: ventaId }, data: { estado: "anulada" } });
  res.json(ventaCancelada);
});

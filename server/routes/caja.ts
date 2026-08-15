import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { hashClave, verificarClave } from "../lib/clave";
import { decodificarCodigoBalanza } from "../lib/codigoBarras";
import { rangoFechasDesdeTexto } from "./reportes";

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

  const totalPorMedio: Record<string, number> = { efectivo: 0, tarjeta: 0, credito: 0 };
  let totalVentas = 0;
  for (const venta of ventas) {
    totalVentas += venta.total;
    for (const pago of venta.pagos) {
      totalPorMedio[pago.medio] = (totalPorMedio[pago.medio] ?? 0) + pago.monto;
    }
  }

  // Créditos de ventas de OTRAS sesiones que se cobraron durante esta —
  // esa plata entra a la caja hoy, aunque la venta original haya sido
  // fiada en otro día. Se suma al medio real con el que se cobró
  // (efectivo/tarjeta), no queda como "credito" (eso ya se descontó cuando
  // se dio el crédito originalmente).
  const cobrosHoy = await prisma.pagoVenta.findMany({
    where: { sesionCajaCobroId: sesionId, cobrado: true },
  });
  let totalCobrosCredito = 0;
  for (const cobro of cobrosHoy) {
    totalPorMedio[cobro.medioCobro!] = (totalPorMedio[cobro.medioCobro!] ?? 0) + cobro.monto;
    totalCobrosCredito += cobro.monto;
  }

  return { cantidadVentas: ventas.length, totalVentas, totalPorMedio, totalCobrosCredito };
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

// Buscar ventas confirmadas (pagadas) por rango de fechas y/o N° de venta —
// para la pantalla "Buscar venta" (ver detalle / reimprimir un vale).
cajaRouter.get("/ventas", async (req, res) => {
  const ventaId = req.query.ventaId ? Number(req.query.ventaId) : undefined;
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);

  const ventas = await prisma.venta.findMany({
    where: {
      estado: "pagada",
      ...(ventaId ? { id: ventaId } : { fecha: { gte: desde, lte: hasta } }),
    },
    include: { usuario: true, items: true, pagos: true },
    orderBy: { fecha: "desc" },
    take: 200,
  });
  res.json(ventas);
});

cajaRouter.get("/ventas/abierta", async (_req, res) => {
  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.json(null);

  const venta = await prisma.venta.findFirst({
    where: { sesionCajaId: sesion.id, estado: "abierta" },
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
  });
  res.json(venta);
});

cajaRouter.get("/ventas/:id", async (req, res) => {
  const venta = await prisma.venta.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: { include: { producto: true } }, pagos: true, usuario: true, comuna: true },
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
    include: { items: true, pagos: true, comuna: true },
  });
  res.status(201).json(venta);
});

const despachoSchema = z.object({
  esDespacho: z.boolean(),
  comunaId: z.number().int().positive().optional().nullable(),
});

cajaRouter.put("/ventas/:id/despacho", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = despachoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { esDespacho, comunaId } = parsed.data;

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  if (!esDespacho) {
    await prisma.venta.update({
      where: { id: ventaId },
      data: { esDespacho: false, comunaId: null, costoEnvio: null },
    });
  } else {
    if (!comunaId) return res.status(400).json({ error: "Falta elegir la comuna" });
    const comuna = await prisma.comuna.findUnique({ where: { id: comunaId } });
    if (!comuna) return res.status(400).json({ error: "La comuna indicada no existe" });

    await prisma.venta.update({
      where: { id: ventaId },
      data: { esDespacho: true, comunaId, costoEnvio: comuna.costoEnvio },
    });
  }
  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
});

const agregarItemSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});

interface ErrorAgregarItem {
  status: number;
  error: string;
}

async function agregarItemAVenta(
  ventaId: number,
  productoId: number,
  cantidad: number
): Promise<ErrorAgregarItem | null> {
  const venta = await prisma.venta.findUnique({ where: { id: ventaId }, include: { items: true } });
  if (!venta) return { status: 404, error: "Venta no encontrada" };
  if (venta.estado !== "abierta") return { status: 400, error: "Esta venta ya no admite cambios" };

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return { status: 404, error: "Producto no encontrado" };

  const yaEnCarrito = venta.items
    .filter((i) => i.productoId === productoId && !i.anulado)
    .reduce((suma, i) => suma + i.cantidad, 0);
  if (producto.stockActual < yaEnCarrito + cantidad) {
    return { status: 400, error: `Stock insuficiente: quedan ${producto.stockActual - yaEnCarrito} disponibles` };
  }

  // El peso pesable viene con decimales (gramos), así que precio * cantidad
  // puede dar centavos que no existen en pesos chilenos — se redondea igual
  // que la balanza física redondea el total que imprime en su ticket.
  const subtotal = Math.round(producto.precio * cantidad);
  await prisma.itemVenta.create({
    data: { ventaId, productoId, cantidad, precioUnitario: producto.precio, subtotal },
  });
  await recalcularTotal(ventaId);
  return null;
}

cajaRouter.post("/ventas/:id/items", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const errorAgregar = await agregarItemAVenta(ventaId, parsed.data.productoId, parsed.data.cantidad);
  if (errorAgregar) return res.status(errorAgregar.status).json({ error: errorAgregar.error });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(ventaActualizada);
});

// --- Agregar ítem escaneando un código de barras ---
// Prueba dos formatos: el EAN normal de fábrica (campo codigoBarras, solo en
// productos Flag Balanza = Normal), o el código que imprime la balanza para
// productos Pesable (PLU + peso embebido, ver server/lib/codigoBarras.ts).

const escanearCodigoSchema = z.object({
  codigo: z.string().trim().min(1, "Falta el código escaneado"),
});

cajaRouter.post("/ventas/:id/items/escanear", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = escanearCodigoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { codigo } = parsed.data;

  let producto = await prisma.producto.findUnique({ where: { codigoBarras: codigo } });
  let cantidad = 1;

  if (!producto) {
    const decodificado = decodificarCodigoBalanza(codigo);
    if (decodificado) {
      producto = await prisma.producto.findUnique({ where: { plu: decodificado.plu } });
      cantidad = decodificado.pesoKg;
    }
  }

  if (!producto) {
    return res.status(404).json({ error: "No se encontró ningún producto con ese código" });
  }

  const errorAgregar = await agregarItemAVenta(ventaId, producto.id, cantidad);
  if (errorAgregar) return res.status(errorAgregar.status).json({ error: errorAgregar.error });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(ventaActualizada);
});

async function recalcularTotal(ventaId: number) {
  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  const items = await prisma.itemVenta.findMany({ where: { ventaId, anulado: false } });
  const total = items.reduce((suma, i) => suma + i.subtotal, 0) + (venta?.costoEnvio ?? 0);
  await prisma.venta.update({ where: { id: ventaId }, data: { total } });
}

const anularItemSchema = z.object({
  clave: z.string().trim().optional().nullable(),
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

  const item = await prisma.itemVenta.findUnique({ where: { id: itemId } });
  if (!item || item.ventaId !== ventaId) return res.status(404).json({ error: "Ítem no encontrado" });

  const venta = await prisma.venta.findUnique({ where: { id: ventaId }, include: { pagos: true } });
  if (!venta || venta.estado !== "abierta") {
    return res.status(400).json({ error: "Esta venta ya no admite cambios" });
  }

  // Si todavía no se registró ningún pago, no hay plata ni stock comprometido
  // — se puede sacar el ítem del carrito sin pedir clave de supervisor
  // (ej. el cliente cambia de opinión antes de pagar). Una vez que empezó a
  // registrarse el pago, sí se pide clave, para dejar rastro de auditoría.
  if (venta.pagos.length > 0) {
    if (!clave) return res.status(400).json({ error: "Falta la clave de supervisor" });
    const claveSupervisor = await prisma.claveSupervisor.findFirst();
    if (!claveSupervisor || !verificarClave(clave, claveSupervisor.hashClave)) {
      return res.status(403).json({ error: "Clave de supervisor incorrecta" });
    }
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
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
});

const agregarPagoSchema = z
  .object({
    medio: z.enum(["efectivo", "tarjeta", "credito"]),
    monto: z.number().positive("El monto debe ser mayor a 0"),
    clienteNombre: z.string().trim().optional().nullable(),
  })
  .refine((data) => data.medio !== "credito" || !!data.clienteNombre?.trim(), {
    message: "Falta el nombre del cliente para dejarlo a crédito",
    path: ["clienteNombre"],
  });

cajaRouter.post("/ventas/:id/pagos", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarPagoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { medio, monto, clienteNombre } = parsed.data;

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  await prisma.pagoVenta.create({
    data: { ventaId, medio, monto, clienteNombre: medio === "credito" ? clienteNombre!.trim() : null },
  });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true } }, pagos: true, comuna: true },
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

// --- Créditos pendientes (ventas fiadas, a cobrar después) ---

cajaRouter.get("/creditos-pendientes", async (_req, res) => {
  const creditos = await prisma.pagoVenta.findMany({
    where: { medio: "credito", cobrado: false },
    include: { venta: true },
    orderBy: { venta: { fecha: "asc" } },
  });
  res.json(creditos);
});

const cobrarCreditoSchema = z.object({
  medioCobro: z.enum(["efectivo", "tarjeta"]),
  usuarioId: z.number().int().positive(),
});

cajaRouter.post("/creditos/:pagoId/cobrar", async (req, res) => {
  const pagoId = Number(req.params.pagoId);
  const parsed = cobrarCreditoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { medioCobro, usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId } });
  if (!pago || pago.medio !== "credito") return res.status(404).json({ error: "Crédito no encontrado" });
  if (pago.cobrado) return res.status(400).json({ error: "Este crédito ya estaba marcado como cobrado" });

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta para registrar el cobro" });

  const pagoActualizado = await prisma.pagoVenta.update({
    where: { id: pagoId },
    data: {
      cobrado: true,
      medioCobro,
      sesionCajaCobroId: sesion.id,
      usuarioCobroId: usuarioId,
      fechaCobro: new Date(),
    },
  });
  res.json(pagoActualizado);
});

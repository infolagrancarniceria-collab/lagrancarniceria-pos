import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { hashClave, verificarClaveConLimite } from "../lib/clave";
import { decodificarCodigoBalanza } from "../lib/codigoBarras";
import { calcularProximoPlu } from "../lib/proximoPlu";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";
import { rangoFechasDesdeTexto } from "./reportes";
import { skuCharcuteriaDeProducto, elegirLoteFefo } from "../lib/charcuteriaFefo";
import { obtenerCategoriaRaiz } from "../lib/categorias";

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
    if (!claveActual) {
      return res.status(400).json({ error: "La clave actual no es correcta" });
    }
    const resultado = verificarClaveConLimite(req.ip ?? "desconocido", claveActual, existente.hashClave);
    if (resultado.bloqueado) {
      return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` });
    }
    if (!resultado.valida) {
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
  const resultado = verificarClaveConLimite(req.ip ?? "desconocido", clave, existente.hashClave);
  if (resultado.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` });
  }
  res.json({ valida: resultado.valida });
});

// --- Sesiones de caja (apertura / cierre) ---

cajaRouter.get("/sesiones", async (_req, res) => {
  const sesiones = await prisma.sesionCaja.findMany({
    include: { usuarioApertura: true, usuarioCierre: true, usuarioAutorizoFondo: true },
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

// Lo que debería haber en caja para empezar el día: el efectivo realmente
// contado al cerrar la sesión anterior (fondo fijo + ventas + cobros de
// crédito en efectivo, ya verificado contra lo contado a mano). Si nunca se
// cerró ninguna caja todavía, no hay sugerencia.
cajaRouter.get("/sesiones/fondo-sugerido", async (_req, res) => {
  const ultimaCerrada = await prisma.sesionCaja.findFirst({
    where: { estado: "cerrada" },
    orderBy: { fechaCierre: "desc" },
  });
  res.json({ fondoSugerido: ultimaCerrada?.efectivoContado ?? null });
});

const abrirSesionSchema = z
  .object({
    fondoFijoInicial: z.number().min(0, "El fondo fijo no puede ser negativo"),
    usuarioId: z.number().int().positive(),
    // Solo hacen falta si fondoFijoInicial termina distinto de lo sugerido
    // (ver /sesiones/fondo-sugerido) — es un ajuste manual del fondo, y
    // queda igual de auditado que cualquier otra anulación de Caja.
    clave: z.string().optional(),
    motivoAjusteFondo: z.string().trim().optional(),
    usuarioAutorizoId: z.number().int().positive().optional(),
  })
  .refine((data) => !data.usuarioAutorizoId || !!data.clave, {
    message: "Falta la clave de supervisor para autorizar el ajuste",
    path: ["clave"],
  });

cajaRouter.post("/sesiones", async (req, res) => {
  const parsed = abrirSesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { fondoFijoInicial, usuarioId, clave, motivoAjusteFondo, usuarioAutorizoId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const yaAbierta = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (yaAbierta) return res.status(409).json({ error: "Ya hay una caja abierta" });

  const ultimaCerrada = await prisma.sesionCaja.findFirst({
    where: { estado: "cerrada" },
    orderBy: { fechaCierre: "desc" },
  });
  const fondoSugerido = ultimaCerrada?.efectivoContado ?? null;
  const esAjuste = fondoSugerido != null && Math.abs(fondoFijoInicial - fondoSugerido) > 0.01;

  let usuarioAutorizoFondoId: number | null = null;
  if (esAjuste) {
    if (!motivoAjusteFondo) {
      return res.status(400).json({ error: "Indica el motivo del ajuste del fondo inicial" });
    }
    if (!usuarioAutorizoId || !clave) {
      return res.status(400).json({ error: "El ajuste del fondo inicial necesita autorización de un supervisor" });
    }
    const autorizador = await validarUsuario(usuarioAutorizoId);
    if (!autorizador) return res.status(400).json({ error: "Usuario que autoriza inválido" });

    const claveSupervisor = await prisma.claveSupervisor.findFirst();
    if (!claveSupervisor) {
      return res.status(403).json({ error: "Clave de supervisor incorrecta" });
    }
    const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
    if (resultadoClave.bloqueado) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo`,
      });
    }
    if (!resultadoClave.valida) {
      return res.status(403).json({ error: "Clave de supervisor incorrecta" });
    }
    usuarioAutorizoFondoId = usuarioAutorizoId;
  }

  const sesion = await prisma.sesionCaja.create({
    data: {
      fondoFijoInicial,
      usuarioAperturaId: usuarioId,
      fondoFijoSugerido: fondoSugerido,
      motivoAjusteFondo: esAjuste ? motivoAjusteFondo : null,
      usuarioAutorizoFondoId,
    },
  });
  res.status(201).json(sesion);
});

async function calcularResumenSesion(sesionId: number) {
  const ventas = await prisma.venta.findMany({
    where: { sesionCajaId: sesionId, estado: "pagada" },
    include: { pagos: true },
  });

  const totalPorMedio: Record<string, number> = {
    efectivo: 0,
    tarjeta: 0,
    credito: 0,
    transferencia: 0,
    pedido_web: 0,
    mayorista: 0,
  };
  let totalVentas = 0;
  for (const venta of ventas) {
    totalVentas += venta.total;
    for (const pago of venta.pagos) {
      totalPorMedio[pago.medio] = (totalPorMedio[pago.medio] ?? 0) + pago.monto;
    }
  }

  // Separado por canal (ver Venta.canal) — mismo criterio que el reporte de
  // Ventas (ver calcularReporteVentas en reportes.ts): "local" agrupa el
  // canal por defecto más cualquier valor viejo/no usado, para que las tres
  // cifras siempre sumen el total exacto. A pedido del usuario, para ver de
  // un vistazo cuánto se vendió hoy en Caja Online y en Venta Mayorista sin
  // salir de "Caja abierta" — totalPorMedio.pedido_web/mayorista de abajo es
  // otra cosa (lo que quedó pendiente de cobro), no cuánto se vendió.
  const ventasOnline = ventas.filter((v) => v.canal === "online");
  const cantidadVentasOnline = ventasOnline.length;
  const totalVentasOnline = ventasOnline.reduce((s, v) => s + v.total, 0);

  const ventasMayorista = ventas.filter((v) => v.canal === "mayorista");
  const cantidadVentasMayorista = ventasMayorista.length;
  const totalVentasMayorista = ventasMayorista.reduce((s, v) => s + v.total, 0);

  const ventasLocal = ventas.filter((v) => v.canal !== "online" && v.canal !== "mayorista");
  const cantidadVentasLocal = ventasLocal.length;
  const totalVentasLocal = ventasLocal.reduce((s, v) => s + v.total, 0);

  // Créditos/transferencias/pedidos web de OTRAS sesiones que se cobraron o
  // confirmaron durante esta — esa plata entra a la caja hoy, aunque la
  // venta original haya sido de otro día. Se suma al medio real con el que
  // se cobró (efectivo/tarjeta), no queda como "credito"/"transferencia"
  // (eso ya se descontó cuando se dio el crédito/transferencia
  // originalmente). Se llevan separados (totalCobrosCredito vs
  // totalCobrosTransferencia vs totalCobrosPedidoWeb vs
  // totalCobrosMayorista) a pedido del dueño, que quiere ese registro
  // aparte aunque el mecanismo sea el mismo.
  const cobrosHoy = await prisma.pagoVenta.findMany({
    where: { sesionCajaCobroId: sesionId, cobrado: true },
  });
  let totalCobrosCredito = 0;
  let totalCobrosTransferencia = 0;
  let totalCobrosPedidoWeb = 0;
  let totalCobrosMayorista = 0;
  for (const cobro of cobrosHoy) {
    totalPorMedio[cobro.medioCobro!] = (totalPorMedio[cobro.medioCobro!] ?? 0) + cobro.monto;
    if (cobro.medio === "transferencia") {
      totalCobrosTransferencia += cobro.monto;
    } else if (cobro.medio === "pedido_web") {
      totalCobrosPedidoWeb += cobro.monto;
    } else if (cobro.medio === "mayorista") {
      totalCobrosMayorista += cobro.monto;
    } else {
      totalCobrosCredito += cobro.monto;
    }
  }

  // Retiros de caja (ver modelo RetiroCaja) — plata que salió en efectivo
  // durante el turno sin ser parte de ninguna venta (ej. pagarle a un
  // proveedor que llega con mercadería) — se resta del efectivo esperado
  // más abajo para que no aparezca como una diferencia de caja al cerrar.
  const movimientos = await prisma.retiroCaja.findMany({ where: { sesionCajaId: sesionId }, include: { usuarioAutorizo: true } });
  const retiros = movimientos.filter((m) => m.tipo !== "ingreso");
  const ingresos = movimientos.filter((m) => m.tipo === "ingreso");
  const totalRetiros = retiros.reduce((s, r) => s + r.monto, 0);
  const totalIngresos = ingresos.reduce((s, r) => s + r.monto, 0);

  return {
    cantidadVentas: ventas.length,
    totalVentas,
    cantidadVentasLocal,
    totalVentasLocal,
    cantidadVentasOnline,
    totalVentasOnline,
    cantidadVentasMayorista,
    totalVentasMayorista,
    totalPorMedio,
    totalCobrosCredito,
    totalCobrosTransferencia,
    totalCobrosPedidoWeb,
    totalCobrosMayorista,
    retiros,
    totalRetiros,
    ingresos,
    totalIngresos,
  };
}

cajaRouter.get("/sesiones/:id/resumen", async (req, res) => {
  const id = Number(req.params.id);
  const sesion = await prisma.sesionCaja.findUnique({ where: { id } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });

  const resumen = await calcularResumenSesion(id);
  const efectivoEsperado =
    sesion.fondoFijoInicial + resumen.totalPorMedio.efectivo - resumen.totalRetiros + resumen.totalIngresos;

  res.json({
    sesion,
    ...resumen,
    efectivoEsperado,
    diferencia: sesion.efectivoContado != null ? sesion.efectivoContado - efectivoEsperado : null,
  });
});

// --- Cuadratura de caja ---
// Reporte para un rango de fechas — puede abarcar varias sesiones (cada día
// se abre y cierra una caja aparte), así que se muestra un desglose por
// sesión (mismos datos que /sesiones/:id/resumen, uno por día) más un total
// general sumando todo el rango. El fondo inicial no se suma entre
// sesiones distintas en ningún cálculo individual — es un dato propio de
// cada una — pero sí se incluye sumado en el total general para que se
// vea de un vistazo cuánto fondo fijo estuvo en juego en total.
cajaRouter.get("/cuadratura", async (req, res) => {
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);

  const sesiones = await prisma.sesionCaja.findMany({
    where: { fechaApertura: { gte: desde, lte: hasta } },
    orderBy: { fechaApertura: "asc" },
    include: { usuarioApertura: true, usuarioCierre: true },
  });

  const dias = await Promise.all(
    sesiones.map(async (sesion) => {
      const resumen = await calcularResumenSesion(sesion.id);
      const efectivoEsperado =
        sesion.fondoFijoInicial + resumen.totalPorMedio.efectivo - resumen.totalRetiros + resumen.totalIngresos;
      return {
        sesion,
        ...resumen,
        efectivoEsperado,
        diferencia: sesion.efectivoContado != null ? sesion.efectivoContado - efectivoEsperado : null,
      };
    })
  );

  const totalGeneral = dias.reduce(
    (acc, dia) => ({
      fondoFijoInicial: acc.fondoFijoInicial + dia.sesion.fondoFijoInicial,
      totalVentas: acc.totalVentas + dia.totalVentas,
      totalPorMedio: {
        efectivo: acc.totalPorMedio.efectivo + dia.totalPorMedio.efectivo,
        tarjeta: acc.totalPorMedio.tarjeta + dia.totalPorMedio.tarjeta,
        credito: acc.totalPorMedio.credito + dia.totalPorMedio.credito,
        transferencia: acc.totalPorMedio.transferencia + dia.totalPorMedio.transferencia,
        pedido_web: acc.totalPorMedio.pedido_web + (dia.totalPorMedio.pedido_web ?? 0),
        mayorista: acc.totalPorMedio.mayorista + (dia.totalPorMedio.mayorista ?? 0),
      },
      totalRetiros: acc.totalRetiros + dia.totalRetiros,
      totalIngresos: acc.totalIngresos + dia.totalIngresos,
      efectivoEsperado: acc.efectivoEsperado + dia.efectivoEsperado,
      efectivoContado: acc.efectivoContado + (dia.sesion.efectivoContado ?? 0),
    }),
    {
      fondoFijoInicial: 0,
      totalVentas: 0,
      totalPorMedio: { efectivo: 0, tarjeta: 0, credito: 0, transferencia: 0, pedido_web: 0, mayorista: 0 },
      totalRetiros: 0,
      totalIngresos: 0,
      efectivoEsperado: 0,
      efectivoContado: 0,
    }
  );

  res.json({ dias, totalGeneral });
});

// --- Retiro / ingreso de caja ---
// Plata que sale o entra en efectivo del cajón durante el turno sin ser
// parte de una venta (ej. pagarle a un proveedor que llega con mercadería
// a mitad del día, o el dueño reforzando el cambio) — mismo patrón de
// autorización que anular una venta (clave de supervisor + quién
// autoriza) para los dos tipos, porque es plata moviéndose sin que quede
// un comprobante de venta de por medio.
const registrarRetiroSchema = z.object({
  tipo: z.enum(["retiro", "ingreso"]).default("retiro"),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  motivo: z.string().trim().min(1, "Falta el motivo"),
  usuarioId: z.number().int().positive(),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

cajaRouter.post("/sesiones/:id/retiros", async (req, res) => {
  const sesionId = Number(req.params.id);
  const parsed = registrarRetiroSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { tipo, monto, motivo, usuarioId, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesion = await prisma.sesionCaja.findUnique({ where: { id: sesionId } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (sesion.estado !== "abierta") return res.status(400).json({ error: "Esta caja ya está cerrada" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const retiro = await prisma.retiroCaja.create({
    data: { sesionCajaId: sesionId, tipo, monto, motivo: motivo.trim(), usuarioAutorizoId: usuarioId },
    include: { usuarioAutorizo: true },
  });

  res.status(201).json(retiro);
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

  // Punto de Venta deja siempre un "carrito vacío" listo para la próxima
  // venta (ver iniciarVenta en PuntoDeVenta.tsx) — al final del día eso
  // deja casi siempre una Venta "abierta" sin ningún producto, que no es
  // una venta real pendiente. Si es genuinamente vacía (nunca se le agregó
  // nada), se descarta sola acá, sin pedir nada — no hay ningún dato real
  // que perder. Solo bloquea el cierre si tiene algún ítem real (aunque
  // esté anulado, porque ahí sí hubo actividad que alguien ya autorizó).
  // Con "caja auxiliar" puede haber más de una venta abierta a la vez (ver
  // Venta.esAuxiliar), así que se revisan todas, no solo la primera.
  const ventasAbiertas = await prisma.venta.findMany({
    where: { sesionCajaId: id, estado: "abierta" },
    include: { items: true },
  });
  const conItems = ventasAbiertas.filter((v) => v.items.length > 0);
  if (conItems.length > 0) {
    return res.status(400).json({
      error:
        conItems.length === 1
          ? "Hay una venta sin terminar — confírmala o cancélala antes de cerrar la caja"
          : `Hay ${conItems.length} ventas sin terminar (incluida al menos una caja auxiliar) — confírmalas o cancélalas antes de cerrar la caja`,
    });
  }
  for (const v of ventasAbiertas) {
    await prisma.venta.delete({ where: { id: v.id } });
  }

  await prisma.sesionCaja.update({
    where: { id },
    data: { estado: "cerrada", efectivoContado, fechaCierre: new Date(), usuarioCierreId: usuarioId },
  });

  const sesionActualizada = await prisma.sesionCaja.findUnique({ where: { id } });
  const resumen = await calcularResumenSesion(id);
  const efectivoEsperado =
    sesionActualizada!.fondoFijoInicial + resumen.totalPorMedio.efectivo - resumen.totalRetiros + resumen.totalIngresos;

  res.json({
    sesion: sesionActualizada,
    ...resumen,
    efectivoEsperado,
    diferencia: efectivoContado - efectivoEsperado,
  });
});

// Ventas abiertas (con ítems reales) de UNA sesión puntual, de cualquier
// canal — a diferencia de "/ventas/abierta(s)" (que solo miran la sesión
// ACTUAL y solo canal "local", pensadas para Punto de Venta), esta sirve
// para que "Cerrar caja" pueda mostrarle al usuario exactamente qué venta(s)
// le están bloqueando el cierre y dejarlo cancelarlas ahí mismo — antes, si
// la venta bloqueante era de Caja Online o Venta Mayorista, quedaba
// invisible para el cajero (esas pantallas solo encuentran su propia venta
// a través de su propio flujo, no hay forma de "buscarla" a mano).
cajaRouter.get("/sesiones/:id/ventas-abiertas", async (req, res) => {
  const id = Number(req.params.id);
  const ventas = await prisma.venta.findMany({
    where: { sesionCajaId: id, estado: "abierta" },
    include: { items: { include: { producto: true } }, pagos: true },
    orderBy: { id: "asc" },
  });
  // Mismo criterio que el cierre (ver arriba): un carrito vacío que Punto de
  // Venta deja listo para la próxima venta no es una venta real pendiente.
  res.json(ventas.filter((v) => v.items.length > 0));
});

const dividirSesionSchema = z.object({
  corte: z.coerce.date(),
  usuarioId: z.number().int().positive(),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

// Divide una caja ABIERTA en dos, en la hora que se elija: todo lo vendido
// (y los retiros/ingresos) desde que se abrió hasta "corte" queda en una
// sesión nueva, ya cerrada, representando el día anterior; la sesión
// original sigue abierta pero con su fechaApertura adelantada a "corte", así
// que de ahí en adelante representa solo el día de hoy. Pensado para cuando
// a alguien se le olvidó cerrar la caja y se siguió vendiendo después de
// medianoche — sin esto, todo quedaba mezclado en un solo cierre X/Z, sin
// forma de separar cuánto fue de cada día.
//
// Deliberadamente NO reasigna PagoVenta.sesionCajaCobroId (créditos o
// transferencias de OTRA venta que se cobraron durante este turno) — ese
// caso (alguien pagando un fiado viejo a la 1 AM) es extremadamente raro acá
// y agregarlo complica bastante la lógica para un caso límite que en la
// práctica no pasa; si llega a pasar, el cobro queda contado en el día en
// que se dividió, corregible a mano si hace falta.
cajaRouter.post("/sesiones/:id/dividir", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = dividirSesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { corte, usuarioId, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const sesion = await prisma.sesionCaja.findUnique({ where: { id } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (sesion.estado !== "abierta") return res.status(400).json({ error: "Solo se puede dividir una caja que sigue abierta" });
  if (corte <= sesion.fechaApertura) {
    return res.status(400).json({ error: "La hora de corte tiene que ser después de cuándo se abrió la caja" });
  }
  if (corte >= new Date()) {
    return res.status(400).json({ error: "La hora de corte tiene que ser anterior a ahora" });
  }

  const cantidadAntesDelCorte = await prisma.venta.count({
    where: { sesionCajaId: id, fecha: { lt: corte } },
  });
  if (cantidadAntesDelCorte === 0) {
    return res.status(400).json({ error: "No hay ninguna venta antes de esa hora — no hay nada que dividir" });
  }

  const sesionAnterior = await prisma.$transaction(async (tx) => {
    const nueva = await tx.sesionCaja.create({
      data: {
        usuarioAperturaId: sesion.usuarioAperturaId,
        fondoFijoInicial: sesion.fondoFijoInicial,
        fechaApertura: sesion.fechaApertura,
        estado: "cerrada",
        usuarioCierreId: usuarioId,
        fechaCierre: corte,
      },
    });

    await tx.venta.updateMany({
      where: { sesionCajaId: id, fecha: { lt: corte } },
      data: { sesionCajaId: nueva.id },
    });
    await tx.retiroCaja.updateMany({
      where: { sesionCajaId: id, fecha: { lt: corte } },
      data: { sesionCajaId: nueva.id },
    });

    await tx.sesionCaja.update({ where: { id }, data: { fechaApertura: corte } });

    return nueva;
  });

  const sesionActual = await prisma.sesionCaja.findUnique({ where: { id } });
  const resumenAnterior = await calcularResumenSesion(sesionAnterior.id);
  const resumenActual = await calcularResumenSesion(id);
  const efectivoEsperadoAnterior =
    sesionAnterior.fondoFijoInicial + resumenAnterior.totalPorMedio.efectivo - resumenAnterior.totalRetiros + resumenAnterior.totalIngresos;
  const efectivoEsperadoActual =
    sesionActual!.fondoFijoInicial + resumenActual.totalPorMedio.efectivo - resumenActual.totalRetiros + resumenActual.totalIngresos;

  res.json({
    sesionAnterior: {
      sesion: sesionAnterior,
      ...resumenAnterior,
      efectivoEsperado: efectivoEsperadoAnterior,
      // Nadie contó efectivo físico en este momento (es un corte retroactivo,
      // no un cierre real) — queda sin diferencia, igual que cualquier
      // sesión con efectivoContado null (ver /resumen).
      diferencia: null,
    },
    sesionActual: {
      sesion: sesionActual,
      ...resumenActual,
      efectivoEsperado: efectivoEsperadoActual,
      diferencia: null,
    },
  });
});

// --- Ventas ---

// Buscar ventas confirmadas (pagadas) por rango de fechas y/o N° de venta —
// para la pantalla "Buscar venta" (ver detalle / reimprimir un vale). También
// sirve para el panel de "últimas ventas" en Punto de Venta, pasando
// sesionCajaId + limit en vez de un rango de fechas (la sesión ya acota el
// período, no tiene sentido pedirle también un rango).
cajaRouter.get("/ventas", async (req, res) => {
  const ventaId = req.query.ventaId ? Number(req.query.ventaId) : undefined;
  const sesionCajaId = req.query.sesionCajaId ? Number(req.query.sesionCajaId) : undefined;
  const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit), 1), 200) : 200;

  let filtro: { id?: number; sesionCajaId?: number; fecha?: { gte: Date; lte: Date } };
  if (ventaId) {
    filtro = { id: ventaId };
  } else if (sesionCajaId) {
    filtro = { sesionCajaId };
  } else {
    const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
    filtro = { fecha: { gte: desde, lte: hasta } };
  }

  const ventas = await prisma.venta.findMany({
    where: { estado: "pagada", ...filtro },
    include: { usuario: true, items: true, pagos: true },
    orderBy: { fecha: "desc" },
    take: limit,
  });
  res.json(ventas);
});

// canal: "local" — SIN esto, una venta mayorista u online abierta en la
// misma sesión de caja (comparten SesionCaja con el mesón) podía quedar
// seleccionada acá como si fuera la venta del mesón, dejando que un
// escaneo o cobro del mesón cayera encima de esa venta ajena. Punto de
// Venta solo debe ver/crear ventas de canal "local" — Caja Online y Venta
// Mayorista tienen su propio flujo para encontrar su venta.
cajaRouter.get("/ventas/abierta", async (_req, res) => {
  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.json(null);

  const venta = await prisma.venta.findFirst({
    where: { sesionCajaId: sesion.id, estado: "abierta", canal: "local" },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(venta);
});

// Todas las ventas abiertas de la sesión actual, no solo la primera — ver
// "Caja auxiliar" (Venta.esAuxiliar): el cajero puede tener más de una
// venta en curso a la vez (ej. una esperando que se confirme una
// transferencia, mientras cobra otra). Debe ir ANTES de "/ventas/:id" en
// las rutas (si no, Express intentaría matchear "abiertas" como el id).
// canal: "local" — mismo motivo que en "/ventas/abierta" arriba.
cajaRouter.get("/ventas/abiertas", async (_req, res) => {
  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.json([]);

  const ventas = await prisma.venta.findMany({
    where: { sesionCajaId: sesion.id, estado: "abierta", canal: "local" },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
    orderBy: { id: "asc" },
  });
  res.json(ventas);
});

cajaRouter.get("/ventas/:id", async (req, res) => {
  const venta = await prisma.venta.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      items: { include: { producto: true, usuarioAnulacion: true } },
      pagos: true,
      usuario: true,
      comuna: true,
      usuarioAnulacion: true,
    },
  });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  res.json(venta);
});

const crearVentaSchema = z.object({
  usuarioId: z.number().int().positive(),
  // "Caja auxiliar" — si es true, se salta el bloqueo de "ya hay una venta
  // en curso" y crea una segunda venta abierta a propósito (ver comentario
  // de Venta.esAuxiliar en el schema). Sin este flag, el bloqueo se
  // mantiene igual que siempre: es la red de seguridad contra un doble
  // llamado accidental (ej. la pantalla se cargó dos veces).
  auxiliar: z.boolean().optional(),
});

cajaRouter.post("/ventas", async (req, res) => {
  const parsed = crearVentaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, auxiliar } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta" });

  if (!auxiliar) {
    // canal: "local" — sin esto, una venta mayorista u online abierta en la
    // misma sesión se confundía con "ya hay una venta de mesón en curso" y
    // bloqueaba (o peor, apuntaba) al cajero hacia esa venta ajena.
    const yaAbierta = await prisma.venta.findFirst({ where: { sesionCajaId: sesion.id, estado: "abierta", canal: "local" } });
    if (yaAbierta) return res.status(409).json({ error: "Ya hay una venta en curso", ventaId: yaAbierta.id });
  }

  const venta = await prisma.venta.create({
    data: { sesionCajaId: sesion.id, usuarioId, esAuxiliar: !!auxiliar },
    include: { items: true, pagos: true, comuna: true },
  });
  res.status(201).json(venta);
});

// --- Caja Online: pistolear un pedido web ---
//
// Reemplaza al viejo "Enviar a Caja" (armaba la venta de un tirón desde el
// texto del pedido y la dejaba pagada al toque) — causaba que el mismo
// pedido quedara cobrado DOS veces: una vez de verdad en el mesón
// (pistoleando, como cualquier venta) y otra vez acá, armada sola desde el
// pedido. Ahora el pedido lleva a esta pantalla, donde se pistolea de
// verdad (misma venta — ver abajo, con esAuxiliar:true para no bloquear la
// caja del mesón) y recién al final se decide si queda pendiente de pago
// (lo normal, ver POST /ventas/:id/pagos con medio "pedido_web") o si ya
// se cobró.
const crearVentaDesdePedidoWebSchema = z.object({ usuarioId: z.number().int().positive() });

cajaRouter.post("/ventas/desde-pedido-web/:pedidoId", async (req, res) => {
  const pedidoId = Number(req.params.pedidoId);
  const parsed = crearVentaDesdePedidoWebSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const pedido = await prisma.pedidoWeb.findUnique({ where: { id: pedidoId }, include: { ventaGenerada: true } });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  if (pedido.estado === "anulado") return res.status(400).json({ error: "Este pedido está anulado" });

  // Idempotente a propósito: si alguien ya empezó a pistolear este pedido
  // (ej. se recargó la pantalla, o dos personas le hicieron clic casi al
  // mismo tiempo), se reusa esa misma venta en vez de crear una segunda —
  // es la protección real contra el duplicado que motivó este cambio. Esto
  // tiene que revisarse ANTES de "ya se cobró" de abajo: la relación
  // pedido.ventaGenerada apunta a cualquier Venta ligada a este pedido sin
  // importar su estado, así que una venta todavía "abierta" (a medio
  // pistolear, sin pagar) también aparece ahí — si no se revisa esto
  // primero, nunca se podría retomar una venta en curso.
  if (pedido.ventaGenerada?.estado === "abierta") {
    const yaEnCurso = await prisma.venta.findUnique({
      where: { id: pedido.ventaGenerada.id },
      include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
    });
    return res.json(yaEnCurso);
  }
  if (pedido.ventaGenerada) {
    return res.status(400).json({ error: `Este pedido ya se cobró — venta #${pedido.ventaGenerada.id}` });
  }

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta — ábrela primero" });

  // Si el nombre de la comuna del pedido ya no calza con ninguna del
  // catálogo (ej. el dueño la renombró/corrigió en Configuración después de
  // que este pedido quedó pendiente, o se eliminó), NO se bloquea la venta
  // — mismo criterio que cuando el pedido no trae comuna: queda sin
  // comunaId, y "Pedidos web" ya avisa "comuna sin listado, completar a
  // mano" para ese caso. Antes esto respondía 400 y el pedido quedaba
  // atascado en Pendientes sin ninguna forma de pistolearlo.
  let comunaId: number | null = null;
  if (pedido.tipoEntrega === "despacho" && pedido.comunaNombre) {
    const comuna = await prisma.comuna.findUnique({ where: { nombre: pedido.comunaNombre } });
    comunaId = comuna?.id ?? null;
  }

  try {
    const venta = await prisma.venta.create({
      data: {
        sesionCajaId: sesion.id,
        usuarioId,
        esAuxiliar: true,
        canal: "online",
        origenPedidoWebId: pedido.id,
        comentario: pedido.comentario,
        esDespacho: pedido.tipoEntrega === "despacho",
        comunaId,
        costoEnvio: pedido.tipoEntrega === "despacho" ? pedido.costoEnvio : null,
        descuentoTipo: pedido.descuentoTipo === "monto" ? "monto_fijo" : pedido.descuentoTipo,
        descuentoValor: pedido.descuentoValor,
      },
      include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
    });
    res.status(201).json(venta);
  } catch (e) {
    // Dos clics (casi) simultáneos pueden pasar ambos el chequeo de arriba
    // antes de que cualquiera termine de crear la venta — origenPedidoWebId
    // es @unique en el schema, así que el segundo create choca con esa
    // restricción en vez de duplicar. En ese caso, no es un error real: se
    // devuelve la venta que el otro clic ya creó, mismo resultado que el
    // chequeo de "yaEnCurso" de arriba.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const venta = await prisma.venta.findUnique({
        where: { origenPedidoWebId: pedido.id },
        include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
      });
      if (venta) return res.json(venta);
    }
    throw e;
  }
});

// --- Venta Mayorista ---
//
// A pedido del usuario, para reemplazar la calculadora en Excel que usaba
// su papá: arma un pedido de varias líneas (cualquier producto del
// catálogo, a precio neto negociado línea por línea, no el precio de
// venta normal) y al cobrar aplica el % de la categoría de cada producto
// (ver Categoria.porcentajeCobroMayorista) sobre su propio subtotal neto —
// igual que las 15 filas de ese Excel, donde cada producto tenía su propio
// % según fuera pollo o cerdo. Es una Venta real (canal "mayorista",
// esAuxiliar para no bloquear la caja del mesón) para que el stock, Caja,
// Cuadratura y Reportes la traten igual que cualquier otra — ver
// confirmarVenta más abajo para cómo se descuenta el stock según el
// origen de cada línea (sala de venta o una caja puntual de Cámara).
// A diferencia de Punto de Venta (que resume su venta abierta solo al
// recargar la pantalla) y de Caja Online (atada a un pedido web, así que
// siempre se resuelve al mismo pedidoId), esta pantalla no tenía ninguna
// forma de volver a encontrar una venta mayorista que ya estaba en curso:
// si el cajero salía a atender la caja a mitad de armarla, perdía el
// estado de React local y, al volver, lo único que podía hacer era tocar
// "Iniciar venta mayorista" de nuevo — creando una venta nueva y dejando
// la anterior (con sus líneas ya cargadas) abierta para siempre, sin
// forma de recuperarla salvo cancelarla a mano desde el panel de "Cerrar
// caja". Este endpoint permite que la pantalla busque esa venta antes de
// mostrar el botón de "Iniciar".
cajaRouter.get("/ventas/mayorista/abierta", async (req, res) => {
  const usuarioId = Number(req.query.usuarioId);
  if (!usuarioId) return res.status(400).json({ error: "Falta usuarioId" });

  const venta = await prisma.venta.findFirst({
    where: { estado: "abierta", canal: "mayorista", usuarioId },
    include: { items: { include: { producto: true, usuarioAnulacion: true, cajaCamara: true } }, pagos: true, comuna: true },
    orderBy: { id: "desc" },
  });
  res.json(venta);
});

const crearVentaMayoristaSchema = z.object({ usuarioId: z.number().int().positive() });

cajaRouter.post("/ventas/mayorista", async (req, res) => {
  const parsed = crearVentaMayoristaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta — ábrela primero" });

  // A diferencia de /ventas/desde-pedido-web/:pedidoId, este endpoint NO es
  // idempotente — siempre crea una venta nueva. La pantalla (VentaMayorista.
  // tsx) es la que debe revisar GET /ventas/mayorista/abierta ANTES de
  // llamar a este endpoint, y solo mostrar el botón de "Iniciar" (que
  // termina acá) cuando esa búsqueda no encontró ninguna en curso.
  const venta = await prisma.venta.create({
    data: { sesionCajaId: sesion.id, usuarioId, esAuxiliar: true, canal: "mayorista" },
    include: { items: { include: { producto: true, usuarioAnulacion: true, cajaCamara: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(venta);
});

const agregarItemMayoristaSchema = z
  .object({
    usuarioId: z.number().int().positive(),
    // Producto ya en el catálogo, o datos mínimos para crear uno al vuelo
    // si todavía no existe — mismo criterio que "crear rápido" al
    // escanear en Caja (ver POST /ventas/:id/items/crear-rapido), pero sin
    // código de barras: acá nunca se pistolea, el producto se elige a
    // mano. Queda creadoRapido:true para completarlo después.
    productoId: z.number().int().positive().optional(),
    productoNuevo: z
      .object({
        descripcion: z.string().trim().min(1, "Falta la descripción"),
        categoriaId: z.number().int().positive("Falta la categoría"),
        flagBalanza: z.enum(["NORMAL", "PESABLE"]).default("PESABLE"),
      })
      .optional(),
    cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
    precioNetoUnitario: z.number().positive("El precio neto debe ser mayor a 0"),
    // De dónde sale físicamente esta línea: el stock general de sala de
    // venta (se descuenta Producto.stockActual, igual que cualquier venta)
    // o una caja puntual de Cámara (se descuenta esa caja) — ver
    // confirmarVenta. Una misma Venta Mayorista puede mezclar líneas de
    // los dos orígenes.
    origen: z.enum(["sala_venta", "camara"]),
    cajaCamaraId: z.number().int().positive().optional(),
  })
  .refine((d) => d.productoId != null || d.productoNuevo != null, {
    message: "Falta elegir o crear el producto",
    path: ["productoId"],
  })
  .refine((d) => d.origen !== "camara" || d.cajaCamaraId != null, {
    message: "Falta elegir de qué caja de cámara sale",
    path: ["cajaCamaraId"],
  });

cajaRouter.post("/ventas/:id/items/mayorista", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarItemMayoristaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, productoId, productoNuevo, cantidad, precioNetoUnitario, origen, cajaCamaraId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  let producto = productoId ? await prisma.producto.findUnique({ where: { id: productoId } }) : null;
  if (productoId && !producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (!producto && productoNuevo) {
    const categoria = await prisma.categoria.findUnique({ where: { id: productoNuevo.categoriaId } });
    if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

    producto = await prisma.producto.create({
      data: {
        plu: await calcularProximoPlu(),
        descripcion: productoNuevo.descripcion,
        categoriaId: productoNuevo.categoriaId,
        flagBalanza: productoNuevo.flagBalanza,
        // Sin un precio de venta normal mejor que adivinar, se parte del
        // mismo precio neto negociado — se corrige después en Productos →
        // Revisión rápida, igual que cualquier producto creadoRapido.
        precio: precioNetoUnitario,
        precioMayor: precioNetoUnitario,
        creadoRapido: true,
      },
    });
    void sincronizarCatalogoConWeb();
  }
  if (!producto) return res.status(400).json({ error: "Falta elegir o crear el producto" });

  let cajaCamara = null;
  if (origen === "camara") {
    cajaCamara = await prisma.cajaCamara.findUnique({ where: { id: cajaCamaraId! }, include: { producto: true } });
    if (!cajaCamara) return res.status(404).json({ error: "Caja de cámara no encontrada" });
    if (cajaCamara.productoId !== producto.id) {
      return res
        .status(400)
        .json({ error: `Esa caja tiene "${cajaCamara.producto.descripcion}", no "${producto.descripcion}"` });
    }
    if (cajaCamara.estado === "salida" || cajaCamara.estado === "anulada") {
      return res.status(400).json({ error: "Esa caja ya no tiene saldo disponible" });
    }
    if (cantidad > cajaCamara.saldoKg + 0.0005) {
      return res.status(400).json({ error: `Esa caja solo tiene ${cajaCamara.saldoKg} kg disponibles` });
    }
  }

  const categoriaRaiz = await obtenerCategoriaRaiz(producto.categoriaId);
  if (categoriaRaiz.porcentajeCobroMayorista == null) {
    return res.status(400).json({
      error: `La categoría "${categoriaRaiz.nombre}" todavía no tiene configurado su % de cobro mayorista — configúralo en Categorías antes de vender este producto al por mayor`,
    });
  }

  const subtotalNeto = Math.round(precioNetoUnitario * cantidad);
  const subtotal = Math.round(subtotalNeto * (1 + categoriaRaiz.porcentajeCobroMayorista));
  const precioUnitario = cantidad > 0 ? Math.round(subtotal / cantidad) : subtotal;

  await prisma.itemVenta.create({
    data: {
      ventaId,
      productoId: producto.id,
      cantidad,
      precioUnitario,
      subtotal,
      precioNetoUnitario,
      porcentajeCobro: categoriaRaiz.porcentajeCobroMayorista,
      cajaCamaraId: origen === "camara" ? cajaCamaraId : null,
    },
  });
  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true, cajaCamara: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(ventaActualizada);
});

const comentarioSchema = z.object({
  comentario: z.string().trim().max(500, "El comentario es muy largo").optional().nullable(),
});

// Comentario libre y opcional sobre la venta (ej. "cliente pidió sin
// hueso") — no afecta el total, solo queda guardado y se muestra en el vale.
cajaRouter.put("/ventas/:id/comentario", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = comentarioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  await prisma.venta.update({
    where: { id: ventaId },
    data: { comentario: parsed.data.comentario?.trim() || null },
  });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
});

const descuentoSchema = z
  .object({
    tipo: z.enum(["porcentaje", "monto_fijo"]).nullable(),
    valor: z.number().positive().nullable(),
  })
  .refine((d) => (d.tipo === null) === (d.valor === null), {
    message: "Falta el valor del descuento",
  })
  .refine((d) => d.tipo !== "porcentaje" || (d.valor ?? 0) <= 100, {
    message: "El descuento en porcentaje no puede ser mayor a 100",
  });

// Descuento manual (opcional): reemplaza el descuento actual de la venta —
// mandar tipo/valor en null lo quita. Solo aplica sobre el subtotal de los
// productos, no sobre el costo de envío (ver recalcularTotal).
cajaRouter.put("/ventas/:id/descuento", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = descuentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const venta = await prisma.venta.findUnique({ where: { id: ventaId }, include: { items: true } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  // Solo puede haber un tipo de descuento activo por venta — o a toda la
  // venta, o por producto — para que el registro de qué se descontó sea
  // claro. No aplica al quitar el descuento (tipo null).
  if (parsed.data.tipo !== null && venta.items.some((i) => !i.anulado && i.descuentoTipo)) {
    return res.status(400).json({
      error: "Ya hay descuentos aplicados a productos individuales — quítalos primero para descontar toda la venta",
    });
  }

  await prisma.venta.update({
    where: { id: ventaId },
    data: { descuentoTipo: parsed.data.tipo, descuentoValor: parsed.data.valor },
  });
  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
});

const descuentoItemSchema = z
  .object({
    tipo: z.enum(["porcentaje", "monto_fijo"]).nullable(),
    valor: z.number().positive().nullable(),
  })
  .refine((d) => (d.tipo === null) === (d.valor === null), {
    message: "Falta el valor del descuento",
  })
  .refine((d) => d.tipo !== "porcentaje" || (d.valor ?? 0) <= 100, {
    message: "El descuento en porcentaje no puede ser mayor a 100",
  });

// Descuento por producto (opcional): alternativo al descuento de toda la
// venta — no pueden estar activos los dos a la vez (ver PUT
// /ventas/:id/descuento). El subtotal del ítem queda ya con el descuento
// aplicado, redondeado a peso entero.
cajaRouter.put("/ventas/:id/items/:itemId/descuento", async (req, res) => {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const parsed = descuentoItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  const item = await prisma.itemVenta.findUnique({ where: { id: itemId } });
  if (!item || item.ventaId !== ventaId) return res.status(404).json({ error: "Ítem no encontrado" });
  if (item.anulado) return res.status(400).json({ error: "Este producto ya fue anulado" });

  if (parsed.data.tipo !== null && venta.descuentoTipo) {
    return res.status(400).json({
      error: "Ya hay un descuento aplicado a toda la venta — quítalo primero para descontar productos individuales",
    });
  }

  const subtotalSinDescuento = Math.round(item.precioUnitario * item.cantidad);
  let descuentoMonto = 0;
  if (parsed.data.tipo === "porcentaje" && parsed.data.valor) {
    descuentoMonto = Math.round(subtotalSinDescuento * (parsed.data.valor / 100));
  } else if (parsed.data.tipo === "monto_fijo" && parsed.data.valor) {
    descuentoMonto = parsed.data.valor;
  }
  descuentoMonto = Math.min(descuentoMonto, subtotalSinDescuento);

  await prisma.itemVenta.update({
    where: { id: itemId },
    data: {
      descuentoTipo: parsed.data.tipo,
      descuentoValor: parsed.data.valor,
      subtotal: subtotalSinDescuento - descuentoMonto,
    },
  });
  await recalcularTotal(ventaId);

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
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

// Un combo no tiene stock propio (ver comentario de Producto.esCombo) — al
// confirmar o anular una venta, su línea se reemplaza por la de sus
// componentes (cantidad de la receta × cuántos combos), sumando con
// cualquier otra línea que mueva el mismo producto (ej. el mismo
// componente también vendido suelto en la misma venta). Se usa tanto al
// confirmar (descontar stock) como al anular (devolverlo), para que ambos
// muevan exactamente lo mismo.
async function expandirCombos(cantidadPorProducto: Map<number, number>): Promise<Map<number, number>> {
  const resultado = new Map<number, number>();
  for (const [productoId, cantidad] of cantidadPorProducto) {
    const producto = await prisma.producto.findUnique({
      where: { id: productoId },
      include: { componentesDelCombo: true },
    });
    if (producto?.esCombo) {
      for (const componente of producto.componentesDelCombo) {
        const actual = resultado.get(componente.componenteProductoId) ?? 0;
        resultado.set(componente.componenteProductoId, actual + componente.cantidad * cantidad);
      }
    } else {
      const actual = resultado.get(productoId) ?? 0;
      resultado.set(productoId, actual + cantidad);
    }
  }
  return resultado;
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

  // No se bloquea por falta de stock — a veces el producto físico está
  // disponible pero el stock del sistema todavía no refleja una entrada
  // reciente (ej. una res recién despostada). El stock puede quedar
  // negativo y se corrige después con un ajuste manual en Inventario.

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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(ventaActualizada);
});

// --- Crear producto rápido (código escaneado sin match) y agregarlo ---
// Cuando el código no calza con ningún producto (ni EAN ni PLU/peso de
// balanza), en vez de dejar al cajero sin poder cobrar el producto, se crea
// uno con los datos mínimos (descripción, precio, categoría) para poder
// seguir la venta al tiro. Queda marcado creadoRapido=true para
// completarlo después en Productos → "Revisión rápida" (PLU, marca,
// código de barras real, etc.) sin bloquear la caja en el momento.
const crearProductoRapidoSchema = z.object({
  codigo: z.string().trim().min(1, "Falta el código escaneado"),
  descripcion: z.string().trim().min(1, "Falta la descripción"),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  categoriaId: z.number().int().positive("Falta la categoría"),
});

cajaRouter.post("/ventas/:id/items/crear-rapido", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = crearProductoRapidoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { codigo, descripcion, precio, categoriaId } = parsed.data;

  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: codigo } });
  if (eanExistente) {
    return res.status(409).json({ error: `Ese código ya lo tiene "${eanExistente.descripcion}" — vuelve a escanearlo` });
  }

  const producto = await prisma.producto.create({
    data: {
      plu: await calcularProximoPlu(),
      descripcion,
      categoriaId,
      precio,
      flagBalanza: "NORMAL",
      codigoBarras: codigo,
      creadoRapido: true,
    },
  });
  void sincronizarCatalogoConWeb();

  const errorAgregar = await agregarItemAVenta(ventaId, producto.id, 1);
  if (errorAgregar) return res.status(errorAgregar.status).json({ error: errorAgregar.error });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.status(201).json(ventaActualizada);
});

export async function recalcularTotal(ventaId: number) {
  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  const items = await prisma.itemVenta.findMany({ where: { ventaId, anulado: false } });
  const subtotalItems = items.reduce((suma, i) => suma + i.subtotal, 0);

  let descuentoMonto = 0;
  if (venta?.descuentoTipo === "porcentaje" && venta.descuentoValor) {
    descuentoMonto = Math.round(subtotalItems * (venta.descuentoValor / 100));
  } else if (venta?.descuentoTipo === "monto_fijo" && venta.descuentoValor) {
    descuentoMonto = venta.descuentoValor;
  }
  descuentoMonto = Math.min(descuentoMonto, subtotalItems);

  const total = subtotalItems - descuentoMonto + (venta?.costoEnvio ?? 0);
  await prisma.venta.update({ where: { id: ventaId }, data: { total } });
}

const anularItemSchema = z.object({
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
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

  // usuarioId es quien anula (elegido en el momento, con su clave) — no
  // necesariamente el usuario con la sesión de caja abierta, para que el
  // registro quede a nombre de quien realmente autorizó la anulación.
  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const item = await prisma.itemVenta.findUnique({ where: { id: itemId } });
  if (!item || item.ventaId !== ventaId) return res.status(404).json({ error: "Ítem no encontrado" });

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta || venta.estado !== "abierta") {
    return res.status(400).json({ error: "Esta venta ya no admite cambios" });
  }

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(ventaActualizada);
});

const agregarPagoSchema = z
  .object({
    medio: z.enum(["efectivo", "tarjeta", "credito", "transferencia", "pedido_web", "mayorista"]),
    monto: z.number().positive("El monto debe ser mayor a 0"),
    // Crédito y transferencia necesitan un Cliente ya registrado (ver
    // selector de cliente en Punto de Venta) — reemplaza el nombre libre
    // que se escribía antes, para no duplicar al mismo cliente por typos.
    // "pedido_web" no lo necesita acá: se resuelve solo desde el pedido
    // ligado a la venta (ver más abajo), salvo que se mande explícito.
    // "mayorista" también es opcional: no siempre hay un cliente cargado
    // para una venta al por mayor.
    clienteId: z.number().int().positive().optional().nullable(),
    // Solo tiene sentido en efectivo: lo que el cliente entregó en la mano,
    // antes del tope/redondeo aplicado a "monto" — para poder mostrar en el
    // vale con cuánto pagó y el vuelto correspondiente.
    montoEntregado: z.number().positive().optional(),
  })
  .refine((data) => (data.medio !== "credito" && data.medio !== "transferencia") || !!data.clienteId, {
    message: "Falta seleccionar el cliente",
    path: ["clienteId"],
  });

cajaRouter.post("/ventas/:id/pagos", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = agregarPagoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { medio, monto, clienteId, montoEntregado } = parsed.data;

  const venta = await prisma.venta.findUnique({ where: { id: ventaId } });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya no admite cambios" });

  let cliente = null;
  if (medio === "credito" || medio === "transferencia") {
    cliente = await prisma.cliente.findUnique({ where: { id: clienteId! } });
    if (!cliente) return res.status(400).json({ error: "El cliente seleccionado no existe" });
  } else if (medio === "pedido_web") {
    // Pendiente de pago de un pedido online (ver Caja Online) — el cliente
    // se resuelve solo desde el pedido ligado a esta venta (mismo teléfono
    // de siempre = mismo Cliente, igual que hacía el viejo "Enviar a
    // Caja"), para no tener que elegirlo a mano cada vez. Si se manda
    // clienteId explícito (caso raro), ese manda.
    if (clienteId) {
      cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cliente) return res.status(400).json({ error: "El cliente seleccionado no existe" });
    } else if (venta.origenPedidoWebId) {
      const pedido = await prisma.pedidoWeb.findUnique({ where: { id: venta.origenPedidoWebId } });
      if (pedido) {
        cliente = await prisma.cliente.findFirst({ where: { telefono: pedido.clienteTelefono } });
        if (!cliente) {
          cliente = await prisma.cliente.create({ data: { nombre: pedido.clienteNombre, telefono: pedido.clienteTelefono } });
        }
      }
    }
  } else if (medio === "mayorista" && clienteId) {
    cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return res.status(400).json({ error: "El cliente seleccionado no existe" });
  }

  await prisma.pagoVenta.create({
    data: {
      ventaId,
      medio,
      monto,
      clienteId: cliente?.id ?? null,
      // Copia del nombre al momento de este pago (ver comentario en el
      // schema) — así el vale/historial no dependen de que el Cliente siga
      // existiendo con el mismo nombre después.
      clienteNombre: cliente?.nombre ?? null,
      montoEntregado: medio === "efectivo" ? montoEntregado ?? null : null,
    },
  });

  const ventaActualizada = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
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
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado !== "abierta") return res.status(400).json({ error: "Esta venta ya fue procesada" });

  const itemsActivos = venta.items.filter((i) => !i.anulado);
  if (itemsActivos.length === 0) {
    return res.status(400).json({ error: "La venta no tiene productos" });
  }

  // Un pago en efectivo se cobra redondeado a la decena más cercana (Ley
  // del Redondeo, ver redondearA10 en web/src/api.ts) — puede dejar hasta
  // $5 de diferencia contra el total exacto, que no es un error sino el
  // redondeo legal. Esa tolerancia solo se acepta si la venta tiene algún
  // pago en efectivo; el resto de los medios de pago siguen exigiendo el
  // monto exacto.
  const hayPagoEfectivo = venta.pagos.some((p) => p.medio === "efectivo");
  const tolerancia = hayPagoEfectivo ? 5.01 : 0.01;
  const totalPagado = venta.pagos.reduce((suma, p) => suma + p.monto, 0);
  if (Math.abs(totalPagado - venta.total) > tolerancia) {
    return res.status(400).json({
      error: `Los pagos ($${totalPagado}) no coinciden con el total de la venta ($${venta.total})`,
    });
  }

  // Venta Mayorista: una línea con cajaCamaraId sale de una caja puntual de
  // Cámara, no del stock general de sala de venta — se descuenta aparte
  // (más abajo) y queda fuera de cantidadPorProducto/expandirCombos/FEFO,
  // que siguen siendo solo para lo que sí sale de sala de venta. Cualquier
  // venta que no sea mayorista no tiene ninguna línea con cajaCamaraId, así
  // que este filtro no le cambia nada.
  const itemsDeCamara = itemsActivos.filter((i) => i.cajaCamaraId != null);
  const itemsDeSalaVenta = itemsActivos.filter((i) => i.cajaCamaraId == null);

  // Suma por producto, por si el mismo producto se agregó más de una vez.
  const cantidadPorProducto = new Map<number, number>();
  for (const item of itemsDeSalaVenta) {
    cantidadPorProducto.set(item.productoId, (cantidadPorProducto.get(item.productoId) ?? 0) + item.cantidad);
  }

  // Se agrupa por caja (en vez de por línea) por si la misma caja aparece
  // en más de una línea, y se revalida el saldo ACTUAL — puede haber
  // cambiado desde que se agregó la línea (ej. otra venta mayorista sacó
  // de la misma caja mientras tanto).
  const EPSILON_KG_MAYORISTA = 0.0005;
  const cantidadPorCajaCamara = new Map<number, number>();
  for (const item of itemsDeCamara) {
    cantidadPorCajaCamara.set(item.cajaCamaraId!, (cantidadPorCajaCamara.get(item.cajaCamaraId!) ?? 0) + item.cantidad);
  }
  const cajasCamaraADescontar: { cajaId: number; saldoActual: number; pesoKg: number }[] = [];
  for (const [cajaCamaraId, pesoKg] of cantidadPorCajaCamara) {
    const caja = await prisma.cajaCamara.findUnique({ where: { id: cajaCamaraId } });
    if (!caja) return res.status(400).json({ error: "Una de las cajas de cámara de esta venta ya no existe" });
    if (caja.estado === "salida" || caja.estado === "anulada") {
      return res.status(400).json({ error: `La caja de cámara #${cajaCamaraId} ya no tiene saldo disponible` });
    }
    if (pesoKg > caja.saldoKg + EPSILON_KG_MAYORISTA) {
      return res.status(400).json({ error: `La caja de cámara #${cajaCamaraId} solo tiene ${caja.saldoKg} kg disponibles` });
    }
    cajasCamaraADescontar.push({ cajaId: caja.id, saldoActual: caja.saldoKg, pesoKg });
  }

  // No se bloquea por falta de stock (ver agregarItemAVenta) — el stock
  // puede quedar negativo y se corrige después con un ajuste manual. Esto
  // sigue siendo así para carnicería; los SKU de charcutería con formato
  // fijo (que sí trazan por lote) son la excepción: ahí SÍ se bloquea si no
  // hay stock vigente (sin vencer, sin anular) en ningún lote, porque el
  // negocio pidió explícitamente no poder vender lotes vencidos/anulados.
  //
  // FEFO: para cada producto que resulta ser el espejo de un SKU de
  // charcutería, se elige de antemano (fuera de la transacción, son solo
  // lecturas) el lote con vencimiento más próximo que alcance a cubrir toda
  // la cantidad vendida de ese producto en esta venta — nunca se reparte
  // una misma línea entre varios lotes (ver informe de cierre de fase).
  // SKU a granel (sin formatoGramos, no pasan por Envasado/StockLoteSku)
  // quedan fuera de este chequeo, igual que cualquier producto normal de
  // carnicería.
  // Si CUALQUIER producto vendido es de charcutería (businessUnitId=2 en su
  // fila espejo — ver ItemCharcuteria.productoEspejoId), la venta entera
  // queda etiquetada como charcutería para los reportes consolidados. Un
  // carro mezclado entre ambas unidades es un caso raro que no se separa
  // línea por línea (ver informe de cierre de fase).
  let esVentaCharcuteria = false;
  const loteFefoPorProducto = new Map<number, { loteId: number; stockLoteSkuId: number }>();
  for (const [productoId, cantidad] of cantidadPorProducto) {
    const producto = await prisma.producto.findUnique({ where: { id: productoId } });
    if (!producto) {
      return res.status(400).json({ error: "Uno de los productos de la venta ya no existe" });
    }
    if (producto.businessUnitId === 2) esVentaCharcuteria = true;
    const skuId = await skuCharcuteriaDeProducto(productoId);
    if (skuId != null) {
      const seleccion = await elegirLoteFefo(skuId, cantidad);
      if ("error" in seleccion) {
        return res.status(400).json({ error: `${producto.descripcion}: ${seleccion.error}` });
      }
      loteFefoPorProducto.set(productoId, seleccion);
    }
  }

  const cantidadStockPorProducto = await expandirCombos(cantidadPorProducto);

  await prisma.$transaction([
    prisma.venta.update({
      where: { id: ventaId },
      data: { estado: "pagada", ...(esVentaCharcuteria ? { businessUnitId: 2 } : {}) },
    }),
    ...Array.from(cantidadStockPorProducto.entries()).flatMap(([productoId, cantidad]) => [
      prisma.producto.update({ where: { id: productoId }, data: { stockActual: { decrement: cantidad } } }),
      prisma.movimientoInventario.create({
        data: { productoId, usuarioId, tipo: "salida", motivo: "venta", cantidad },
      }),
    ]),
    // FEFO sigue por producto SIN expandir combos — un combo armado con un
    // SKU de charcutería con lote como componente queda fuera de este
    // chequeo (igual que ya quedaba antes de este cambio): no hay una fila
    // ItemVenta propia para el componente contra la cual anotar el loteId.
    ...Array.from(loteFefoPorProducto.entries()).flatMap(([productoId, fefo]) => [
      prisma.stockLoteSku.update({
        where: { id: fefo.stockLoteSkuId },
        data: { saldoUnidades: { decrement: cantidadPorProducto.get(productoId)! } },
      }),
      prisma.itemVenta.updateMany({
        where: { ventaId, productoId, anulado: false },
        data: { loteId: fefo.loteId },
      }),
    ]),
    // Si esta venta viene de un pedido web (ver Caja Online), queda
    // "atendido" recién ahora que de verdad se cobró/quedó pendiente de
    // cobrar — antes esto lo hacía el viejo "Enviar a Caja" en el mismo
    // paso que armaba la venta; ahora son pasos separados.
    ...(venta.origenPedidoWebId != null
      ? [
          prisma.pedidoWeb.update({
            where: { id: venta.origenPedidoWebId },
            data: { estado: "atendido", atendidoPorId: usuarioId, atendidoEn: new Date() },
          }),
        ]
      : []),
    // Venta Mayorista: las líneas que salen de una caja puntual de Cámara
    // descuentan esa caja (no Producto.stockActual) y dejan el mismo
    // registro de MovimientoCamara que dejaría una Salida de cámara normal
    // con destino "mayorista" — mismo criterio de esCompleta/tipo que usa
    // POST /cajas/:id/salida en camara.ts.
    ...cajasCamaraADescontar.flatMap(({ cajaId, saldoActual, pesoKg }) => {
      const esCompleta = pesoKg >= saldoActual - EPSILON_KG_MAYORISTA;
      const nuevoSaldo = esCompleta ? 0 : Math.round((saldoActual - pesoKg) * 1000) / 1000;
      return [
        prisma.cajaCamara.update({
          where: { id: cajaId },
          data: { saldoKg: nuevoSaldo, estado: esCompleta ? "salida" : "parcial", version: { increment: 1 } },
        }),
        prisma.movimientoCamara.create({
          data: {
            cajaId,
            tipo: esCompleta ? "salida_completa" : "salida_parcial",
            pesoKg,
            origen: "camara",
            destino: "mayorista",
            motivo: "Venta mayorista",
            referenciaTipo: "Venta",
            referenciaId: ventaId,
            usuarioId,
            claveIdempotencia: randomUUID(),
          },
        }),
      ];
    }),
  ]);

  const ventaFinal = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: { include: { producto: true, usuarioAnulacion: true } }, pagos: true, comuna: true },
  });
  res.json(ventaFinal);
});

const cancelarVentaSchema = z.object({
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().optional().nullable(),
});

// Anular una venta: funciona tanto para una venta todavía "abierta" (antes
// de pagar — el stock nunca se descontó, no hay nada que devolver) como para
// una ya "pagada" (confirmada) — en ese caso se devuelve el stock de cada
// producto (quedó descontado al confirmar) y se registra un movimiento de
// inventario de entrada por cada uno, para que quede el rastro de por qué
// volvió ese stock. Una venta pagada solo se puede anular mientras la caja
// del día en que se hizo siga abierta — evita reescribir el total de un
// cierre X/Z de un día ya cerrado; para corregir algo de un día viejo, se
// sigue pudiendo hacer a mano con un ajuste en Inventario.
cajaRouter.post("/ventas/:id/cancelar", async (req, res) => {
  const ventaId = Number(req.params.id);
  const parsed = cancelarVentaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { clave, usuarioId, motivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const venta = await prisma.venta.findUnique({
    where: { id: ventaId },
    include: { items: true, sesionCaja: true },
  });
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  if (venta.estado === "anulada") return res.status(400).json({ error: "Esta venta ya estaba anulada" });
  if (venta.estado === "pagada" && venta.sesionCaja.estado !== "abierta") {
    return res.status(400).json({
      error: "Esta venta es de una caja ya cerrada y no se puede anular desde acá — corrige el stock a mano en Inventario",
    });
  }

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const datosAnulacion = { estado: "anulada", usuarioAnulacionId: usuarioId, motivoAnulacion: motivo || null, fechaAnulacion: new Date() };

  if (venta.estado === "pagada") {
    const itemsActivos = venta.items.filter((i) => !i.anulado);
    // Venta Mayorista: las líneas con cajaCamaraId descontaron esa caja al
    // confirmar (no Producto.stockActual) — se devuelven aparte, más abajo.
    const itemsDeSalaVenta = itemsActivos.filter((i) => i.cajaCamaraId == null);
    const itemsDeCamara = itemsActivos.filter((i) => i.cajaCamaraId != null);

    const cantidadPorProducto = new Map<number, number>();
    // Mismo loteId para todos los ítems de un mismo producto en esta venta
    // (FEFO lo fija así al confirmar, ver POST /ventas/:id/confirmar) — se
    // usa para devolver el stock al lote de origen, no solo al agregado
    // genérico de Producto.
    const loteIdPorProducto = new Map<number, number>();
    for (const item of itemsDeSalaVenta) {
      cantidadPorProducto.set(item.productoId, (cantidadPorProducto.get(item.productoId) ?? 0) + item.cantidad);
      if (item.loteId != null) loteIdPorProducto.set(item.productoId, item.loteId);
    }

    const devolucionesLote: { productoId: number; loteId: number; skuId: number; cantidad: number }[] = [];
    for (const [productoId, loteId] of loteIdPorProducto) {
      const skuId = await skuCharcuteriaDeProducto(productoId);
      if (skuId != null) devolucionesLote.push({ productoId, loteId, skuId, cantidad: cantidadPorProducto.get(productoId)! });
    }

    const cantidadStockPorProducto = await expandirCombos(cantidadPorProducto);

    // Se agrupa por caja — misma validación de seguridad que "Anular venta
    // por mayor" de Cámara: solo se devuelve el peso si esa caja no tuvo
    // NINGÚN movimiento después del que dejó esta venta al confirmar (si
    // tuvo, el saldo actual ya no corresponde a "como quedó justo después
    // de esta venta", y devolverlo a ciegas podría mezclarse con otro
    // movimiento real — se corrige a mano en ese caso).
    const cantidadPorCajaCamara = new Map<number, number>();
    for (const item of itemsDeCamara) {
      cantidadPorCajaCamara.set(item.cajaCamaraId!, (cantidadPorCajaCamara.get(item.cajaCamaraId!) ?? 0) + item.cantidad);
    }
    const cajasCamaraADevolver: { cajaId: number; saldoActual: number; pesoInicialKg: number; pesoKg: number }[] = [];
    for (const [cajaCamaraId, pesoKg] of cantidadPorCajaCamara) {
      const caja = await prisma.cajaCamara.findUnique({ where: { id: cajaCamaraId } });
      if (!caja) return res.status(400).json({ error: "Una de las cajas de cámara de esta venta ya no existe" });
      const movimientoDeEstaVenta = await prisma.movimientoCamara.findFirst({
        where: { cajaId: cajaCamaraId, referenciaTipo: "Venta", referenciaId: ventaId },
        orderBy: { id: "desc" },
      });
      const movimientoMasReciente = await prisma.movimientoCamara.findFirst({
        where: { cajaId: cajaCamaraId },
        orderBy: { id: "desc" },
      });
      if (!movimientoDeEstaVenta || movimientoMasReciente?.id !== movimientoDeEstaVenta.id) {
        return res.status(400).json({
          error: `La caja de cámara #${cajaCamaraId} tuvo movimientos después de esta venta — no se puede anular directamente, corrígelo con un ajuste manual en Cámara`,
        });
      }
      cajasCamaraADevolver.push({ cajaId: caja.id, saldoActual: caja.saldoKg, pesoInicialKg: caja.pesoInicialKg, pesoKg });
    }

    await prisma.$transaction([
      prisma.venta.update({ where: { id: ventaId }, data: datosAnulacion }),
      ...Array.from(cantidadStockPorProducto.entries()).flatMap(([productoId, cantidad]) => [
        prisma.producto.update({ where: { id: productoId }, data: { stockActual: { increment: cantidad } } }),
        prisma.movimientoInventario.create({
          data: { productoId, usuarioId, tipo: "entrada", motivo: "venta_anulada", cantidad },
        }),
      ]),
      ...devolucionesLote.map((d) =>
        prisma.stockLoteSku.update({
          where: { loteId_skuId: { loteId: d.loteId, skuId: d.skuId } },
          data: { saldoUnidades: { increment: d.cantidad } },
        })
      ),
      ...cajasCamaraADevolver.flatMap(({ cajaId, saldoActual, pesoInicialKg, pesoKg }) => {
        const nuevoSaldo = Math.min(pesoInicialKg, Math.round((saldoActual + pesoKg) * 1000) / 1000);
        const nuevoEstado = nuevoSaldo >= pesoInicialKg - 0.0005 ? "en_camara" : "parcial";
        return [
          prisma.cajaCamara.update({
            where: { id: cajaId },
            data: { saldoKg: nuevoSaldo, estado: nuevoEstado, version: { increment: 1 } },
          }),
          prisma.movimientoCamara.create({
            data: {
              cajaId,
              tipo: "anulacion_mayorista",
              pesoKg,
              origen: "camara",
              destino: "en_camara",
              motivo: motivo || null,
              referenciaTipo: "Venta",
              referenciaId: ventaId,
              usuarioId,
              claveIdempotencia: randomUUID(),
            },
          }),
        ];
      }),
    ]);
  } else {
    await prisma.venta.update({ where: { id: ventaId }, data: datosAnulacion });
  }

  const ventaCancelada = await prisma.venta.findUnique({ where: { id: ventaId } });
  res.json(ventaCancelada);
});

// --- Créditos y transferencias pendientes (ventas fiadas o esperando que se
// confirme una transferencia, a cobrar/confirmar después) ---

cajaRouter.get("/creditos-pendientes", async (req, res) => {
  const medio =
    req.query.medio === "credito" ||
    req.query.medio === "transferencia" ||
    req.query.medio === "pedido_web" ||
    req.query.medio === "mayorista"
      ? req.query.medio
      : undefined;
  // Sin filtro, "pedido_web" y "mayorista" quedan afuera a propósito — esta
  // misma lista también alimenta Créditos pendientes, que no debería
  // mezclarse con pedidos online ni ventas mayoristas (ver Pedidos Online
  // pendientes de pago y Mayoristas pendientes de pago, que sí piden su
  // medio explícito).
  const creditos = await prisma.pagoVenta.findMany({
    where: { medio: medio ?? { in: ["credito", "transferencia"] }, cobrado: false },
    include: { venta: true, cliente: true },
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
  if (
    !pago ||
    (pago.medio !== "credito" && pago.medio !== "transferencia" && pago.medio !== "pedido_web" && pago.medio !== "mayorista")
  ) {
    return res.status(404).json({ error: "Crédito, transferencia, pedido online o venta mayorista no encontrado" });
  }
  if (pago.cobrado) return res.status(400).json({ error: "Esto ya estaba marcado como cobrado" });

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
    // Con lo necesario para armar el comprobante imprimible (ver
    // ComprobantePagoCredito) sin pedir datos aparte.
    include: { venta: true, usuarioCobro: true },
  });
  res.json(pagoActualizado);
});

const condonarCreditoSchema = z.object({
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().min(1, "Falta el motivo"),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

// Dar de baja un crédito/transferencia que nunca se va a cobrar de verdad
// (ej. el cliente no va a pagar, o quedó mal registrado hace mucho y no se
// puede corregir) — sin esto, la única forma de sacarlo de "pendientes" era
// marcarlo "cobrado" con un medio real, lo que mentiría sobre haber
// recibido ese dinero. Pide clave de supervisor y motivo, igual que anular
// una venta, porque efectivamente se está perdonando una deuda.
cajaRouter.post("/creditos/:pagoId/condonar", async (req, res) => {
  const pagoId = Number(req.params.pagoId);
  const parsed = condonarCreditoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, motivo, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId } });
  if (
    !pago ||
    (pago.medio !== "credito" && pago.medio !== "transferencia" && pago.medio !== "pedido_web" && pago.medio !== "mayorista")
  ) {
    return res.status(404).json({ error: "Crédito, transferencia, pedido online o venta mayorista no encontrado" });
  }
  if (pago.cobrado) return res.status(400).json({ error: "Esto ya estaba marcado como cobrado" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const pagoActualizado = await prisma.pagoVenta.update({
    where: { id: pagoId },
    data: {
      cobrado: true,
      medioCobro: "condonado",
      motivoCondonacion: motivo,
      usuarioCobroId: usuarioId,
      fechaCobro: new Date(),
    },
    include: { venta: true, usuarioCobro: true },
  });
  res.json(pagoActualizado);
});

// --- Registro de anulaciones (pantalla aparte, para verlas todas juntas sin
// tener que abrir venta por venta en "Buscar venta") ---

export async function calcularReporteAnulaciones(desdeTexto?: unknown, hastaTexto?: unknown) {
  const { desde, hasta } = rangoFechasDesdeTexto(desdeTexto, hastaTexto);

  const items = await prisma.itemVenta.findMany({
    where: { anulado: true, fechaAnulacion: { gte: desde, lte: hasta } },
    include: { producto: true, usuarioAnulacion: true, venta: true },
    orderBy: { fechaAnulacion: "desc" },
  });

  const ventas = await prisma.venta.findMany({
    where: { estado: "anulada", fechaAnulacion: { gte: desde, lte: hasta } },
    include: { usuarioAnulacion: true, items: { include: { producto: true } } },
    orderBy: { fechaAnulacion: "desc" },
  });

  return { items, ventas };
}

cajaRouter.get("/anulaciones", async (req, res) => {
  res.json(await calcularReporteAnulaciones(req.query.desde, req.query.hasta));
});

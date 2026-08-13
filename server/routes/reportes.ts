import { Router } from "express";
import { prisma } from "../db";

export const reportesRouter = Router();

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

// Los inputs <input type="date"> del frontend mandan "YYYY-MM-DD" sin hora.
// new Date("YYYY-MM-DD") lo interpreta como medianoche UTC (no hora local),
// lo que desalinea el rango con el día real del usuario. Se arma la fecha
// en hora local explícitamente para evitar ese corrimiento.
function parseFechaLocal(valor: unknown, horas: [number, number, number, number]): Date | null {
  if (typeof valor !== "string" || !valor) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (match) {
    const [, anio, mes, dia] = match;
    return new Date(Number(anio), Number(mes) - 1, Number(dia), ...horas);
  }
  const generica = new Date(valor);
  return Number.isNaN(generica.getTime()) ? null : generica;
}

export function rangoFechasDesdeTexto(desdeTexto?: unknown, hastaTexto?: unknown): { desde: Date; hasta: Date } {
  const ahora = new Date();
  const desde = parseFechaLocal(desdeTexto, [0, 0, 0, 0]) ?? new Date(ahora.getTime() - TREINTA_DIAS_MS);
  // "hasta" se extiende al final del día para incluir todo lo ocurrido ese día.
  const hasta = parseFechaLocal(hastaTexto, [23, 59, 59, 999]) ?? ahora;
  return { desde, hasta };
}

function rangoFechas(query: Record<string, unknown>): { desde: Date; hasta: Date } {
  return rangoFechasDesdeTexto(query.desde, query.hasta);
}

export async function calcularReporteVentas(desdeTexto?: unknown, hastaTexto?: unknown) {
  const { desde, hasta } = rangoFechasDesdeTexto(desdeTexto, hastaTexto);

  const items = await prisma.itemVenta.findMany({
    where: { anulado: false, venta: { estado: "pagada", fecha: { gte: desde, lte: hasta } } },
    include: { producto: true },
  });
  const ventasEnRango = await prisma.venta.findMany({
    where: { estado: "pagada", fecha: { gte: desde, lte: hasta } },
  });

  const totalVentas = ventasEnRango.reduce((s, v) => s + v.total, 0);

  const porProducto = new Map<
    number,
    { productoId: number; plu: string; descripcion: string; cantidad: number; ingreso: number }
  >();
  for (const i of items) {
    const actual = porProducto.get(i.productoId) ?? {
      productoId: i.productoId,
      plu: i.producto.plu,
      descripcion: i.producto.descripcion,
      cantidad: 0,
      ingreso: 0,
    };
    actual.cantidad += i.cantidad;
    actual.ingreso += i.subtotal;
    porProducto.set(i.productoId, actual);
  }
  const masVendidosPorCantidad = Array.from(porProducto.values())
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10);
  const masVendidosPorIngreso = Array.from(porProducto.values())
    .sort((a, b) => b.ingreso - a.ingreso)
    .slice(0, 10);

  return {
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    cantidadVentas: ventasEnRango.length,
    totalVentas,
    masVendidosPorCantidad,
    masVendidosPorIngreso,
  };
}

reportesRouter.get("/inventario", async (req, res) => {
  const { desde, hasta } = rangoFechas(req.query as Record<string, unknown>);

  const movimientos = await prisma.movimientoInventario.findMany({
    where: { fecha: { gte: desde, lte: hasta } },
    include: { producto: true },
  });

  const entradasTotal = movimientos
    .filter((m) => m.tipo === "entrada")
    .reduce((suma, m) => suma + m.cantidad, 0);

  const salidasPorMotivo: Record<string, number> = { venta: 0, descarte: 0, ajuste: 0 };
  for (const m of movimientos) {
    if (m.tipo === "salida") {
      salidasPorMotivo[m.motivo] = (salidasPorMotivo[m.motivo] ?? 0) + m.cantidad;
    }
  }

  const mermaPorProducto = new Map<number, { productoId: number; plu: string; descripcion: string; cantidad: number }>();
  for (const m of movimientos) {
    if (m.tipo === "salida" && m.motivo === "descarte") {
      const actual = mermaPorProducto.get(m.productoId) ?? {
        productoId: m.productoId,
        plu: m.producto.plu,
        descripcion: m.producto.descripcion,
        cantidad: 0,
      };
      actual.cantidad += m.cantidad;
      mermaPorProducto.set(m.productoId, actual);
    }
  }
  const topMerma = Array.from(mermaPorProducto.values())
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10);

  res.json({
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    entradasTotal,
    salidasPorMotivo,
    topMerma,
  });
});

reportesRouter.get("/precios", async (req, res) => {
  const { desde, hasta } = rangoFechas(req.query as Record<string, unknown>);

  const cambios = await prisma.historialPrecio.findMany({
    where: { fecha: { gte: desde, lte: hasta } },
    include: { producto: true },
  });

  const porTipo: Record<string, number> = {};
  for (const c of cambios) {
    porTipo[c.tipoCambio] = (porTipo[c.tipoCambio] ?? 0) + 1;
  }

  const mayoresCambios = cambios
    .map((c) => ({
      productoId: c.productoId,
      plu: c.producto.plu,
      descripcion: c.producto.descripcion,
      precioAnterior: c.precioAnterior,
      precioNuevo: c.precioNuevo,
      variacionPorcentual:
        c.precioAnterior > 0 ? ((c.precioNuevo - c.precioAnterior) / c.precioAnterior) * 100 : 0,
      fecha: c.fecha,
    }))
    .sort((a, b) => Math.abs(b.variacionPorcentual) - Math.abs(a.variacionPorcentual))
    .slice(0, 10);

  res.json({
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    totalCambios: cambios.length,
    porTipo,
    mayoresCambios,
  });
});

reportesRouter.get("/ventas", async (req, res) => {
  const query = req.query as Record<string, unknown>;
  res.json(await calcularReporteVentas(query.desde, query.hasta));
});

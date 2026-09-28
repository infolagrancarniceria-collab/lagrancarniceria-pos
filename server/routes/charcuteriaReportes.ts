import { Router } from "express";
import { prisma } from "../db";
import { calcularMargen, calcularMargenReal } from "../lib/margen";

export const charcuteriaReportesRouter = Router();

// Costo y margen por SKU y por lote (Fase 1) — nada se guarda: todo se
// calcula al vuelo a partir de LoteProduccion.costoTotal (ya congelado por
// insumos/mano de obra/envase real de ese lote) y del precio de venta
// vigente en la fila espejo de Producto, mismo criterio que
// costoEfectivo/calcularMargen en el resto del sistema (nunca un margen
// guardado que pueda desactualizarse).
charcuteriaReportesRouter.get("/costo-margen", async (_req, res) => {
  const lotes = await prisma.loteProduccion.findMany({
    where: { estado: { in: ["terminado", "envasado", "cerrado"] } },
    include: {
      receta: { include: { productoElaborado: true } },
      envasados: { include: { sku: { include: { productoEspejo: true } } } },
      stockPorSku: true,
    },
    orderBy: { fechaElaboracion: "desc" },
  });

  const resultado = lotes.map((lote) => {
    const costoPorKgElaborado = lote.pesoSalidaKg && lote.costoTotal ? lote.costoTotal / lote.pesoSalidaKg : null;

    // Un lote puede envasarse en más de una tanda del mismo SKU — se
    // agrupa por skuId para no repetir el mismo SKU dos veces en el
    // reporte de este lote.
    const porSku = new Map<number, (typeof lote.envasados)[number]>();
    for (const e of lote.envasados) porSku.set(e.skuId, e);

    const skus = Array.from(porSku.values()).map((e) => {
      const costoPorUnidad = costoPorKgElaborado != null ? Math.round(costoPorKgElaborado * (e.pesoNetoPorUnidadG / 1000)) : null;
      const precioVenta = e.sku.productoEspejo?.precio ?? null;
      const saldo = lote.stockPorSku.find((s) => s.skuId === e.skuId)?.saldoUnidades ?? 0;
      return {
        skuId: e.skuId,
        codigo: e.sku.codigo,
        nombre: e.sku.nombre,
        formatoGramos: e.pesoNetoPorUnidadG,
        costoPorUnidad,
        precioVenta,
        margenPct: precioVenta != null ? calcularMargen(precioVenta, costoPorUnidad) : null,
        margenRealPct: precioVenta != null ? calcularMargenReal(precioVenta, costoPorUnidad) : null,
        saldoUnidades: saldo,
      };
    });

    return {
      loteId: lote.id,
      codigo: lote.codigo,
      estado: lote.estado,
      productoElaborado: lote.receta.productoElaborado.nombre,
      fechaElaboracion: lote.fechaElaboracion,
      fechaVencimiento: lote.fechaVencimiento,
      pesoEntradaKg: lote.pesoEntradaKg,
      pesoSalidaKg: lote.pesoSalidaKg,
      mermaEsperadaPct: lote.mermaEsperadaPct,
      mermaRealPct: lote.mermaRealPct,
      costoTotal: lote.costoTotal,
      costoPorKgElaborado,
      skus,
    };
  });

  res.json(resultado);
});

// --- Trazabilidad ---

// (a) Dado un lote de producto terminado: materia prima e insumos de
// origen, con la transferencia interna que trajo cada uno desde carnicería
// (si vino por ahí — origenTipo "compra" no tiene ese detalle todavía).
charcuteriaReportesRouter.get("/trazabilidad/lote/:id", async (req, res) => {
  const loteId = Number(req.params.id);
  const lote = await prisma.loteProduccion.findUnique({
    where: { id: loteId },
    include: {
      receta: { include: { productoElaborado: true } },
      insumosConsumidos: { include: { item: true } },
      envasados: { include: { sku: true } },
    },
  });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });

  const transferenciaIds = lote.insumosConsumidos.filter((i) => i.origenTipo === "transferencia" && i.origenId != null).map((i) => i.origenId!);
  const transferencias = await prisma.transferenciaInterna.findMany({
    where: { id: { in: transferenciaIds } },
    include: { productoOrigen: true },
  });
  const transferenciaPorId = new Map(transferencias.map((t) => [t.id, t]));

  res.json({
    lote: {
      id: lote.id,
      codigo: lote.codigo,
      estado: lote.estado,
      fechaElaboracion: lote.fechaElaboracion,
      productoElaborado: lote.receta.productoElaborado.nombre,
    },
    insumos: lote.insumosConsumidos.map((i) => ({
      item: i.item.nombre,
      cantidad: i.cantidad,
      unidad: i.item.unidadMedida,
      costoUnitarioAlMomento: i.costoUnitarioAlMomento,
      origenTipo: i.origenTipo,
      transferencia:
        i.origenId != null && transferenciaPorId.has(i.origenId)
          ? {
              fecha: transferenciaPorId.get(i.origenId)!.fecha,
              productoOrigen: transferenciaPorId.get(i.origenId)!.productoOrigen.descripcion,
              pluOrigen: transferenciaPorId.get(i.origenId)!.productoOrigen.plu,
            }
          : null,
    })),
    skusGenerados: lote.envasados.map((e) => ({ sku: e.sku.nombre, unidades: e.cantidadUnidadesGeneradas })),
  });
});

// (b) Dado un ítem de materia prima: las transferencias que lo trajeron,
// los lotes que la consumieron, y las ventas que salieron de esos lotes.
charcuteriaReportesRouter.get("/trazabilidad/item/:id", async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await prisma.itemCharcuteria.findUnique({ where: { id: itemId } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });

  const transferencias = await prisma.transferenciaInterna.findMany({
    where: { itemDestinoId: itemId },
    include: { productoOrigen: true },
    orderBy: { fecha: "desc" },
  });

  const insumosConsumidos = await prisma.loteInsumoConsumido.findMany({
    where: { itemId },
    include: { lote: { include: { receta: { include: { productoElaborado: true } } } } },
  });

  const loteIds = [...new Set(insumosConsumidos.map((i) => i.loteId))];
  const ventasPorLote = await prisma.itemVenta.findMany({
    where: { loteId: { in: loteIds } },
    include: { venta: true, producto: true },
  });

  res.json({
    item: { id: item.id, nombre: item.nombre, codigo: item.codigo },
    transferencias: transferencias.map((t) => ({
      fecha: t.fecha,
      productoOrigen: t.productoOrigen.descripcion,
      cantidad: t.cantidad,
      precioPorKg: t.precioPorKg,
    })),
    lotesQueLoUsaron: loteIds.map((id) => {
      const insumo = insumosConsumidos.find((i) => i.loteId === id)!;
      return {
        loteId: id,
        codigo: insumo.lote.codigo,
        productoElaborado: insumo.lote.receta.productoElaborado.nombre,
        cantidadUsada: insumo.cantidad,
        ventas: ventasPorLote
          .filter((v) => v.loteId === id)
          .map((v) => ({ ventaId: v.ventaId, fecha: v.venta.fecha, producto: v.producto.descripcion, cantidad: v.cantidad })),
      };
    }),
  });
});

function aCsv(filas: Record<string, unknown>[]): string {
  if (filas.length === 0) return "";
  const columnas = Object.keys(filas[0]);
  const escapar = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = [columnas.join(","), ...filas.map((f) => columnas.map((c) => escapar(f[c])).join(","))];
  return lineas.join("\n");
}

// Mismo endpoint que trazabilidad/item, pero aplanado a filas para CSV —
// una fila por venta encontrada (o una sola fila "sin ventas" si el ítem
// nunca llegó a venderse todavía).
charcuteriaReportesRouter.get("/trazabilidad/item/:id/csv", async (req, res) => {
  const itemId = Number(req.params.id);
  const item = await prisma.itemCharcuteria.findUnique({ where: { id: itemId } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });

  const insumosConsumidos = await prisma.loteInsumoConsumido.findMany({
    where: { itemId },
    include: { lote: { include: { receta: { include: { productoElaborado: true } } } } },
  });
  const loteIds = [...new Set(insumosConsumidos.map((i) => i.loteId))];
  const ventasPorLote = await prisma.itemVenta.findMany({
    where: { loteId: { in: loteIds } },
    include: { venta: true, producto: true },
  });

  const filas = ventasPorLote.map((v) => ({
    item: item.nombre,
    lote: insumosConsumidos.find((i) => i.loteId === v.loteId)!.lote.codigo,
    ventaId: v.ventaId,
    fecha: v.venta.fecha.toISOString(),
    producto: v.producto.descripcion,
    cantidad: v.cantidad,
  }));

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="trazabilidad-${item.codigo}.csv"`);
  res.send(aCsv(filas));
});

// --- Consolidado por unidad de negocio ---

charcuteriaReportesRouter.get("/consolidado", async (req, res) => {
  const desde = typeof req.query.desde === "string" ? new Date(req.query.desde) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const hasta = typeof req.query.hasta === "string" ? new Date(req.query.hasta) : new Date();
  hasta.setHours(23, 59, 59, 999);

  const ventas = await prisma.venta.findMany({
    where: { estado: "pagada", fecha: { gte: desde, lte: hasta } },
    include: { businessUnit: true },
  });

  const porUnidad = new Map<string, { nombre: string; cantidadVentas: number; total: number }>();
  for (const v of ventas) {
    const clave = v.businessUnit.codigo;
    const actual = porUnidad.get(clave) ?? { nombre: v.businessUnit.nombre, cantidadVentas: 0, total: 0 };
    actual.cantidadVentas += 1;
    actual.total += v.total;
    porUnidad.set(clave, actual);
  }

  const filas = Array.from(porUnidad.entries()).map(([codigo, v]) => ({ codigo, ...v }));
  const consolidado = { cantidadVentas: ventas.length, total: ventas.reduce((s, v) => s + v.total, 0) };

  res.json({ desde, hasta, porUnidad: filas, consolidado });
});

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

import { prisma } from "../db";

// Si el producto vendido es la fila "espejo" de un SKU de charcutería,
// devuelve el id de ese SKU — null para cualquier producto normal de
// carnicería (la inmensa mayoría de las ventas).
export async function skuCharcuteriaDeProducto(productoId: number): Promise<number | null> {
  const item = await prisma.itemCharcuteria.findUnique({ where: { productoEspejoId: productoId } });
  return item?.id ?? null;
}

export interface SeleccionFefo {
  loteId: number;
  stockLoteSkuId: number;
}

export interface ErrorFefo {
  error: string;
}

// Elige el lote con vencimiento más próximo que tenga stock suficiente para
// cubrir la cantidad pedida — nunca reparte una misma línea de venta entre
// varios lotes (ver informe de cierre: limitación conocida, un ItemVenta
// solo guarda un loteId). Excluye lotes anulados y lotes ya vencidos (su
// stock queda "atrapado": no se vende, aunque siga contado en StockLoteSku,
// hasta que alguien lo dé de baja a mano — dar de baja stock vencido no es
// parte de esta fase).
export async function elegirLoteFefo(skuId: number, cantidad: number): Promise<SeleccionFefo | ErrorFefo> {
  const hoy = new Date();
  const candidatos = await prisma.stockLoteSku.findMany({
    where: {
      skuId,
      saldoUnidades: { gte: cantidad },
      lote: { estado: { not: "anulado" }, OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gte: hoy } }] },
    },
    include: { lote: true },
    orderBy: { lote: { fechaVencimiento: "asc" } },
  });

  if (candidatos.length === 0) {
    return { error: "Sin stock vigente (sin vencer y no anulado) suficiente en ningún lote para este producto" };
  }
  const elegido = candidatos[0];
  return { loteId: elegido.loteId, stockLoteSkuId: elegido.id };
}

import { prisma } from "../db";
import { fechaLocalYMD } from "./respaldos";

// Mismo criterio ya usado en Cámara (server/routes/camara.ts) para "caja
// sin ningún movimiento" y "estancada hace más de una semana" — se
// duplica acá (en vez de importarlo, porque ahí es una constante privada
// del archivo) para no acoplar este chequeo liviano a toda la lógica de
// /existencias, que calcula bastante más de lo que hace falta acá.
const EPSILON_KG = 0.0005;
const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export interface AvisosCriticos {
  cajaSinCerrar: { sesionId: number; fechaApertura: Date; usuario: string } | null;
  stockBajo: { cantidad: number };
  cajasEstancadas: { cantidad: number };
  ajustesPendientesCamara: { cantidad: number };
  pedidosWebPendientes: { cantidad: number };
  pedidosOnlinePendientesPago: { cantidad: number };
  lotesCharcuteriaPorVencer: { cantidad: number };
}

// Avisos proactivos — a pedido del usuario, para no depender de entrar a
// cada pantalla a revisar si hay algo pendiente. Se calcula todo de nuevo
// en cada pedido (nada se guarda "ya avisado" acá; eso lo maneja el
// frontend, para decidir cuándo repetir una notificación nativa).
export async function calcularAvisosCriticos(): Promise<AvisosCriticos> {
  const [
    sesionAbierta,
    productosConUmbral,
    cajasEnCamara,
    ajustesPendientesCamara,
    pedidosWebPendientes,
    pedidosOnlinePendientesPago,
    configCharcuteria,
  ] = await Promise.all([
    prisma.sesionCaja.findFirst({ where: { estado: "abierta" }, include: { usuarioApertura: true } }),
    prisma.producto.findMany({
      where: { activo: true, umbralStockBajo: { not: null } },
      select: { stockActual: true, umbralStockBajo: true },
    }),
    prisma.cajaCamara.findMany({
      where: { estado: "en_camara" },
      select: { fechaIngreso: true, pesoInicialKg: true, saldoKg: true },
    }),
    prisma.cajaCamara.count({ where: { estado: "ajuste_pendiente" } }),
    prisma.pedidoWeb.count({ where: { estado: "pendiente" } }),
    prisma.pagoVenta.count({ where: { medio: "pedido_web", cobrado: false } }),
    prisma.configuracionCharcuteria.findFirst(),
  ]);

  // Una caja abierta es normal mientras sea la de hoy — recién es un aviso
  // si quedó de un día anterior sin cerrar (el cierre X/Z de ese día nunca
  // se hizo).
  let cajaSinCerrar: AvisosCriticos["cajaSinCerrar"] = null;
  if (sesionAbierta && fechaLocalYMD(sesionAbierta.fechaApertura) !== fechaLocalYMD(new Date())) {
    cajaSinCerrar = {
      sesionId: sesionAbierta.id,
      fechaApertura: sesionAbierta.fechaApertura,
      usuario: sesionAbierta.usuarioApertura.nombre,
    };
  }

  const stockBajoCantidad = productosConUmbral.filter(
    (p) => p.umbralStockBajo != null && p.stockActual <= p.umbralStockBajo
  ).length;

  const limiteEstancada = new Date(Date.now() - UNA_SEMANA_MS);
  const cajasEstancadasCantidad = cajasEnCamara.filter(
    (c) => Math.abs(c.saldoKg - c.pesoInicialKg) <= EPSILON_KG && c.fechaIngreso <= limiteEstancada
  ).length;

  // "Por vencer" = vence dentro del umbral configurado (7 días por
  // defecto) y todavía tiene stock vendible en algún SKU — un lote ya
  // vencido no es "por vencer", es un problema distinto (queda bloqueado
  // para la venta por FEFO, ver server/lib/charcuteriaFefo.ts) que no hace
  // falta seguir avisando acá una vez pasado.
  const umbralDias = configCharcuteria?.umbralVencimientoDias ?? 7;
  const hoy = new Date();
  const limiteVencimiento = new Date(hoy.getTime() + umbralDias * 24 * 60 * 60 * 1000);
  const lotesCharcuteriaPorVencer = await prisma.loteProduccion.count({
    where: {
      estado: { in: ["terminado", "envasado"] },
      fechaVencimiento: { gte: hoy, lte: limiteVencimiento },
      stockPorSku: { some: { saldoUnidades: { gt: 0 } } },
    },
  });

  return {
    cajaSinCerrar,
    stockBajo: { cantidad: stockBajoCantidad },
    cajasEstancadas: { cantidad: cajasEstancadasCantidad },
    ajustesPendientesCamara: { cantidad: ajustesPendientesCamara },
    pedidosWebPendientes: { cantidad: pedidosWebPendientes },
    pedidosOnlinePendientesPago: { cantidad: pedidosOnlinePendientesPago },
    lotesCharcuteriaPorVencer: { cantidad: lotesCharcuteriaPorVencer },
  };
}

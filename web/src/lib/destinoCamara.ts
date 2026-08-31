import type { DestinoSalidaCamara } from "../api";

// Color + ícono por destino de salida de cámara — a pedido del usuario, para
// identificar de un vistazo hacia dónde va cada caja (sala de venta,
// producción, etc.) tanto al elegir el destino como al revisar el reporte
// de salidas ya ocurridas. Un solo lugar para no repetir la paleta en cada
// pantalla que muestra destinos.
export const DESTINOS_CAMARA: { valor: DestinoSalidaCamara; etiqueta: string; color: string; icono: string }[] = [
  { valor: "sala_venta", etiqueta: "Sala de venta", color: "#1e7a3c", icono: "🛒" },
  { valor: "produccion", etiqueta: "Producción", color: "#a15c00", icono: "🔪" },
  { valor: "merma", etiqueta: "Merma", color: "#b3261e", icono: "🗑️" },
  { valor: "donacion", etiqueta: "Donación", color: "#6a4fb3", icono: "🎁" },
  { valor: "mayorista", etiqueta: "Venta por mayor", color: "#0b6e99", icono: "📦" },
  { valor: "otro", etiqueta: "Otro", color: "#5a5a5a", icono: "❔" },
];

const FALLBACK = { etiqueta: "—", color: "#5a5a5a", icono: "❔" };

export function infoDestinoCamara(valor: string | null | undefined) {
  const encontrado = DESTINOS_CAMARA.find((d) => d.valor === valor);
  if (encontrado) return encontrado;
  return { valor: valor ?? "otro", ...FALLBACK, ...(valor ? { etiqueta: valor } : {}) };
}

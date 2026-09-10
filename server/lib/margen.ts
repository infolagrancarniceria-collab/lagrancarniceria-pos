// Misma fórmula que calcularMargen/calcularMargenReal en web/src/api.ts —
// duplicada acá (no importada) porque server y web son dos paquetes
// separados sin código compartido. Se necesita esta copia server-side para
// que el Asistente (que corre en el servidor, sin frontend) pueda calcular
// márgenes al armar un análisis de negocio (ver reporte_margenes en
// asistenteIA.ts) sin tener que reimplementar la cuenta ahí también.
const IVA = 1.19;

export function calcularMargen(precioVenta: number, costo: number | null): number | null {
  if (!costo || costo <= 0) return null;
  const precioVentaNeto = precioVenta / IVA;
  return ((precioVentaNeto - costo) / costo) * 100;
}

export function calcularMargenReal(precioVenta: number, costo: number | null): number | null {
  if (!costo || costo <= 0) return null;
  const precioVentaNeto = precioVenta / IVA;
  if (precioVentaNeto <= 0) return null;
  return ((precioVentaNeto - costo) / precioVentaNeto) * 100;
}

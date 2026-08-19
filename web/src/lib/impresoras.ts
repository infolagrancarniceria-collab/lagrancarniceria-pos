// Qué impresora usar para cada tipo de documento — es una preferencia de
// ESTE PC en particular (cada PC tiene sus propias impresoras conectadas),
// así que se guarda en localStorage, igual que "modo caja exclusiva"
// (ver web/src/lib/modoCaja.ts), no en la base de datos compartida.
// null = usar la que esté puesta como predeterminada en Windows.
const CLAVE_BOLETAS = "impresoraBoletas";
const CLAVE_ETIQUETAS = "impresoraEtiquetas";

export function obtenerImpresoraBoletas(): string | null {
  return localStorage.getItem(CLAVE_BOLETAS);
}

export function setImpresoraBoletas(nombre: string | null) {
  if (nombre) localStorage.setItem(CLAVE_BOLETAS, nombre);
  else localStorage.removeItem(CLAVE_BOLETAS);
}

export function obtenerImpresoraEtiquetas(): string | null {
  return localStorage.getItem(CLAVE_ETIQUETAS);
}

export function setImpresoraEtiquetas(nombre: string | null) {
  if (nombre) localStorage.setItem(CLAVE_ETIQUETAS, nombre);
  else localStorage.removeItem(CLAVE_ETIQUETAS);
}

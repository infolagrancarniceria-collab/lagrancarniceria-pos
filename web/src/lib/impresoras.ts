// Qué impresora usar para las boletas — es una preferencia de ESTE PC en
// particular (cada PC tiene sus propias impresoras conectadas), así que se
// guarda en localStorage, igual que "modo caja exclusiva" (ver
// web/src/lib/modoCaja.ts), no en la base de datos compartida.
// null = usar la que esté puesta como predeterminada en Windows.
//
// Las etiquetas de cámara NO tienen esta opción — siempre se imprimen con
// el diálogo normal de Windows (window.print()), donde la persona elige la
// impresora ahí mismo cada vez. Ver imprimirEtiquetaCamara() en
// web/src/lib/imprimir.ts para el motivo.
const CLAVE_BOLETAS = "impresoraBoletas";

export function obtenerImpresoraBoletas(): string | null {
  return localStorage.getItem(CLAVE_BOLETAS);
}

export function setImpresoraBoletas(nombre: string | null) {
  if (nombre) localStorage.setItem(CLAVE_BOLETAS, nombre);
  else localStorage.removeItem(CLAVE_BOLETAS);
}

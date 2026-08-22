// Qué impresora usar para las boletas y para las etiquetas de cámara — es
// una preferencia de ESTE PC en particular (cada PC tiene sus propias
// impresoras conectadas), así que se guarda en localStorage, igual que
// "modo caja exclusiva" (ver web/src/lib/modoCaja.ts), no en la base de
// datos compartida. null = usar la que esté puesta como predeterminada en
// Windows.
const CLAVE_BOLETAS = "impresoraBoletas";

export function obtenerImpresoraBoletas(): string | null {
  return localStorage.getItem(CLAVE_BOLETAS);
}

export function setImpresoraBoletas(nombre: string | null) {
  if (nombre) localStorage.setItem(CLAVE_BOLETAS, nombre);
  else localStorage.removeItem(CLAVE_BOLETAS);
}

// La etiqueta de cámara siempre intenta primero imprimir sin diálogo con
// esta impresora (o la predeterminada de Windows si no se eligió ninguna),
// y si falla cae de vuelta al diálogo normal — ver imprimirEtiquetaCamara()
// en web/src/lib/imprimir.ts. Antes esta opción no existía porque con la
// impresora térmica de ese momento (Gainscha) nunca funcionaba sin diálogo;
// al cambiar de impresora (ej. Xprinter XP-420B) puede que sí funcione, así
// que se dejó configurable igual que boletas en vez de bloquearlo del todo.
const CLAVE_ETIQUETAS = "impresoraEtiquetas";

export function obtenerImpresoraEtiquetas(): string | null {
  return localStorage.getItem(CLAVE_ETIQUETAS);
}

export function setImpresoraEtiquetas(nombre: string | null) {
  if (nombre) localStorage.setItem(CLAVE_ETIQUETAS, nombre);
  else localStorage.removeItem(CLAVE_ETIQUETAS);
}

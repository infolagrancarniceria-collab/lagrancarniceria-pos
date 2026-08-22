import { obtenerImpresoraBoletas, obtenerImpresoraEtiquetas } from "./impresoras";

// En la app instalada (Electron), imprime directo en la impresora elegida
// (o la predeterminada de Windows si no se eligió ninguna en Configuración)
// sin ningún diálogo. En un navegador normal (ej. el PC del mesón
// conectado por WiFi sin el programa instalado) window.electronAPI no
// existe — ahí se usa el print() normal del navegador, que sí muestra su
// propio diálogo por seguridad (no hay forma de evitarlo desde una página
// web común).
//
// Si la impresión silenciosa falla, se cae de vuelta al diálogo normal de
// impresión en vez de dejar el botón "sin hacer nada" — ya se comprobó con
// la etiqueta de cámara que algunas impresoras térmicas (ej. la Gainscha)
// no soportan imprimir sin diálogo aunque el deviceName esté bien
// apuntado, mientras que el diálogo normal sí funciona con cualquier
// impresora. Antes esto solo mostraba una alerta sin imprimir nada — ahora
// imprime igual, solo que con el clic extra de confirmar el diálogo.
//
// pageSize (en micrones — 1mm = 1000) solo lo manda la etiqueta de cámara:
// sin indicarlo, la impresión sin diálogo usa el tamaño/márgenes por
// defecto de la impresora en vez de los 100×50mm sin margen del CSS, lo
// que en una impresora que sí soporta imprimir sin diálogo (ej. la
// Xprinter XP-420B) dejaba el contenido corrido, invadiendo la etiqueta
// siguiente. La boleta no manda pageSize, sigue igual que siempre.
async function imprimirConRespaldo(deviceName: string | null, pageSize?: { width: number; height: number }) {
  if (!window.electronAPI) {
    window.print();
    return;
  }
  const resultado = await window.electronAPI.imprimirSilencioso({
    ...(deviceName ? { deviceName } : {}),
    ...(pageSize ? { pageSize } : {}),
  });
  if (!resultado.exito) {
    window.print();
  }
}

export async function imprimirSilencioso() {
  await imprimirConRespaldo(obtenerImpresoraBoletas());
}

// El sistema imprime dos cosas de tamaño de página distinto: el vale
// (impresora térmica de 80mm, ancho fijo con "size: 80mm auto" definido en
// styles.css) y la etiqueta de cámara (100×50mm). CSS no permite tener dos
// reglas "@page" activas al mismo tiempo para un mismo documento — se
// probó la alternativa de "páginas con nombre" (@page nombre + la
// propiedad page:) pero no se pudo confirmar que el motor de impresión la
// respete de forma confiable, así que se usa esta alternativa más simple y
// sí verificada: justo antes de imprimir una etiqueta, se agrega una hoja
// de estilo aparte que sobrescribe el tamaño de página a 100×50mm, y se
// saca apenas termina — dejando todo como estaba para la próxima vez que
// se imprima un vale.
const ID_ESTILO_PAGINA_ETIQUETA = "estilo-pagina-etiqueta-camara";

// 100×50mm en micrones, para la impresión sin diálogo (ver
// imprimirConRespaldo más arriba) — mismo tamaño que ya define el CSS de
// abajo para el diálogo normal.
const TAMANO_ETIQUETA_MICRONES = { width: 100000, height: 50000 };

function activarPaginaEtiqueta(activar: boolean) {
  const existente = document.getElementById(ID_ESTILO_PAGINA_ETIQUETA);
  if (!activar) {
    existente?.remove();
    return;
  }
  if (existente) return;
  const estilo = document.createElement("style");
  estilo.id = ID_ESTILO_PAGINA_ETIQUETA;
  estilo.textContent = "@media print { @page { size: 100mm 50mm; margin: 0; } }";
  document.head.appendChild(estilo);
}

// La etiqueta intenta primero imprimir sin diálogo (igual que el vale),
// con la impresora elegida en Configuración → Impresoras específicamente
// para etiquetas. Antes esto estaba bloqueado del todo porque con la
// impresora térmica de ese momento (Gainscha) la impresión sin diálogo
// salía en blanco — al cambiar de impresora (ej. Xprinter XP-420B) puede
// que sí funcione, así que ahora se prueba igual y, si falla, cae de
// vuelta sola al diálogo normal (mismo respaldo que ya usa el vale) en vez
// de quedar bloqueada para siempre en el modo con diálogo.
export async function imprimirEtiquetaCamara() {
  activarPaginaEtiqueta(true);
  await imprimirConRespaldo(obtenerImpresoraEtiquetas(), TAMANO_ETIQUETA_MICRONES);
  // Tiempo suficiente para que el navegador ya haya capturado la página a
  // imprimir antes de sacar la hoja de estilo — mismo margen que ya usaba
  // el prototipo original entre marcar/desmarcar la etiqueta.
  setTimeout(() => activarPaginaEtiqueta(false), 500);
}

// Imprime TODAS las etiquetas de un lote en un solo trabajo, una por
// página (ver ".imprimiendo-lote" en styles.css) — además del botón que ya
// imprime una por una. El componente que llama a esta función es
// responsable de marcar cada <EtiquetaCamara> como "imprimiendo" antes de
// invocarla (mismo mecanismo que ya usa imprimirEtiquetaCamara, solo que
// para varias a la vez).
export async function imprimirEtiquetasLoteCamara() {
  activarPaginaEtiqueta(true);
  await imprimirConRespaldo(obtenerImpresoraEtiquetas(), TAMANO_ETIQUETA_MICRONES);
  setTimeout(() => activarPaginaEtiqueta(false), 500);
}

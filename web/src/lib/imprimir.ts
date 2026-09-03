import { obtenerImpresoraBoletas, obtenerImpresoraEtiquetas, obtenerImpresoraPedidosWeb } from "./impresoras";

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

// Mismo mecanismo silencioso que el vale de venta, pero con su propia
// impresora configurable aparte (ver Configuración → Impresoras) — un
// pedido web suele revisarse/imprimirse desde un PC distinto al de la caja
// del mesón (ej. el PC servidor, en la trastienda), así que no conviene
// depender de la impresora de boletas de ESE equipo en particular, que
// puede no tener ninguna (o no ser la que corresponde).
//
// A diferencia del vale de venta (pensado para el rollo térmico continuo
// de 80mm, ver "@page" en styles.css), el pedido web se imprime en una
// impresora normal de hoja carta (ej. Brother DCP-T730DW) — por eso usa el
// mismo mecanismo de sobrescribir el tamaño de página que ya usa la hoja
// de ruta de despacho, pero a carta en vez de A4. Sin esto, un pedido
// grande se veía cortado: con "80mm auto" de alto, el motor de impresión
// arma UNA sola página tan alta como el contenido y la aprieta contra el
// primer pliego físico en vez de repartirla en varias hojas carta.
export async function imprimirPedidoWeb() {
  activarPaginaCarta(true);
  await imprimirConRespaldo(obtenerImpresoraPedidosWeb(), TAMANO_CARTA_MICRONES);
  setTimeout(() => activarPaginaCarta(false), 500);
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

// Pedido web: misma idea que la hoja de ruta más abajo, pero a hoja carta
// (216×279mm) — el tamaño real de papel que carga la impresora normal
// usada para esto (ver imprimirPedidoWeb más arriba).
const ID_ESTILO_PAGINA_CARTA = "estilo-pagina-pedido-web";
const TAMANO_CARTA_MICRONES = { width: 216000, height: 279000 };

function activarPaginaCarta(activar: boolean) {
  const existente = document.getElementById(ID_ESTILO_PAGINA_CARTA);
  if (!activar) {
    existente?.remove();
    return;
  }
  if (existente) return;
  const estilo = document.createElement("style");
  estilo.id = ID_ESTILO_PAGINA_CARTA;
  estilo.textContent = "@media print { @page { size: 216mm 279mm; margin: 12mm; } }";
  document.head.appendChild(estilo);
}

// La hoja de ruta de despacho (varias paradas, para leer/tildar a mano
// mientras se reparte) no tiene sentido en el rollo térmico angosto de
// 80mm — necesita una hoja normal. Mismo mecanismo de sobrescribir el
// tamaño de página justo antes de imprimir que ya usa la etiqueta de
// cámara, pero a A4 en vez de 100×50mm.
const ID_ESTILO_PAGINA_RUTA = "estilo-pagina-ruta-despacho";
const TAMANO_A4_MICRONES = { width: 210000, height: 297000 };

function activarPaginaRuta(activar: boolean) {
  const existente = document.getElementById(ID_ESTILO_PAGINA_RUTA);
  if (!activar) {
    existente?.remove();
    return;
  }
  if (existente) return;
  const estilo = document.createElement("style");
  estilo.id = ID_ESTILO_PAGINA_RUTA;
  estilo.textContent = "@media print { @page { size: A4; margin: 12mm; } }";
  document.head.appendChild(estilo);
}

// Misma impresora configurada para "Pedidos web" (Configuración →
// Impresoras) — la ruta se arma justo antes de salir a repartir, desde el
// mismo lugar donde se revisan los pedidos.
export async function imprimirRutaDespacho() {
  activarPaginaRuta(true);
  await imprimirConRespaldo(obtenerImpresoraPedidosWeb(), TAMANO_A4_MICRONES);
  setTimeout(() => activarPaginaRuta(false), 500);
}

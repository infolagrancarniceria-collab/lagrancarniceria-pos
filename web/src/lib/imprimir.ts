// En la app instalada (Electron), imprime directo en la impresora
// predeterminada sin ningún diálogo. En un navegador normal (ej. el PC del
// mesón conectado por WiFi sin el programa instalado) window.electronAPI no
// existe — ahí se usa el print() normal del navegador, que sí muestra su
// propio diálogo por seguridad (no hay forma de evitarlo desde una página
// web común).
export function imprimirSilencioso() {
  if (window.electronAPI) {
    window.electronAPI.imprimirSilencioso();
  } else {
    window.print();
  }
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

export function imprimirEtiquetaCamara() {
  activarPaginaEtiqueta(true);
  imprimirSilencioso();
  // Tiempo suficiente para que el navegador/Electron ya haya capturado la
  // página a imprimir antes de sacar la hoja de estilo — mismo margen que
  // ya usaba el prototipo original entre marcar/desmarcar la etiqueta.
  setTimeout(() => activarPaginaEtiqueta(false), 500);
}

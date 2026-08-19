import { obtenerImpresoraBoletas, obtenerImpresoraEtiquetas } from "./impresoras";

// En la app instalada (Electron), imprime directo en la impresora elegida
// (o la predeterminada de Windows si no se eligió ninguna en Configuración)
// sin ningún diálogo. En un navegador normal (ej. el PC del mesón
// conectado por WiFi sin el programa instalado) window.electronAPI no
// existe — ahí se usa el print() normal del navegador, que sí muestra su
// propio diálogo por seguridad (no hay forma de evitarlo desde una página
// web común). Si la impresión silenciosa falla (ej. la impresora elegida
// ya no existe, o no hay ninguna predeterminada configurada en Windows),
// se avisa con una alerta — antes fallaba sin decir nada, lo que parecía
// que el botón de imprimir no hacía nada.
async function imprimir(deviceName: string | null, etiquetaError: string) {
  if (!window.electronAPI) {
    window.print();
    return;
  }
  const resultado = await window.electronAPI.imprimirSilencioso(deviceName ? { deviceName } : undefined);
  if (!resultado.exito) {
    window.alert(
      `No se pudo imprimir ${etiquetaError}. ${
        resultado.razonError ? `Motivo: ${resultado.razonError}. ` : ""
      }Revisa en Configuración → Impresoras que la impresora elegida siga conectada y encendida.`
    );
  }
}

export function imprimirSilencioso() {
  return imprimir(obtenerImpresoraBoletas(), "la boleta");
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

export async function imprimirEtiquetaCamara() {
  activarPaginaEtiqueta(true);
  await imprimir(obtenerImpresoraEtiquetas(), "la etiqueta");
  // Tiempo suficiente para que el navegador/Electron ya haya capturado la
  // página a imprimir antes de sacar la hoja de estilo — mismo margen que
  // ya usaba el prototipo original entre marcar/desmarcar la etiqueta.
  setTimeout(() => activarPaginaEtiqueta(false), 500);
}

// "Modo cámara exclusiva": se activa solo (sin ningún interruptor manual)
// cuando el sistema se abre desde el ícono instalado en la pantalla de
// inicio del celular (ver manifest.webmanifest, start_url apunta a
// /camara/salida) — el navegador expone esto como "display-mode:
// standalone". Abrir la misma dirección en una pestaña normal del
// navegador (sin instalar) sigue mostrando el sistema completo con su
// menú, igual que siempre.
export function modoCamaraActivo(): boolean {
  if (typeof window === "undefined") return false;
  const enStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // Safari de iPhone no soporta ese media query — usa su propia bandera.
  const enStandaloneIOS = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return enStandalone || enStandaloneIOS;
}

export {};

declare global {
  interface Window {
    // Solo existe cuando la página corre dentro de la app de Electron
    // instalada (ver electron/preload.js) — en un navegador normal (ej. el
    // PC del mesón conectado por WiFi) esto es undefined.
    electronAPI?: {
      imprimirSilencioso: () => Promise<{ exito: boolean; razonError?: string }>;
    };
  }
}

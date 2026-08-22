export {};

export interface ImpresoraDisponible {
  name: string;
  displayName: string;
  isDefault: boolean;
}

declare global {
  interface Window {
    // Solo existe cuando la página corre dentro de la app de Electron
    // instalada (ver electron/preload.js) — en un navegador normal (ej. el
    // PC del mesón conectado por WiFi) esto es undefined.
    electronAPI?: {
      imprimirSilencioso: (opciones?: {
        deviceName?: string;
        // Tamaño de página exacto en micrones (1mm = 1000 micrones) — solo
        // para la etiqueta de cámara (100×50mm sin margen). Si no se pasa,
        // se imprime con el tamaño/márgenes por defecto de la impresora
        // (lo que ya usaba la boleta, sin tocar).
        pageSize?: { width: number; height: number };
      }) => Promise<{ exito: boolean; razonError?: string }>;
      listarImpresoras: () => Promise<ImpresoraDisponible[]>;
    };
  }
}

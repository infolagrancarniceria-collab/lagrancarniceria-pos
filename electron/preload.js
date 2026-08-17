// Puente seguro entre la ventana (React) y el proceso principal de Electron.
// Con contextIsolation activado, la página no puede llamar a Electron
// directamente — solo a lo que se expone acá, explícitamente.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Imprime la página actual (el vale) directo en la impresora predeterminada
  // de Windows, sin mostrar ningún diálogo — usado en vez de window.print()
  // cuando el programa corre como app instalada (no en un navegador normal,
  // donde por seguridad siempre se muestra el diálogo de impresión).
  imprimirSilencioso: () => ipcRenderer.invoke("imprimir-silencioso"),
});

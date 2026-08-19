// Puente seguro entre la ventana (React) y el proceso principal de Electron.
// Con contextIsolation activado, la página no puede llamar a Electron
// directamente — solo a lo que se expone acá, explícitamente.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Imprime la página actual (el vale o una etiqueta) directo en una
  // impresora, sin mostrar ningún diálogo — usado en vez de window.print()
  // cuando el programa corre como app instalada. Si se pasa deviceName,
  // imprime en esa impresora puntual en vez de la predeterminada de
  // Windows (ver electron/main.js para el motivo).
  imprimirSilencioso: (opciones) => ipcRenderer.invoke("imprimir-silencioso", opciones),
  listarImpresoras: () => ipcRenderer.invoke("listar-impresoras"),
});

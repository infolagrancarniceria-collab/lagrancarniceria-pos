// Proceso principal de Electron. Se escribe en JavaScript plano (no TypeScript)
// porque Electron ejecuta este archivo con su propio Node.js interno, sin pasar
// por un compilador — mantenerlo simple evita configuración adicional.
const { app, BrowserWindow } = require("electron");

const URL_DESARROLLO = process.env.ELECTRON_START_URL;

function crearVentana(url) {
  const ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "La Gran Carnicería — Gestión de precios",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ventana.loadURL(url);
}

async function obtenerUrlInicio() {
  if (URL_DESARROLLO) return URL_DESARROLLO;

  // Producción: el servidor local corre embebido en este mismo proceso.
  const path = require("node:path");
  const { iniciarServidor } = require(path.join(__dirname, "../dist-server/index.js"));
  await iniciarServidor();
  const PORT = process.env.PORT || 5175;
  return `http://localhost:${PORT}`;
}

app.whenReady().then(async () => {
  const url = await obtenerUrlInicio();
  crearVentana(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana(url);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

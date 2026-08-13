// Proceso principal de Electron. Se escribe en JavaScript plano (no TypeScript)
// porque Electron ejecuta este archivo con su propio Node.js interno, sin pasar
// por un compilador — mantenerlo simple evita configuración adicional.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

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

// La carpeta donde se instala el programa queda de solo lectura una vez
// instalado en Windows, así que la base de datos real no puede vivir ahí.
// Se guarda en la carpeta de datos del usuario (userData), que sí es
// escribible. En el primer arranque se copia una plantilla vacía con las
// migraciones ya aplicadas; en arranques siguientes se reutiliza tal cual
// quedó, con todos los datos ingresados.
function prepararBaseDeDatos() {
  const rutaDatos = path.join(app.getPath("userData"), "datos.db");
  if (!fs.existsSync(rutaDatos)) {
    const rutaPlantilla = path.join(process.resourcesPath, "plantilla.db");
    fs.copyFileSync(rutaPlantilla, rutaDatos);
  }
  process.env.DATABASE_URL = `file:${rutaDatos.replace(/\\/g, "/")}`;
}

async function obtenerUrlInicio() {
  if (URL_DESARROLLO) return URL_DESARROLLO;

  // Producción: el servidor local corre embebido en este mismo proceso.
  prepararBaseDeDatos();
  const { iniciarServidor } = require(path.join(__dirname, "../dist-server/index.js"));
  await iniciarServidor();
  const PORT = process.env.PORT || 5175;
  return `http://localhost:${PORT}`;
}

// Evita que se abra una segunda copia del programa: si ya hay una corriendo
// (aunque esté minimizada), intentar abrir otra hacía que las dos peleen por
// el mismo puerto del servidor local y el programa se cerraba con un error.
// Con este bloqueo, la segunda copia simplemente enfoca la ventana que ya
// estaba abierta y se cierra sola.
const tieneBloqueoDeInstanciaUnica = app.requestSingleInstanceLock();

if (!tieneBloqueoDeInstanciaUnica) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [ventana] = BrowserWindow.getAllWindows();
    if (!ventana) return;
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  });

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
}

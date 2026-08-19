// Proceso principal de Electron. Se escribe en JavaScript plano (no TypeScript)
// porque Electron ejecuta este archivo con su propio Node.js interno, sin pasar
// por un compilador — mantenerlo simple evita configuración adicional.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const URL_DESARROLLO = process.env.ELECTRON_START_URL;

// La ventana se veía "pegada" (dejaba de redibujarse) hasta que algo forzaba
// un repintado, como hacer click en la pantalla de inicio de Windows — un
// problema conocido de Chromium/Electron con la aceleración por hardware en
// ciertas tarjetas gráficas/drivers de Windows, no un cuelgue real del
// programa (la app seguía respondiendo por dentro). Desactivarla antes de
// que la app esté lista evita el problema a costa de un poco más de uso de
// CPU en vez de GPU para dibujar la ventana, algo imperceptible para una
// pantalla simple como esta.
app.disableHardwareAcceleration();

function crearVentana(url) {
  const ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "La Gran Carnicería — Gestión de precios",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  ventana.loadURL(url);
}

// Imprime el vale/etiqueta directo en una impresora, sin mostrar el diálogo
// de impresión — a diferencia de window.print() en un navegador normal
// (usado en equipos conectados por WiFi sin el programa instalado), acá sí
// se puede saltar el diálogo porque es la propia app, no una página web
// cualquiera. Si se pasa "deviceName", imprime en ESA impresora puntual en
// vez de la predeterminada de Windows — necesario porque boletas y
// etiquetas de cámara suelen salir por impresoras físicas distintas, y
// dejarlo siempre en la predeterminada puede mandar el trabajo a la
// impresora equivocada (o a una impresora virtual como "Microsoft Print to
// PDF") sin ningún aviso.
ipcMain.handle("imprimir-silencioso", (evento, opciones) => {
  const ventana = BrowserWindow.fromWebContents(evento.sender);
  const deviceName = opciones && opciones.deviceName ? opciones.deviceName : undefined;
  return new Promise((resolve) => {
    ventana.webContents.print(
      { silent: true, printBackground: true, ...(deviceName ? { deviceName } : {}) },
      (exito, razonError) => {
        resolve({ exito, razonError });
      }
    );
  });
});

// Lista las impresoras que Windows conoce en este PC, para que la persona
// pueda elegir cuál usar para boletas y cuál para etiquetas de cámara en
// vez de depender de cuál esté puesta como predeterminada (algo que no
// siempre es obvio ni fácil de cambiar para alguien no técnico).
ipcMain.handle("listar-impresoras", async (evento) => {
  const ventana = BrowserWindow.fromWebContents(evento.sender);
  return ventana.webContents.getPrintersAsync();
});

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

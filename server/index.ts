import "dotenv/config";
// Parcha Express para que una promesa rechazada dentro de un handler async
// (ej. Prisma tirando una excepción por un id inválido) llegue al
// errorHandler de abajo en vez de quedar como una excepción no manejada —
// eso hacía que Node terminara TODO el proceso del servidor por un solo
// pedido con datos raros (ej. POST /api/caja/ventas/:id/items con un id
// que no corresponde a ninguna venta). Tiene que importarse antes de crear
// los routers de abajo, porque parcha Router.prototype al cargarse.
import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import fs from "node:fs";
import { usuariosRouter } from "./routes/usuarios";
import { categoriasRouter } from "./routes/categorias";
import { productosRouter } from "./routes/productos";
import { preciosRouter } from "./routes/precios";
import { historialRouter } from "./routes/historial";
import { proveedoresRouter } from "./routes/proveedores";
import { inventarioRouter } from "./routes/inventario";
import { reportesRouter } from "./routes/reportes";
import { cajaRouter } from "./routes/caja";
import { configuracionRouter } from "./routes/configuracion";
import { asistenteRouter } from "./routes/asistente";
import { balanzaRouter } from "./routes/balanza";
import { gastosRouter } from "./routes/gastos";
import { comunasRouter } from "./routes/comunas";
import { camaraRouter } from "./routes/camara";
import { avisosRouter } from "./routes/avisos";
import { cortesRouter } from "./routes/cortes";
import { pedidosWebRouter } from "./routes/pedidosWeb";
import { aplicarMigracionesPendientes, reconstruirLotesCamaraFaltantes } from "./lib/migraciones";
import { ejecutarRespaldoAutomaticoSiCorresponde } from "./lib/respaldos";
import { iniciarSyncWeb } from "./lib/syncWeb";

const app = express();
const PORT = Number(process.env.PORT) || 5175;

// Límite explícito de tamaño para el cuerpo de las peticiones — antes no
// había ninguno puesto a propósito (Express usa 100kb por defecto, que
// podía llegar a ser insuficiente para pegar el catálogo completo del
// importador de cámara, o generoso de más si algo raro manda un cuerpo
// enorme). 5mb cubre con margen cualquier uso real del sistema.
app.use(express.json({ limit: "5mb" }));

// Defensa liviana contra CSRF (revisión de seguridad, agosto 2026): el
// sistema no usa cookies ni sesión (se confía en que la red WiFi del
// local ya es de confianza, decisión tomada con el usuario), así que no
// hay infraestructura de token CSRF tradicional — pero sí conviene
// rechazar pedidos que cambian datos si vienen con un header Origin que
// apunta a otro SITIO (ej. una página cualquiera, visitada en el mismo
// PC o red, con un formulario escondido apuntando para acá).
//
// Se compara solo el hostname (sin el puerto): en desarrollo, el proxy de
// Vite reenvía el pedido del navegador (Origin: localhost:5174) hacia
// este servidor (Host: localhost:5175 — el proxy reescribe el puerto del
// header Host al reenviar, aunque el Origin original del navegador se
// mantenga) — comparar el origen completo con puerto incluido rechazaba
// ese tráfico legítimo (confirmado con una prueba real de extremo a
// extremo). Comparar solo el hostname sigue bloqueando lo que importa
// (un navegador ejecutando código de un dominio externo, ej.
// "sitio-malicioso.com" tiene un hostname distinto sin importar el
// puerto) sin depender de que puerto y proxy coincidan exactamente.
// Un pedido sin Origin (curl, algunos clientes que no son navegador) se
// deja pasar — bloquearlo arriesga romper usos legítimos sin ganar
// protección real.
const METODOS_QUE_CAMBIAN_DATOS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use((req, res, next) => {
  if (!METODOS_QUE_CAMBIAN_DATOS.has(req.method)) return next();
  const origen = req.headers.origin;
  if (!origen) return next();
  let hostnameOrigen: string;
  try {
    hostnameOrigen = new URL(origen).hostname;
  } catch {
    return res.status(403).json({ error: "Solicitud rechazada: origen no permitido" });
  }
  const hostnamePropio = (req.headers.host ?? "").split(":")[0];
  if (hostnameOrigen !== hostnamePropio) {
    return res.status(403).json({ error: "Solicitud rechazada: origen no permitido" });
  }
  next();
});

app.use("/api/usuarios", usuariosRouter);
app.use("/api/categorias", categoriasRouter);
app.use("/api/productos", productosRouter);
app.use("/api/precios", preciosRouter);
app.use("/api/historial", historialRouter);
app.use("/api/proveedores", proveedoresRouter);
app.use("/api/inventario", inventarioRouter);
app.use("/api/reportes", reportesRouter);
app.use("/api/caja", cajaRouter);
app.use("/api/configuracion", configuracionRouter);
app.use("/api/asistente", asistenteRouter);
app.use("/api/balanza", balanzaRouter);
app.use("/api/gastos", gastosRouter);
app.use("/api/comunas", comunasRouter);
app.use("/api/camara", camaraRouter);
app.use("/api/avisos", avisosRouter);
app.use("/api/cortes", cortesRouter);
app.use("/api/pedidos-web", pedidosWebRouter);

// En producción, el mismo servidor sirve la interfaz web ya compilada
// (así la tablet/celular en la red del local también puede entrar por navegador).
const webDist = path.join(__dirname, "../web-dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
};
app.use(errorHandler);

export async function iniciarServidor(): Promise<void> {
  // Aplica migraciones pendientes antes de aceptar conexiones — así, si
  // alguien actualiza el programa y su base de datos existente le falta una
  // tabla nueva, se pone al día sola en vez de que las consultas a esa
  // tabla se queden esperando para siempre.
  // "resourcesPath" es una propiedad que agrega Electron a "process", no
  // parte de Node — no está en los tipos estándar de @types/node.
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const carpetaMigraciones = resourcesPath
    ? path.join(resourcesPath, "migrations")
    : path.join(__dirname, "../prisma/migrations");
  await aplicarMigracionesPendientes(carpetaMigraciones);
  // Le agrega un lote a las cajas de cámara que ya existían antes de que
  // ese concepto se agregara — ver el comentario de la función para el
  // detalle de por qué es seguro y por qué no hace falta hacerlo desde una
  // migración .sql.
  await reconstruirLotesCamaraFaltantes();
  // No se espera (no lleva await): el primer ciclo de sync corre en segundo
  // plano y no debe demorar el arranque del servidor si la web tarda o no
  // responde.
  iniciarSyncWeb();

  // Respaldo automático de la base de datos — revisa al iniciar y después
  // cada una hora si ya tocaba el de hoy (por fecha calendario, no "cada 24
  // horas exactas"), para no depender de que el programa se reinicie todos
  // los días a la misma hora.
  await ejecutarRespaldoAutomaticoSiCorresponde();
  setInterval(() => {
    ejecutarRespaldoAutomaticoSiCorresponde();
  }, 60 * 60 * 1000);

  return new Promise((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor escuchando en el puerto ${PORT} (accesible desde la red local)`);
      resolve();
    });
  });
}

// Si este archivo se ejecuta directamente (ej. `node dist-server/index.js`),
// se levanta solo. Si otro proceso lo importa (ej. Electron), es ese
// proceso quien decide cuándo llamar a iniciarServidor().
if (require.main === module) {
  iniciarServidor();
}

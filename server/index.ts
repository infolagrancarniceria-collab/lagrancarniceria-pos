import "dotenv/config";
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
import { aplicarMigracionesPendientes } from "./lib/migraciones";

const app = express();
const PORT = Number(process.env.PORT) || 5175;

app.use(express.json());

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

import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import fs from "node:fs";
import { usuariosRouter } from "./routes/usuarios";
import { categoriasRouter } from "./routes/categorias";
import { productosRouter } from "./routes/productos";
import { preciosRouter } from "./routes/precios";
import { historialRouter } from "./routes/historial";

const app = express();
const PORT = Number(process.env.PORT) || 5175;

app.use(express.json());

app.use("/api/usuarios", usuariosRouter);
app.use("/api/categorias", categoriasRouter);
app.use("/api/productos", productosRouter);
app.use("/api/precios", preciosRouter);
app.use("/api/historial", historialRouter);

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

export function iniciarServidor(): Promise<void> {
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

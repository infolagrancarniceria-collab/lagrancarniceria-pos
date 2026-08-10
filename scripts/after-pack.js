// electron-builder no detecta node_modules/.prisma como un paquete real
// (empieza con un punto, y su colector de dependencias solo sigue paquetes
// declarados en package.json) así que lo omite del empaquetado aunque esté
// en "files". Ahí vive el motor de Prisma (el .node que realmente habla
// con la base de datos SQLite), así que sin este paso el programa
// empaquetado no podría leer ni escribir nada. Este hook corre después de
// que electron-builder arma la carpeta de la app y copia esa carpeta a
// mano al mismo lugar donde habría quedado si el empaquetado automático
// la hubiera detectado (resources/app/node_modules — "app" y no un
// "app.asar" porque el proyecto no usa asar; ver el porqué en package.json,
// clave "asar").
const path = require("node:path");
const fs = require("node:fs");

exports.default = async function (context) {
  const origen = path.join(__dirname, "..", "node_modules", ".prisma");
  const destino = path.join(context.appOutDir, "resources", "app", "node_modules", ".prisma");
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origen, destino, { recursive: true });
  console.log(`[after-pack] copiado node_modules/.prisma a ${destino}`);
};

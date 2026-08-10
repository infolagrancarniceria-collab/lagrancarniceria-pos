// Genera prisma/plantilla.db: una base de datos SQLite vacía pero con todas
// las migraciones ya aplicadas. Se empaqueta dentro del instalador y es la
// que se copia a la carpeta del usuario la primera vez que alguien abre el
// programa (ver electron/main.js). Hay que volver a correr este script cada
// vez que se agregue una migración nueva a prisma/migrations.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const rutaPlantilla = path.join(__dirname, "..", "prisma", "plantilla.db");

for (const sufijo of ["", "-journal", "-wal", "-shm"]) {
  const archivo = rutaPlantilla + sufijo;
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
}

execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  // En Windows, "npx" en realidad es un archivo .cmd (no un ejecutable
  // directo) y Node ya no permite lanzar esos archivos sin pasar por una
  // terminal — shell:true hace justamente eso, en cualquier sistema operativo.
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: `file:${rutaPlantilla.replace(/\\/g, "/")}`,
  },
});

console.log(`Plantilla generada en ${rutaPlantilla}`);

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RUTA_DB_TEST } from "./ruta-db-test";

// Corre una vez antes de toda la suite (setupFiles, no globalSetup — así
// DATABASE_URL ya viene inyectado por vitest.config.ts en process.env
// cuando este archivo se ejecuta, antes de que cualquier test importe
// server/db.ts y construya el PrismaClient).
for (const sufijo of ["", "-journal", "-wal", "-shm"]) {
  const archivo = RUTA_DB_TEST + sufijo;
  if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
}

execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
  cwd: path.join(__dirname, "../.."),
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: `file:${RUTA_DB_TEST}` },
});

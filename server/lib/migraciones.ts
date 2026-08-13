import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db";

// El programa solo copia la plantilla de base de datos la primerísima vez
// que se abre (ver electron/main.js). Si alguien actualiza a una versión
// más nueva del programa que agregó tablas nuevas (ej. Configuración de IA,
// Balanza), esas tablas nunca se crean en su base de datos existente — y
// cualquier consulta a esa tabla se queda esperando una respuesta que
// nunca llega. Esta función revisa qué migraciones ya están aplicadas
// (tabla _prisma_migrations, que Prisma ya mantiene) y aplica las que
// falten, sin tocar los datos existentes.
function limpiarComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .trim();
}

export async function aplicarMigracionesPendientes(carpetaMigraciones: string): Promise<void> {
  if (!fs.existsSync(carpetaMigraciones)) return;

  const aplicadas = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`
  );
  const nombresAplicados = new Set(aplicadas.map((m) => m.migration_name));

  const carpetas = fs
    .readdirSync(carpetaMigraciones, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();

  for (const nombre of carpetas) {
    if (nombresAplicados.has(nombre)) continue;

    const rutaSql = path.join(carpetaMigraciones, nombre, "migration.sql");
    if (!fs.existsSync(rutaSql)) continue;
    const contenido = fs.readFileSync(rutaSql, "utf-8");

    const sentencias = contenido
      .split(";")
      .map(limpiarComentarios)
      .filter((s) => s.length > 0);

    for (const sentencia of sentencias) {
      await prisma.$executeRawUnsafe(sentencia);
    }

    const checksum = crypto.createHash("sha256").update(contenido).digest("hex");
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)`,
      crypto.randomUUID(),
      checksum,
      nombre
    );

    console.log(`Migración aplicada: ${nombre}`);
  }
}

import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";

export const diagnosticoRouter = Router();

// Pantalla de diagnóstico temporal — para poder ver el estado real de una
// instalación (qué migraciones quedaron aplicadas, qué columnas tiene la
// tabla Producto de verdad, y el log de errores de migración si hay uno)
// sin depender de las herramientas de desarrollador ni de acceso remoto al
// PC. No expone datos de clientes/ventas, solo metadata de esquema.
diagnosticoRouter.get("/", async (_req, res) => {
  // Cada consulta va por separado y con su propio try/catch — si algo está
  // roto de verdad (ej. la tabla Producto ni siquiera existe), igual se
  // quiere ver el resto del diagnóstico en vez de que todo el endpoint
  // termine en el mismo error genérico que se está tratando de diagnosticar.
  let migracionesAplicadas: unknown = null;
  try {
    migracionesAplicadas = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at ASC`
    );
  } catch (e) {
    migracionesAplicadas = { error: (e as Error).message };
  }

  let columnasProducto: unknown = null;
  try {
    const columnas = await prisma.$queryRawUnsafe<{ name: string; type: string }[]>(
      `SELECT name, type FROM pragma_table_info('Producto')`
    );
    columnasProducto = columnas.map((c) => `${c.name} (${c.type})`);
  } catch (e) {
    columnasProducto = { error: (e as Error).message };
  }

  let totalProductos: unknown = null;
  try {
    const total = await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT COUNT(*) as c FROM Producto`);
    totalProductos = total[0]?.c ?? null;
  } catch (e) {
    totalProductos = { error: (e as Error).message };
  }

  let logErrores: string | null = null;
  try {
    const url = process.env.DATABASE_URL ?? "";
    const rutaDb = url.startsWith("file:") ? url.slice("file:".length) : "";
    if (rutaDb) {
      const rutaLog = path.join(path.dirname(path.resolve(rutaDb)), "error-migraciones.log");
      if (fs.existsSync(rutaLog)) logErrores = fs.readFileSync(rutaLog, "utf-8");
    }
  } catch {
    // si no se puede leer el log, se informa igual el resto del diagnóstico
  }

  res.json({ migracionesAplicadas, columnasProducto, totalProductos, logErrores });
});

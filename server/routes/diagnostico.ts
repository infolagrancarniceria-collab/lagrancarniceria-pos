import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";

export const diagnosticoRouter = Router();

// Prueba mínima, sin Prisma ni acceso a disco — si esto también falla, el
// problema está en algo más básico que cualquier lógica de una pantalla en
// particular (arranque del servidor, middleware, etc.), no en la base de
// datos ni en ninguna consulta.
diagnosticoRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, ahora: new Date().toISOString() });
});

function rutaCarpetaDatos(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  const rutaDb = url.startsWith("file:") ? url.slice("file:".length) : "";
  return rutaDb ? path.dirname(path.resolve(rutaDb)) : null;
}

function leerSiExiste(rutaArchivo: string): string | null {
  try {
    return fs.existsSync(rutaArchivo) ? fs.readFileSync(rutaArchivo, "utf-8") : null;
  } catch (e) {
    return `(no se pudo leer: ${(e as Error).message})`;
  }
}

// Pantalla de diagnóstico temporal — para poder ver el estado real de una
// instalación (qué migraciones quedaron aplicadas, qué columnas tiene la
// tabla Producto de verdad, y los logs de arranque/error si hay) sin
// depender de las herramientas de desarrollador ni de acceso remoto al PC.
// No expone datos de clientes/ventas, solo metadata de esquema y logs
// técnicos.
//
// Envuelto en un único try/catch que responde 200 igual con el detalle del
// error (nunca deja que esto termine en el errorHandler genérico) — así el
// diagnóstico en sí nunca puede fallar en silencio.
diagnosticoRouter.get("/", async (_req, res) => {
  try {
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

    const carpetaDatos = rutaCarpetaDatos();
    const logArranque = carpetaDatos ? leerSiExiste(path.join(carpetaDatos, "arranque.log")) : null;
    const logErrores = carpetaDatos ? leerSiExiste(path.join(carpetaDatos, "error-migraciones.log")) : null;

    res.json({
      databaseUrl: process.env.DATABASE_URL ?? null,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null,
      migracionesAplicadas,
      columnasProducto,
      totalProductos,
      logArranque,
      logErrores,
    });
  } catch (e) {
    res.json({ errorDelDiagnosticoMismo: (e as Error).message, stack: (e as Error).stack ?? null });
  }
});

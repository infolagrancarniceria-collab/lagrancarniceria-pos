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

// Ventana de tiempo dentro de la cual se asume que un grupo de cajas se
// creó de una sola vez (mismo lote) — la entrada de un lote real crea sus
// cajas en un for-loop dentro de una transacción, así que quedan a pocos
// milisegundos una de otra, muy por debajo de este margen.
const VENTANA_MISMO_LOTE_MS = 5 * 60 * 1000;

// El campo CajaCamara.loteId se agregó después de que el módulo de cámara
// ya estaba en uso — esta función arma un LoteCamara para cada grupo de
// cajas que ya existían (agrupando por producto/familia/costo/usuario y
// cercanía en el tiempo de ingreso), sin tocar peso ni saldo de ninguna
// caja. Es seguro volver a llamarla: solo mira cajas con loteId todavía
// vacío, así que una vez que todas quedan agrupadas, no hace nada más en
// los arranques siguientes. Si la agrupación no calza perfecto en algún
// caso raro, el peor resultado posible es un lote de una sola caja —
// nunca se pierde ni se altera ningún dato real.
export async function reconstruirLotesCamaraFaltantes(): Promise<void> {
  const sinLote = await prisma.cajaCamara.findMany({
    where: { loteId: null },
    orderBy: { fechaIngreso: "asc" },
  });
  if (sinLote.length === 0) return;

  type Grupo = typeof sinLote;
  const grupos: Grupo[] = [];
  let actual: Grupo = [];
  for (const caja of sinLote) {
    const anterior = actual[actual.length - 1];
    const mismoGrupo =
      anterior &&
      anterior.productoId === caja.productoId &&
      anterior.familiaNombre === caja.familiaNombre &&
      anterior.procedencia === caja.procedencia &&
      anterior.costoNetoKg === caja.costoNetoKg &&
      anterior.creadoPorId === caja.creadoPorId &&
      caja.fechaIngreso.getTime() - anterior.fechaIngreso.getTime() <= VENTANA_MISMO_LOTE_MS;
    if (!mismoGrupo) {
      if (actual.length) grupos.push(actual);
      actual = [];
    }
    actual.push(caja);
  }
  if (actual.length) grupos.push(actual);

  await prisma.$transaction(async (tx) => {
    for (const grupo of grupos) {
      const primera = grupo[0];
      const pesoTotalKg = Math.round(grupo.reduce((s, c) => s + c.pesoInicialKg, 0) * 1000) / 1000;
      const lote = await tx.loteCamara.create({
        data: {
          productoId: primera.productoId,
          familiaNombre: primera.familiaNombre,
          procedencia: primera.procedencia,
          cantidadCajas: grupo.length,
          pesoTotalKg,
          costoNetoKg: primera.costoNetoKg,
          totalNeto: Math.round(pesoTotalKg * primera.costoNetoKg),
          fechaIngreso: primera.fechaIngreso,
          creadoPorId: primera.creadoPorId,
          reconstruido: true,
        },
      });
      await tx.cajaCamara.updateMany({
        where: { id: { in: grupo.map((c) => c.id) } },
        data: { loteId: lote.id },
      });
    }
  });

  console.log(
    `Cámara: se reconstruyeron ${grupos.length} lote(s) para ${sinLote.length} caja(s) que no tenían uno.`
  );
}

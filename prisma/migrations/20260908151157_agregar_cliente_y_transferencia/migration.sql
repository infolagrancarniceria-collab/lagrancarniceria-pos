-- CreateTable
CREATE TABLE "Cliente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "rut" TEXT,
    "notas" TEXT,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PagoVenta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ventaId" INTEGER NOT NULL,
    "medio" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "montoEntregado" REAL,
    "clienteId" INTEGER,
    "clienteNombre" TEXT,
    "cobrado" BOOLEAN NOT NULL DEFAULT false,
    "medioCobro" TEXT,
    "sesionCajaCobroId" INTEGER,
    "usuarioCobroId" INTEGER,
    "fechaCobro" DATETIME,
    CONSTRAINT "PagoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PagoVenta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PagoVenta_sesionCajaCobroId_fkey" FOREIGN KEY ("sesionCajaCobroId") REFERENCES "SesionCaja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PagoVenta_usuarioCobroId_fkey" FOREIGN KEY ("usuarioCobroId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PagoVenta" ("clienteNombre", "cobrado", "fechaCobro", "id", "medio", "medioCobro", "monto", "montoEntregado", "sesionCajaCobroId", "usuarioCobroId", "ventaId") SELECT "clienteNombre", "cobrado", "fechaCobro", "id", "medio", "medioCobro", "monto", "montoEntregado", "sesionCajaCobroId", "usuarioCobroId", "ventaId" FROM "PagoVenta";
DROP TABLE "PagoVenta";
ALTER TABLE "new_PagoVenta" RENAME TO "PagoVenta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: antes de este cambio no existía un registro de clientes, solo
-- un nombre escrito a mano en cada venta a crédito (PagoVenta.clienteNombre)
-- — se crea un Cliente por cada nombre distinto que ya existía y se enlaza
-- cada pago antiguo a su cliente, para que ese historial también aparezca
-- en el estado de cuenta por cliente nuevo.
INSERT INTO "Cliente" ("nombre")
SELECT DISTINCT TRIM("clienteNombre")
FROM "PagoVenta"
WHERE "clienteNombre" IS NOT NULL AND TRIM("clienteNombre") <> '' AND "clienteId" IS NULL;

UPDATE "PagoVenta"
SET "clienteId" = (
  SELECT "Cliente"."id" FROM "Cliente"
  WHERE "Cliente"."nombre" = TRIM("PagoVenta"."clienteNombre")
  LIMIT 1
)
WHERE "clienteNombre" IS NOT NULL AND TRIM("clienteNombre") <> '' AND "clienteId" IS NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Gasto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT NOT NULL,
    "concepto" TEXT,
    "descripcion" TEXT,
    "monto" REAL NOT NULL,
    "medioPago" TEXT NOT NULL DEFAULT 'efectivo',
    "sesionCajaId" INTEGER,
    "esGastoNegocio" BOOLEAN NOT NULL DEFAULT true,
    "usuarioId" INTEGER NOT NULL,
    CONSTRAINT "Gasto_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Gasto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Gasto" ("categoria", "concepto", "descripcion", "fecha", "id", "medioPago", "monto", "sesionCajaId", "usuarioId") SELECT "categoria", "concepto", "descripcion", "fecha", "id", "medioPago", "monto", "sesionCajaId", "usuarioId" FROM "Gasto";
DROP TABLE "Gasto";
ALTER TABLE "new_Gasto" RENAME TO "Gasto";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

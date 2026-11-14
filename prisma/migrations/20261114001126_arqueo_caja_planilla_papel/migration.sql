-- AlterTable
ALTER TABLE "SesionCaja" ADD COLUMN "observacionesCierre" TEXT;
ALTER TABLE "SesionCaja" ADD COLUMN "totalTerminalTarjetas" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ArqueoCaja" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionCajaId" INTEGER NOT NULL,
    "billetes1000" INTEGER NOT NULL DEFAULT 0,
    "billetes2000" INTEGER NOT NULL DEFAULT 0,
    "billetes5000" INTEGER NOT NULL DEFAULT 0,
    "billetes10000" INTEGER NOT NULL DEFAULT 0,
    "billetes20000" INTEGER NOT NULL DEFAULT 0,
    "monedas1" INTEGER NOT NULL DEFAULT 0,
    "monedas5" INTEGER NOT NULL DEFAULT 0,
    "monedas10" INTEGER NOT NULL DEFAULT 0,
    "monedas50" INTEGER NOT NULL DEFAULT 0,
    "monedas100" INTEGER NOT NULL DEFAULT 0,
    "monedas500" INTEGER NOT NULL DEFAULT 0,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArqueoCaja_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ArqueoCaja" ("billetes1000", "billetes10000", "billetes2000", "billetes20000", "billetes5000", "fecha", "id", "monedas10", "monedas100", "monedas50", "monedas500", "sesionCajaId") SELECT "billetes1000", "billetes10000", "billetes2000", "billetes20000", "billetes5000", "fecha", "id", "monedas10", "monedas100", "monedas50", "monedas500", "sesionCajaId" FROM "ArqueoCaja";
DROP TABLE "ArqueoCaja";
ALTER TABLE "new_ArqueoCaja" RENAME TO "ArqueoCaja";
CREATE UNIQUE INDEX "ArqueoCaja_sesionCajaId_key" ON "ArqueoCaja"("sesionCajaId");
CREATE TABLE "new_Gasto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT NOT NULL,
    "concepto" TEXT,
    "descripcion" TEXT,
    "monto" REAL NOT NULL,
    "medioPago" TEXT NOT NULL DEFAULT 'efectivo',
    "sesionCajaId" INTEGER,
    "usuarioId" INTEGER NOT NULL,
    CONSTRAINT "Gasto_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Gasto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Gasto" ("categoria", "concepto", "descripcion", "fecha", "id", "monto", "usuarioId") SELECT "categoria", "concepto", "descripcion", "fecha", "id", "monto", "usuarioId" FROM "Gasto";
DROP TABLE "Gasto";
ALTER TABLE "new_Gasto" RENAME TO "Gasto";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

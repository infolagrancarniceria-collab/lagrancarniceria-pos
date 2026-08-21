-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SesionCaja" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuarioAperturaId" INTEGER NOT NULL,
    "fondoFijoInicial" REAL NOT NULL,
    "fechaApertura" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fondoFijoSugerido" REAL,
    "motivoAjusteFondo" TEXT,
    "usuarioAutorizoFondoId" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "usuarioCierreId" INTEGER,
    "efectivoContado" REAL,
    "fechaCierre" DATETIME,
    CONSTRAINT "SesionCaja_usuarioAperturaId_fkey" FOREIGN KEY ("usuarioAperturaId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SesionCaja_usuarioAutorizoFondoId_fkey" FOREIGN KEY ("usuarioAutorizoFondoId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SesionCaja_usuarioCierreId_fkey" FOREIGN KEY ("usuarioCierreId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SesionCaja" ("efectivoContado", "estado", "fechaApertura", "fechaCierre", "fondoFijoInicial", "id", "usuarioAperturaId", "usuarioCierreId") SELECT "efectivoContado", "estado", "fechaApertura", "fechaCierre", "fondoFijoInicial", "id", "usuarioAperturaId", "usuarioCierreId" FROM "SesionCaja";
DROP TABLE "SesionCaja";
ALTER TABLE "new_SesionCaja" RENAME TO "SesionCaja";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

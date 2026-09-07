-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RetiroCaja" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionCajaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'retiro',
    "monto" REAL NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioAutorizoId" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetiroCaja_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RetiroCaja_usuarioAutorizoId_fkey" FOREIGN KEY ("usuarioAutorizoId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RetiroCaja" ("fecha", "id", "monto", "motivo", "sesionCajaId", "usuarioAutorizoId") SELECT "fecha", "id", "monto", "motivo", "sesionCajaId", "usuarioAutorizoId" FROM "RetiroCaja";
DROP TABLE "RetiroCaja";
ALTER TABLE "new_RetiroCaja" RENAME TO "RetiroCaja";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

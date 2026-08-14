-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PagoVenta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ventaId" INTEGER NOT NULL,
    "medio" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "clienteNombre" TEXT,
    "cobrado" BOOLEAN NOT NULL DEFAULT false,
    "medioCobro" TEXT,
    "sesionCajaCobroId" INTEGER,
    "usuarioCobroId" INTEGER,
    "fechaCobro" DATETIME,
    CONSTRAINT "PagoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PagoVenta_sesionCajaCobroId_fkey" FOREIGN KEY ("sesionCajaCobroId") REFERENCES "SesionCaja" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PagoVenta_usuarioCobroId_fkey" FOREIGN KEY ("usuarioCobroId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PagoVenta" ("id", "medio", "monto", "ventaId") SELECT "id", "medio", "monto", "ventaId" FROM "PagoVenta";
DROP TABLE "PagoVenta";
ALTER TABLE "new_PagoVenta" RENAME TO "PagoVenta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

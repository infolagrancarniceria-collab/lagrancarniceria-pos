-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SalidaMayorista" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productoId" INTEGER NOT NULL,
    "cantidadKg" REAL NOT NULL,
    "precioTotal" REAL NOT NULL,
    "estadoPago" TEXT NOT NULL DEFAULT 'pendiente',
    "clienteNombre" TEXT,
    "cajaCamaraId" INTEGER,
    "usuarioId" INTEGER NOT NULL,
    "observaciones" TEXT,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "usuarioAnulacionId" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    CONSTRAINT "SalidaMayorista_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalidaMayorista_cajaCamaraId_fkey" FOREIGN KEY ("cajaCamaraId") REFERENCES "CajaCamara" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalidaMayorista_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalidaMayorista_usuarioAnulacionId_fkey" FOREIGN KEY ("usuarioAnulacionId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalidaMayorista" ("cajaCamaraId", "cantidadKg", "clienteNombre", "estadoPago", "fecha", "id", "observaciones", "precioTotal", "productoId", "usuarioId") SELECT "cajaCamaraId", "cantidadKg", "clienteNombre", "estadoPago", "fecha", "id", "observaciones", "precioTotal", "productoId", "usuarioId" FROM "SalidaMayorista";
DROP TABLE "SalidaMayorista";
ALTER TABLE "new_SalidaMayorista" RENAME TO "SalidaMayorista";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

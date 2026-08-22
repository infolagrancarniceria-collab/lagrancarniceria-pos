-- AlterTable
ALTER TABLE "Producto" ADD COLUMN "precioMayor" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LoteCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
    "familiaNombre" TEXT NOT NULL,
    "procedencia" TEXT,
    "cantidadCajas" INTEGER NOT NULL,
    "pesoTotalKg" REAL NOT NULL,
    "costoNetoKg" REAL NOT NULL,
    "totalNeto" REAL NOT NULL,
    "proveedorId" INTEGER,
    "numeroFactura" TEXT,
    "fechaIngreso" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" INTEGER NOT NULL,
    "reconstruido" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    CONSTRAINT "LoteCamara_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoteCamara_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LoteCamara_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LoteCamara" ("actualizadoEn", "cantidadCajas", "costoNetoKg", "creadoEn", "creadoPorId", "familiaNombre", "fechaIngreso", "id", "pesoTotalKg", "procedencia", "productoId", "reconstruido", "totalNeto") SELECT "actualizadoEn", "cantidadCajas", "costoNetoKg", "creadoEn", "creadoPorId", "familiaNombre", "fechaIngreso", "id", "pesoTotalKg", "procedencia", "productoId", "reconstruido", "totalNeto" FROM "LoteCamara";
DROP TABLE "LoteCamara";
ALTER TABLE "new_LoteCamara" RENAME TO "LoteCamara";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

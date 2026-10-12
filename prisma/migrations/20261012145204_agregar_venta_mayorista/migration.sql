-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN "porcentajeCobroMayorista" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItemVenta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ventaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioUnitario" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    "precioNetoUnitario" REAL,
    "porcentajeCobro" REAL,
    "cajaCamaraId" INTEGER,
    "loteId" INTEGER,
    "descuentoTipo" TEXT,
    "descuentoValor" REAL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "usuarioAnulacionId" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    CONSTRAINT "ItemVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_cajaCamaraId_fkey" FOREIGN KEY ("cajaCamaraId") REFERENCES "CajaCamara" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_usuarioAnulacionId_fkey" FOREIGN KEY ("usuarioAnulacionId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ItemVenta" ("anulado", "cantidad", "descuentoTipo", "descuentoValor", "fechaAnulacion", "id", "loteId", "motivoAnulacion", "precioUnitario", "productoId", "subtotal", "usuarioAnulacionId", "ventaId") SELECT "anulado", "cantidad", "descuentoTipo", "descuentoValor", "fechaAnulacion", "id", "loteId", "motivoAnulacion", "precioUnitario", "productoId", "subtotal", "usuarioAnulacionId", "ventaId" FROM "ItemVenta";
DROP TABLE "ItemVenta";
ALTER TABLE "new_ItemVenta" RENAME TO "ItemVenta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

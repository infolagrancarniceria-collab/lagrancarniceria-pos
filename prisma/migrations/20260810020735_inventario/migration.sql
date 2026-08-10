-- CreateTable
CREATE TABLE "Proveedor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "contacto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "costoUnitario" REAL,
    "proveedorId" INTEGER,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Producto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plu" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "nombreCorto" TEXT,
    "marca" TEXT,
    "categoriaId" INTEGER NOT NULL,
    "precio" REAL NOT NULL,
    "flagBalanza" TEXT NOT NULL DEFAULT 'NORMAL',
    "codigoBarras" TEXT,
    "contenido" TEXT,
    "capacidadPorCaja" TEXT,
    "envase" TEXT,
    "impuestoAdicional" REAL DEFAULT 0,
    "duracion" TEXT,
    "codigoProveedor" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    "stockActual" REAL NOT NULL DEFAULT 0,
    "umbralStockBajo" REAL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio") SELECT "activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_nombre_key" ON "Proveedor"("nombre");

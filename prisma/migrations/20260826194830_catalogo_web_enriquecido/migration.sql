/*
  Warnings:

  - You are about to drop the column `agotadoWeb` on the `Producto` table. All the data in the column will be lost.

*/
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
    "precioMayor" REAL,
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
    "visibleEnWeb" BOOLEAN NOT NULL DEFAULT true,
    "disponibilidadWeb" TEXT NOT NULL DEFAULT 'disponible',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "lowStock" BOOLEAN NOT NULL DEFAULT false,
    "promoPrecioUnitario" REAL,
    "promoGramosMinimos" INTEGER,
    "promoEtiqueta" TEXT,
    "descripcionCorta" TEXT,
    "familiaCorte" TEXT,
    "stockActual" REAL NOT NULL DEFAULT 0,
    "umbralStockBajo" REAL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "familiaCorte", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio", "precioMayor", "stockActual", "umbralStockBajo", "visibleEnWeb") SELECT "activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "familiaCorte", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio", "precioMayor", "stockActual", "umbralStockBajo", "visibleEnWeb" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

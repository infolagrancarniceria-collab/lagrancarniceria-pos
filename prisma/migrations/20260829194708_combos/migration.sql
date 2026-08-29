-- CreateTable
CREATE TABLE "ComboComponente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "comboProductoId" INTEGER NOT NULL,
    "componenteProductoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    CONSTRAINT "ComboComponente_comboProductoId_fkey" FOREIGN KEY ("comboProductoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComboComponente_componenteProductoId_fkey" FOREIGN KEY ("componenteProductoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "precioMayor" REAL,
    "costoReferencia" REAL,
    "flagBalanza" TEXT NOT NULL DEFAULT 'NORMAL',
    "codigoBarras" TEXT,
    "contenido" TEXT,
    "capacidadPorCaja" TEXT,
    "envase" TEXT,
    "impuestoAdicional" REAL DEFAULT 0,
    "duracion" TEXT,
    "codigoProveedor" TEXT,
    "aplicaIvaCarne" BOOLEAN NOT NULL DEFAULT false,
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
    "esCombo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "actualizadoEn", "aplicaIvaCarne", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "costoReferencia", "creadoEn", "descripcion", "descripcionCorta", "disponibilidadWeb", "duracion", "envase", "familiaCorte", "featured", "flagBalanza", "id", "impuestoAdicional", "lowStock", "marca", "nombreCorto", "plu", "precio", "precioMayor", "promoEtiqueta", "promoGramosMinimos", "promoPrecioUnitario", "stockActual", "umbralStockBajo", "visibleEnWeb") SELECT "activo", "actualizadoEn", "aplicaIvaCarne", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "costoReferencia", "creadoEn", "descripcion", "descripcionCorta", "disponibilidadWeb", "duracion", "envase", "familiaCorte", "featured", "flagBalanza", "id", "impuestoAdicional", "lowStock", "marca", "nombreCorto", "plu", "precio", "precioMayor", "promoEtiqueta", "promoGramosMinimos", "promoPrecioUnitario", "stockActual", "umbralStockBajo", "visibleEnWeb" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

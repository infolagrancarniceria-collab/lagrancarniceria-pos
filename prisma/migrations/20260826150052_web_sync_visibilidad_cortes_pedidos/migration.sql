-- CreateTable
CREATE TABLE "CorteOpcion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "familia" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "PedidoWeb" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idWeb" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL,
    "clienteNombre" TEXT NOT NULL,
    "clienteTelefono" TEXT NOT NULL,
    "clienteDireccion" TEXT NOT NULL,
    "comunaNombre" TEXT NOT NULL,
    "costoEnvio" REAL NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "comentario" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "atendidoPorId" INTEGER,
    "atendidoEn" DATETIME,
    "sincronizadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PedidoWeb_atendidoPorId_fkey" FOREIGN KEY ("atendidoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "agotadoWeb" BOOLEAN NOT NULL DEFAULT false,
    "familiaCorte" TEXT,
    "stockActual" REAL NOT NULL DEFAULT 0,
    "umbralStockBajo" REAL,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio", "precioMayor", "stockActual", "umbralStockBajo") SELECT "activo", "actualizadoEn", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "creadoEn", "descripcion", "duracion", "envase", "flagBalanza", "id", "impuestoAdicional", "marca", "nombreCorto", "plu", "precio", "precioMayor", "stockActual", "umbralStockBajo" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CorteOpcion_familia_nombre_key" ON "CorteOpcion"("familia", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoWeb_idWeb_key" ON "PedidoWeb"("idWeb");

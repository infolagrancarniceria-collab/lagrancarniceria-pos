-- CreateTable
CREATE TABLE "PedidoWebRegalo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedidoWebId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "agregadoPorId" INTEGER NOT NULL,
    "agregadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PedidoWebRegalo_pedidoWebId_fkey" FOREIGN KEY ("pedidoWebId") REFERENCES "PedidoWeb" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PedidoWebRegalo_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PedidoWebRegalo_agregadoPorId_fkey" FOREIGN KEY ("agregadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Venta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionCajaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "total" REAL NOT NULL DEFAULT 0,
    "comentario" TEXT,
    "esDespacho" BOOLEAN NOT NULL DEFAULT false,
    "comunaId" INTEGER,
    "costoEnvio" REAL,
    "descuentoTipo" TEXT,
    "descuentoValor" REAL,
    "usuarioAnulacionId" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    "origenPedidoWebId" INTEGER,
    CONSTRAINT "Venta_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_comunaId_fkey" FOREIGN KEY ("comunaId") REFERENCES "Comuna" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Venta_usuarioAnulacionId_fkey" FOREIGN KEY ("usuarioAnulacionId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Venta_origenPedidoWebId_fkey" FOREIGN KEY ("origenPedidoWebId") REFERENCES "PedidoWeb" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Venta" ("comentario", "comunaId", "costoEnvio", "descuentoTipo", "descuentoValor", "esDespacho", "estado", "fecha", "fechaAnulacion", "id", "motivoAnulacion", "sesionCajaId", "total", "usuarioAnulacionId", "usuarioId") SELECT "comentario", "comunaId", "costoEnvio", "descuentoTipo", "descuentoValor", "esDespacho", "estado", "fecha", "fechaAnulacion", "id", "motivoAnulacion", "sesionCajaId", "total", "usuarioAnulacionId", "usuarioId" FROM "Venta";
DROP TABLE "Venta";
ALTER TABLE "new_Venta" RENAME TO "Venta";
CREATE UNIQUE INDEX "Venta_origenPedidoWebId_key" ON "Venta"("origenPedidoWebId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

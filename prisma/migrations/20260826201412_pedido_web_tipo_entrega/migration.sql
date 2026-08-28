-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PedidoWeb" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idWeb" TEXT NOT NULL,
    "fecha" DATETIME NOT NULL,
    "clienteNombre" TEXT NOT NULL,
    "clienteTelefono" TEXT NOT NULL,
    "tipoEntrega" TEXT NOT NULL DEFAULT 'despacho',
    "clienteDireccion" TEXT,
    "comunaNombre" TEXT,
    "costoEnvio" REAL,
    "fechaEntrega" TEXT,
    "medioPago" TEXT,
    "itemsJson" TEXT NOT NULL,
    "comentario" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "atendidoPorId" INTEGER,
    "atendidoEn" DATETIME,
    "sincronizadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PedidoWeb_atendidoPorId_fkey" FOREIGN KEY ("atendidoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PedidoWeb" ("atendidoEn", "atendidoPorId", "clienteDireccion", "clienteNombre", "clienteTelefono", "comentario", "comunaNombre", "costoEnvio", "estado", "fecha", "id", "idWeb", "itemsJson", "sincronizadoEn") SELECT "atendidoEn", "atendidoPorId", "clienteDireccion", "clienteNombre", "clienteTelefono", "comentario", "comunaNombre", "costoEnvio", "estado", "fecha", "id", "idWeb", "itemsJson", "sincronizadoEn" FROM "PedidoWeb";
DROP TABLE "PedidoWeb";
ALTER TABLE "new_PedidoWeb" RENAME TO "PedidoWeb";
CREATE UNIQUE INDEX "PedidoWeb_idWeb_key" ON "PedidoWeb"("idWeb");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

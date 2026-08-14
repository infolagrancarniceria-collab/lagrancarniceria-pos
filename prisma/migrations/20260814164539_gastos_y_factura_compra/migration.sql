-- AlterTable
ALTER TABLE "MovimientoInventario" ADD COLUMN "numeroFactura" TEXT;

-- CreateTable
CREATE TABLE "Gasto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT NOT NULL,
    "descripcion" TEXT,
    "monto" REAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    CONSTRAINT "Gasto_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

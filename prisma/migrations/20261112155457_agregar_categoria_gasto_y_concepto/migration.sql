-- AlterTable
ALTER TABLE "Gasto" ADD COLUMN "concepto" TEXT;

-- CreateTable
CREATE TABLE "CategoriaGasto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaGasto_nombre_key" ON "CategoriaGasto"("nombre");

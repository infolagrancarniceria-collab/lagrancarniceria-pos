-- AlterTable
ALTER TABLE "Comuna" ADD COLUMN "ordenDespacho" INTEGER;

-- CreateTable
CREATE TABLE "ConfiguracionWhatsapp" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "numeroDueno" TEXT,
    "ultimoResumenPreparadoFecha" TEXT,
    "actualizadoEn" DATETIME NOT NULL
);

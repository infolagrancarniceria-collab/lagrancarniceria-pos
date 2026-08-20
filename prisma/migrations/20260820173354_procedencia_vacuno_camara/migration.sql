-- AlterTable
ALTER TABLE "CajaCamara" ADD COLUMN "procedencia" TEXT;

-- AlterTable
ALTER TABLE "CorreccionLoteCamara" ADD COLUMN "procedenciaAnterior" TEXT;
ALTER TABLE "CorreccionLoteCamara" ADD COLUMN "procedenciaNueva" TEXT;

-- AlterTable
ALTER TABLE "LoteCamara" ADD COLUMN "procedencia" TEXT;

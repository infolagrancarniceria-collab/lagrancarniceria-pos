-- AlterTable
ALTER TABLE "ItemCharcuteria" ADD COLUMN "categoria" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Receta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoElaboradoId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "rendimientoEsperadoPct" REAL,
    "dosisSalesCurantesPorKg" REAL,
    "parametrosProceso" TEXT,
    "notas" TEXT,
    "creadoPorId" INTEGER NOT NULL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receta_productoElaboradoId_fkey" FOREIGN KEY ("productoElaboradoId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Receta" ("activa", "creadoEn", "creadoPorId", "dosisSalesCurantesPorKg", "id", "notas", "parametrosProceso", "productoElaboradoId", "rendimientoEsperadoPct", "version") SELECT "activa", "creadoEn", "creadoPorId", "dosisSalesCurantesPorKg", "id", "notas", "parametrosProceso", "productoElaboradoId", "rendimientoEsperadoPct", "version" FROM "Receta";
DROP TABLE "Receta";
ALTER TABLE "new_Receta" RENAME TO "Receta";
CREATE UNIQUE INDEX "Receta_productoElaboradoId_version_key" ON "Receta"("productoElaboradoId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "ConfiguracionSyncWeb" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "webSyncUrl" TEXT,
    "syncApiKey" TEXT,
    "actualizadoEn" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConfiguracionRespaldo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rutaUsb" TEXT,
    "ultimoLocalEn" DATETIME,
    "ultimoLocalOk" BOOLEAN,
    "ultimoLocalError" TEXT,
    "ultimoUsbEn" DATETIME,
    "ultimoUsbOk" BOOLEAN,
    "ultimoUsbError" TEXT,
    "actualizadoEn" DATETIME NOT NULL
);

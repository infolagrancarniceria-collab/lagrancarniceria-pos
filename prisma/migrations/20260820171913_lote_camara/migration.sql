-- CreateTable
CREATE TABLE "LoteCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
    "familiaNombre" TEXT NOT NULL,
    "cantidadCajas" INTEGER NOT NULL,
    "pesoTotalKg" REAL NOT NULL,
    "costoNetoKg" REAL NOT NULL,
    "totalNeto" REAL NOT NULL,
    "fechaIngreso" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" INTEGER NOT NULL,
    "reconstruido" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    CONSTRAINT "LoteCamara_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoteCamara_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorreccionLoteCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loteId" INTEGER NOT NULL,
    "familiaAnterior" TEXT NOT NULL,
    "productoAnterior" TEXT NOT NULL,
    "pesoTotalAnteriorKg" REAL NOT NULL,
    "costoAnteriorKg" REAL NOT NULL,
    "familiaNueva" TEXT NOT NULL,
    "productoNuevo" TEXT NOT NULL,
    "pesoTotalNuevoKg" REAL NOT NULL,
    "costoNuevoKg" REAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorreccionLoteCamara_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorreccionLoteCamara_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CajaCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
    "loteId" INTEGER,
    "familiaNombre" TEXT NOT NULL,
    "fechaIngreso" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pesoInicialKg" REAL NOT NULL,
    "saldoKg" REAL NOT NULL,
    "costoNetoKg" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'en_camara',
    "pesoEstimado" BOOLEAN NOT NULL DEFAULT false,
    "creadoPorId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    CONSTRAINT "CajaCamara_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CajaCamara_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteCamara" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CajaCamara_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CajaCamara" ("actualizadoEn", "costoNetoKg", "creadoEn", "creadoPorId", "estado", "familiaNombre", "fechaIngreso", "id", "pesoEstimado", "pesoInicialKg", "productoId", "saldoKg", "version") SELECT "actualizadoEn", "costoNetoKg", "creadoEn", "creadoPorId", "estado", "familiaNombre", "fechaIngreso", "id", "pesoEstimado", "pesoInicialKg", "productoId", "saldoKg", "version" FROM "CajaCamara";
DROP TABLE "CajaCamara";
ALTER TABLE "new_CajaCamara" RENAME TO "CajaCamara";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

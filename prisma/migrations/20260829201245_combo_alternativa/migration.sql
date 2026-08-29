-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ComboComponente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "comboProductoId" INTEGER NOT NULL,
    "componenteProductoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "alternativaProductoId" INTEGER,
    CONSTRAINT "ComboComponente_comboProductoId_fkey" FOREIGN KEY ("comboProductoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComboComponente_componenteProductoId_fkey" FOREIGN KEY ("componenteProductoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComboComponente_alternativaProductoId_fkey" FOREIGN KEY ("alternativaProductoId") REFERENCES "Producto" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ComboComponente" ("cantidad", "comboProductoId", "componenteProductoId", "id") SELECT "cantidad", "comboProductoId", "componenteProductoId", "id" FROM "ComboComponente";
DROP TABLE "ComboComponente";
ALTER TABLE "new_ComboComponente" RENAME TO "ComboComponente";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

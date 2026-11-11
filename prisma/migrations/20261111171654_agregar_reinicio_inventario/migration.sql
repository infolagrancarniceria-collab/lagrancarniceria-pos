-- CreateTable
CREATE TABLE "ReinicioInventario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alcance" TEXT NOT NULL,
    "categoriaId" INTEGER,
    "motivo" TEXT NOT NULL,
    "usuarioAutorizoId" INTEGER NOT NULL,
    "cantidadProductosAfectados" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReinicioInventario_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReinicioInventario_usuarioAutorizoId_fkey" FOREIGN KEY ("usuarioAutorizoId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

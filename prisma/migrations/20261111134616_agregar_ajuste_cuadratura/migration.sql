-- CreateTable
CREATE TABLE "AjusteCuadratura" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionCajaId" INTEGER NOT NULL,
    "medio" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "monto" REAL NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioAutorizoId" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AjusteCuadratura_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AjusteCuadratura_usuarioAutorizoId_fkey" FOREIGN KEY ("usuarioAutorizoId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

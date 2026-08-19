-- CreateTable
CREATE TABLE "CajaCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
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
    CONSTRAINT "CajaCamara_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MovimientoCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cajaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "pesoKg" REAL NOT NULL,
    "origen" TEXT,
    "destino" TEXT,
    "motivo" TEXT,
    "referenciaTipo" TEXT,
    "referenciaId" INTEGER,
    "usuarioId" INTEGER NOT NULL,
    "dispositivo" TEXT,
    "claveIdempotencia" TEXT NOT NULL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoCamara_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoCamara_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SesionInventarioCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fechaInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaFin" DATETIME,
    "iniciadoPorId" INTEGER NOT NULL,
    "finalizadoPorId" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "observaciones" TEXT,
    CONSTRAINT "SesionInventarioCamara_iniciadoPorId_fkey" FOREIGN KEY ("iniciadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SesionInventarioCamara_finalizadoPorId_fkey" FOREIGN KEY ("finalizadoPorId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventarioCamaraEsperado" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionId" INTEGER NOT NULL,
    "cajaId" INTEGER NOT NULL,
    "saldoEsperadoKg" REAL NOT NULL,
    "estadoEsperado" TEXT NOT NULL,
    "capturadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventarioCamaraEsperado_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "SesionInventarioCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventarioCamaraEsperado_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EscaneoInventarioCamara" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionId" INTEGER NOT NULL,
    "cajaId" INTEGER NOT NULL,
    "escaneadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escaneadoPorId" INTEGER NOT NULL,
    "dispositivo" TEXT,
    "estadoAlEscanear" TEXT NOT NULL,
    "saldoAlEscanearKg" REAL NOT NULL,
    CONSTRAINT "EscaneoInventarioCamara_sesionId_fkey" FOREIGN KEY ("sesionId") REFERENCES "SesionInventarioCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EscaneoInventarioCamara_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaCamara" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EscaneoInventarioCamara_escaneadoPorId_fkey" FOREIGN KEY ("escaneadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalidaMayorista" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productoId" INTEGER NOT NULL,
    "cantidadKg" REAL NOT NULL,
    "precioTotal" REAL NOT NULL,
    "estadoPago" TEXT NOT NULL DEFAULT 'pendiente',
    "clienteNombre" TEXT,
    "cajaCamaraId" INTEGER,
    "usuarioId" INTEGER NOT NULL,
    "observaciones" TEXT,
    CONSTRAINT "SalidaMayorista_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalidaMayorista_cajaCamaraId_fkey" FOREIGN KEY ("cajaCamaraId") REFERENCES "CajaCamara" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalidaMayorista_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoCamara_claveIdempotencia_key" ON "MovimientoCamara"("claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "InventarioCamaraEsperado_sesionId_cajaId_key" ON "InventarioCamaraEsperado"("sesionId", "cajaId");

-- CreateIndex
CREATE UNIQUE INDEX "EscaneoInventarioCamara_sesionId_cajaId_key" ON "EscaneoInventarioCamara"("sesionId", "cajaId");

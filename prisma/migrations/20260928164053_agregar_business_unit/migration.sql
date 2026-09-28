-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Semilla fija: id 1 = carnicería, id 2 = charcutería. Los id se fijan a
-- mano (en vez de dejar que AUTOINCREMENT los asigne) porque el resto de
-- esta misma migración agrega columnas businessUnitId con DEFAULT 1 en
-- tablas existentes (Producto, MovimientoInventario, Venta) — necesitan que
-- la fila id=1 exista de verdad, no solo que el número calce por suerte.
INSERT INTO "BusinessUnit" ("id", "codigo", "nombre") VALUES (1, 'carniceria', 'Carnicería');
INSERT INTO "BusinessUnit" ("id", "codigo", "nombre") VALUES (2, 'charcuteria', 'Charcutería');

-- CreateTable
CREATE TABLE "ItemCharcuteria" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoItem" TEXT NOT NULL,
    "businessUnitId" INTEGER NOT NULL DEFAULT 2,
    "unidadMedida" TEXT NOT NULL DEFAULT 'gramos',
    "stockActual" REAL NOT NULL DEFAULT 0,
    "formatoGramos" INTEGER,
    "productoElaboradoId" INTEGER,
    "productoEspejoId" INTEGER,
    "linea" TEXT,
    "costoReferencia" REAL,
    "ingredientes" TEXT,
    "alergenos" TEXT,
    "condicionesConservacion" TEXT,
    "vidaUtilDias" INTEGER,
    "sellosAltoEnTexto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    "creadoPorId" INTEGER NOT NULL,
    CONSTRAINT "ItemCharcuteria_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemCharcuteria_productoElaboradoId_fkey" FOREIGN KEY ("productoElaboradoId") REFERENCES "ItemCharcuteria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemCharcuteria_productoEspejoId_fkey" FOREIGN KEY ("productoEspejoId") REFERENCES "Producto" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemCharcuteria_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MovimientoCharcuteria" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "referenciaTipo" TEXT,
    "referenciaId" INTEGER,
    "usuarioId" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoCharcuteria_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoCharcuteria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoElaboradoId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "rendimientoEsperadoPct" REAL NOT NULL,
    "dosisSalesCurantesPorKg" REAL,
    "parametrosProceso" TEXT,
    "notas" TEXT,
    "creadoPorId" INTEGER NOT NULL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receta_productoElaboradoId_fkey" FOREIGN KEY ("productoElaboradoId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecetaIngrediente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recetaId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "cantidadPorLoteBase" REAL NOT NULL,
    "unidad" TEXT NOT NULL,
    CONSTRAINT "RecetaIngrediente_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "Receta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecetaIngrediente_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrecioTransferencia" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "precioPorKgOUnidad" REAL NOT NULL,
    "vigenteDesde" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" INTEGER NOT NULL,
    CONSTRAINT "PrecioTransferencia_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrecioTransferencia_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferenciaInterna" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoOrigenId" INTEGER NOT NULL,
    "itemDestinoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioTransferenciaId" INTEGER NOT NULL,
    "precioPorKg" REAL NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsableId" INTEGER NOT NULL,
    CONSTRAINT "TransferenciaInterna_productoOrigenId_fkey" FOREIGN KEY ("productoOrigenId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferenciaInterna_itemDestinoId_fkey" FOREIGN KEY ("itemDestinoId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferenciaInterna_precioTransferenciaId_fkey" FOREIGN KEY ("precioTransferenciaId") REFERENCES "PrecioTransferencia" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferenciaInterna_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoteProduccion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "recetaId" INTEGER NOT NULL,
    "recetaVersion" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'en_proceso',
    "fechaElaboracion" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsableId" INTEGER NOT NULL,
    "pesoEntradaKg" REAL,
    "pesoSalidaKg" REAL,
    "mermaEsperadaPct" REAL,
    "mermaRealPct" REAL,
    "horasManoObra" REAL,
    "costoHoraManoObra" REAL,
    "parametrosRealesProceso" TEXT,
    "fechaVencimiento" DATETIME,
    "otrosCostosManuales" REAL,
    "costoTotal" REAL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    CONSTRAINT "LoteProduccion_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "Receta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoteProduccion_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoteVencimientoCambio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loteId" INTEGER NOT NULL,
    "vencimientoAnterior" DATETIME,
    "vencimientoNuevo" DATETIME NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoteVencimientoCambio_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoteVencimientoCambio_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoteInsumoConsumido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loteId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" INTEGER,
    "costoUnitarioAlMomento" REAL NOT NULL,
    CONSTRAINT "LoteInsumoConsumido_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoteInsumoConsumido_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Envasado" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loteId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "cantidadUnidadesGeneradas" INTEGER NOT NULL,
    "pesoNetoPorUnidadG" INTEGER NOT NULL,
    "pesoRealTotalUsadoG" INTEGER NOT NULL,
    "diferenciaPesoG" INTEGER NOT NULL,
    "envaseItemId" INTEGER,
    "envasesConsumidos" INTEGER,
    "etiquetaItemId" INTEGER,
    "etiquetasConsumidas" INTEGER,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsableId" INTEGER NOT NULL,
    CONSTRAINT "Envasado_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envasado_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Envasado_envaseItemId_fkey" FOREIGN KEY ("envaseItemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envasado_etiquetaItemId_fkey" FOREIGN KEY ("etiquetaItemId") REFERENCES "ItemCharcuteria" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Envasado_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockLoteSku" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "loteId" INTEGER NOT NULL,
    "skuId" INTEGER NOT NULL,
    "saldoUnidades" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    CONSTRAINT "StockLoteSku_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLoteSku_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ItemCharcuteria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItemVenta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ventaId" INTEGER NOT NULL,
    "productoId" INTEGER NOT NULL,
    "cantidad" REAL NOT NULL,
    "precioUnitario" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    "loteId" INTEGER,
    "descuentoTipo" TEXT,
    "descuentoValor" REAL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "usuarioAnulacionId" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    CONSTRAINT "ItemVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteProduccion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItemVenta_usuarioAnulacionId_fkey" FOREIGN KEY ("usuarioAnulacionId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ItemVenta" ("anulado", "cantidad", "descuentoTipo", "descuentoValor", "fechaAnulacion", "id", "motivoAnulacion", "precioUnitario", "productoId", "subtotal", "usuarioAnulacionId", "ventaId") SELECT "anulado", "cantidad", "descuentoTipo", "descuentoValor", "fechaAnulacion", "id", "motivoAnulacion", "precioUnitario", "productoId", "subtotal", "usuarioAnulacionId", "ventaId" FROM "ItemVenta";
DROP TABLE "ItemVenta";
ALTER TABLE "new_ItemVenta" RENAME TO "ItemVenta";
CREATE TABLE "new_MovimientoInventario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productoId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "cantidad" REAL NOT NULL,
    "costoUnitario" REAL,
    "proveedorId" INTEGER,
    "numeroFactura" TEXT,
    "businessUnitId" INTEGER NOT NULL DEFAULT 1,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MovimientoInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MovimientoInventario_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MovimientoInventario" ("cantidad", "costoUnitario", "fecha", "id", "motivo", "numeroFactura", "productoId", "proveedorId", "tipo", "usuarioId") SELECT "cantidad", "costoUnitario", "fecha", "id", "motivo", "numeroFactura", "productoId", "proveedorId", "tipo", "usuarioId" FROM "MovimientoInventario";
DROP TABLE "MovimientoInventario";
ALTER TABLE "new_MovimientoInventario" RENAME TO "MovimientoInventario";
CREATE TABLE "new_Producto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plu" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "nombreCorto" TEXT,
    "marca" TEXT,
    "categoriaId" INTEGER NOT NULL,
    "businessUnitId" INTEGER NOT NULL DEFAULT 1,
    "precio" REAL NOT NULL,
    "precioMayor" REAL,
    "costoReferencia" REAL,
    "flagBalanza" TEXT NOT NULL DEFAULT 'NORMAL',
    "codigoBarras" TEXT,
    "contenido" TEXT,
    "capacidadPorCaja" TEXT,
    "envase" TEXT,
    "impuestoAdicional" REAL DEFAULT 0,
    "duracion" TEXT,
    "codigoProveedor" TEXT,
    "aplicaIvaCarne" BOOLEAN NOT NULL DEFAULT false,
    "creadoRapido" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" DATETIME NOT NULL,
    "visibleEnWeb" BOOLEAN NOT NULL DEFAULT true,
    "disponibilidadWeb" TEXT NOT NULL DEFAULT 'disponible',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "lowStock" BOOLEAN NOT NULL DEFAULT false,
    "promoPrecioUnitario" REAL,
    "promoGramosMinimos" INTEGER,
    "promoEtiqueta" TEXT,
    "descripcionCorta" TEXT,
    "familiaCorte" TEXT,
    "pesoPromedioTrozoGramos" INTEGER,
    "opcionesUnidad" TEXT,
    "stockActual" REAL NOT NULL DEFAULT 0,
    "umbralStockBajo" REAL,
    "esCombo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Producto_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Producto" ("activo", "actualizadoEn", "aplicaIvaCarne", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "costoReferencia", "creadoEn", "creadoRapido", "descripcion", "descripcionCorta", "disponibilidadWeb", "duracion", "envase", "esCombo", "familiaCorte", "featured", "flagBalanza", "id", "impuestoAdicional", "lowStock", "marca", "nombreCorto", "opcionesUnidad", "pesoPromedioTrozoGramos", "plu", "precio", "precioMayor", "promoEtiqueta", "promoGramosMinimos", "promoPrecioUnitario", "stockActual", "umbralStockBajo", "visibleEnWeb") SELECT "activo", "actualizadoEn", "aplicaIvaCarne", "capacidadPorCaja", "categoriaId", "codigoBarras", "codigoProveedor", "contenido", "costoReferencia", "creadoEn", "creadoRapido", "descripcion", "descripcionCorta", "disponibilidadWeb", "duracion", "envase", "esCombo", "familiaCorte", "featured", "flagBalanza", "id", "impuestoAdicional", "lowStock", "marca", "nombreCorto", "opcionesUnidad", "pesoPromedioTrozoGramos", "plu", "precio", "precioMayor", "promoEtiqueta", "promoGramosMinimos", "promoPrecioUnitario", "stockActual", "umbralStockBajo", "visibleEnWeb" FROM "Producto";
DROP TABLE "Producto";
ALTER TABLE "new_Producto" RENAME TO "Producto";
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");
CREATE UNIQUE INDEX "Producto_codigoBarras_key" ON "Producto"("codigoBarras");
CREATE TABLE "new_Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rol" TEXT NOT NULL DEFAULT 'caja',
    "hashClavePersonal" TEXT
);
INSERT INTO "new_Usuario" ("activo", "creadoEn", "id", "nombre") SELECT "activo", "creadoEn", "id", "nombre" FROM "Usuario";
DROP TABLE "Usuario";
ALTER TABLE "new_Usuario" RENAME TO "Usuario";
CREATE UNIQUE INDEX "Usuario_nombre_key" ON "Usuario"("nombre");
CREATE TABLE "new_Venta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sesionCajaId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "fecha" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "total" REAL NOT NULL DEFAULT 0,
    "businessUnitId" INTEGER NOT NULL DEFAULT 1,
    "canal" TEXT NOT NULL DEFAULT 'local',
    "esAuxiliar" BOOLEAN NOT NULL DEFAULT false,
    "comentario" TEXT,
    "esDespacho" BOOLEAN NOT NULL DEFAULT false,
    "comunaId" INTEGER,
    "costoEnvio" REAL,
    "descuentoTipo" TEXT,
    "descuentoValor" REAL,
    "usuarioAnulacionId" INTEGER,
    "motivoAnulacion" TEXT,
    "fechaAnulacion" DATETIME,
    "origenPedidoWebId" INTEGER,
    CONSTRAINT "Venta_sesionCajaId_fkey" FOREIGN KEY ("sesionCajaId") REFERENCES "SesionCaja" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Venta_comunaId_fkey" FOREIGN KEY ("comunaId") REFERENCES "Comuna" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Venta_usuarioAnulacionId_fkey" FOREIGN KEY ("usuarioAnulacionId") REFERENCES "Usuario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Venta_origenPedidoWebId_fkey" FOREIGN KEY ("origenPedidoWebId") REFERENCES "PedidoWeb" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Venta" ("comentario", "comunaId", "costoEnvio", "descuentoTipo", "descuentoValor", "esAuxiliar", "esDespacho", "estado", "fecha", "fechaAnulacion", "id", "motivoAnulacion", "origenPedidoWebId", "sesionCajaId", "total", "usuarioAnulacionId", "usuarioId") SELECT "comentario", "comunaId", "costoEnvio", "descuentoTipo", "descuentoValor", "esAuxiliar", "esDespacho", "estado", "fecha", "fechaAnulacion", "id", "motivoAnulacion", "origenPedidoWebId", "sesionCajaId", "total", "usuarioAnulacionId", "usuarioId" FROM "Venta";
DROP TABLE "Venta";
ALTER TABLE "new_Venta" RENAME TO "Venta";
CREATE UNIQUE INDEX "Venta_origenPedidoWebId_key" ON "Venta"("origenPedidoWebId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_codigo_key" ON "BusinessUnit"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCharcuteria_codigo_key" ON "ItemCharcuteria"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCharcuteria_productoEspejoId_key" ON "ItemCharcuteria"("productoEspejoId");

-- CreateIndex
CREATE UNIQUE INDEX "Receta_productoElaboradoId_version_key" ON "Receta"("productoElaboradoId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LoteProduccion_codigo_key" ON "LoteProduccion"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "StockLoteSku_loteId_skuId_key" ON "StockLoteSku"("loteId", "skuId");

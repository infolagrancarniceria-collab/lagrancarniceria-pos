import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";

export const productosRouter = Router();
// Límite de tamaño explícito (antes no había ninguno, sin querer permitía
// subir un archivo de cualquier tamaño a memoria) — 10mb cubre con margen
// un CSV real de todo el catálogo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

productosRouter.get("/", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;
  const stockNegativo = req.query.stockNegativo === "true";
  // Opcional: agrega el último costo de compra de cada producto (para la
  // pantalla Productos, que quiere mostrar costo/precio/margen de un
  // vistazo) — no se calcula por defecto para no cargarle esta consulta
  // extra a los otros lugares que reusan este mismo endpoint solo como
  // buscador (Caja, Cámara, Registrar entrada/salida).
  const incluirCosto = req.query.incluirCosto === "true";
  // A pedido del usuario: el PLU es único incluso para productos ya
  // eliminados (soft-delete, activo: false) — si alguien intenta crear un
  // producto nuevo con un PLU que ya usó uno eliminado, el buscador normal
  // (que solo trae activos) no lo mostraba en ningún lado, así que no había
  // forma de encontrar ni reactivar ese producto. `incluirInactivos=true`
  // (checkbox "Mostrar eliminados" en Productos) también trae los inactivos.
  const incluirInactivos = req.query.incluirInactivos === "true";

  let categoriaIds: number[] | undefined;
  if (categoriaId) {
    categoriaIds = await obtenerIdsCategoriaYDescendientes(categoriaId);
  }

  const productos = await prisma.producto.findMany({
    where: {
      ...(incluirInactivos ? {} : { activo: true }),
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
      ...(stockNegativo ? { stockActual: { lt: 0 } } : {}),
      ...(buscar
        ? {
            OR: [
              { plu: { contains: buscar } },
              { descripcion: { contains: buscar } },
              { nombreCorto: { contains: buscar } },
            ],
          }
        : {}),
    },
    include: { categoria: true },
    orderBy: stockNegativo ? { stockActual: "asc" } : { descripcion: "asc" },
  });

  if (!incluirCosto) {
    return res.json(productos);
  }

  const compras = await prisma.movimientoInventario.findMany({
    where: { tipo: "entrada", motivo: "compra", costoUnitario: { not: null } },
    orderBy: { fecha: "desc" },
    select: { productoId: true, costoUnitario: true },
  });
  const ultimoCostoPorProducto = new Map<number, number>();
  for (const c of compras) {
    if (!ultimoCostoPorProducto.has(c.productoId)) {
      ultimoCostoPorProducto.set(c.productoId, c.costoUnitario!);
    }
  }

  res.json(productos.map((p) => ({ ...p, ultimoCosto: ultimoCostoPorProducto.get(p.id) ?? null })));
});

// Sugerencia de PLU al crear un producto nuevo — el siguiente número libre
// (mayor PLU puramente numérico + 1, considerando también productos
// inactivos porque el PLU es único a nivel de toda la base de datos, no
// solo entre los activos). Solo una sugerencia: el campo sigue siendo
// editable en el formulario, para productos que necesiten calzar con un
// código específico ya conocido (ej. una lista de precios en papel).
productosRouter.get("/proximo-plu", async (_req, res) => {
  const productos = await prisma.producto.findMany({ select: { plu: true } });
  const maxNumerico = productos.reduce((max, p) => (/^\d+$/.test(p.plu) ? Math.max(max, Number(p.plu)) : max), 0);
  res.json({ plu: String(maxNumerico + 1) });
});

// Para la pantalla "Mejor margen" (filtrar rápido qué productos convienen
// más para armar combos): trae, para cada producto activo con al menos una
// compra registrada, su último costo — el margen (%) en sí se calcula en el
// frontend con calcularMargen() (misma fórmula ya usada en la ficha de
// producto), para no duplicar la cuenta en dos lugares. Productos sin
// ninguna compra registrada (sin costo conocido) quedan afuera, para no
// mostrar un margen inventado.
productosRouter.get("/margenes", async (req, res) => {
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;
  let categoriaIds: number[] | undefined;
  if (categoriaId) {
    categoriaIds = await obtenerIdsCategoriaYDescendientes(categoriaId);
  }

  const productos = await prisma.producto.findMany({
    where: { activo: true, ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}) },
    include: { categoria: true },
  });

  // Última compra de cada producto en una sola consulta (en vez de una por
  // producto): como ya viene ordenada por fecha descendente, la primera
  // aparición de cada productoId es su compra más reciente.
  const compras = await prisma.movimientoInventario.findMany({
    where: { tipo: "entrada", motivo: "compra", costoUnitario: { not: null } },
    orderBy: { fecha: "desc" },
    select: { productoId: true, costoUnitario: true, fecha: true },
  });
  const ultimaCompraPorProducto = new Map<number, { costoUnitario: number; fecha: Date }>();
  for (const c of compras) {
    if (!ultimaCompraPorProducto.has(c.productoId)) {
      ultimaCompraPorProducto.set(c.productoId, { costoUnitario: c.costoUnitario!, fecha: c.fecha });
    }
  }

  const resultado = productos
    .map((p) => {
      const ultima = ultimaCompraPorProducto.get(p.id);
      return { ...p, ultimoCosto: ultima?.costoUnitario ?? null, ultimoCostoFecha: ultima?.fecha ?? null };
    })
    .filter((p) => p.ultimoCosto != null);

  res.json(resultado);
});

productosRouter.get("/:id", async (req, res) => {
  const producto = await prisma.producto.findUnique({
    where: { id: Number(req.params.id) },
    include: { categoria: true },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  // Para mostrar el margen (%) al cambiar el precio, y para el aviso de
  // "precio de compra actual / anterior" al registrar una entrada nueva: las
  // 2 compras más recientes de este producto (no hay un campo "costo" fijo
  // en la ficha — el costo real viene del inventario).
  const ultimasCompras = await prisma.movimientoInventario.findMany({
    where: { productoId: producto.id, tipo: "entrada", motivo: "compra", costoUnitario: { not: null } },
    orderBy: { fecha: "desc" },
    take: 2,
  });

  // Igual, pero para el último costo neto/kg registrado en Cámara (lotes),
  // que es un costo aparte del de compras de Inventario — se usa al armar
  // una factura de cámara, para comparar contra la compra anterior de ese
  // mismo producto en cámara específicamente.
  const ultimoLoteCamara = await prisma.loteCamara.findFirst({
    where: { productoId: producto.id },
    orderBy: { fechaIngreso: "desc" },
  });

  res.json({
    ...producto,
    ultimoCosto: ultimasCompras[0]?.costoUnitario ?? null,
    ultimoCostoFecha: ultimasCompras[0]?.fecha ?? null,
    penultimoCosto: ultimasCompras[1]?.costoUnitario ?? null,
    penultimoCostoFecha: ultimasCompras[1]?.fecha ?? null,
    ultimoCostoCamaraKg: ultimoLoteCamara?.costoNetoKg ?? null,
    ultimoCostoCamaraFecha: ultimoLoteCamara?.fechaIngreso ?? null,
  });
});

const flagBalanzaEnum = z.enum(["NORMAL", "PESABLE", "IMPORTE"]);

const productoBaseSchema = z.object({
  plu: z.string().trim().min(1, "El PLU no puede estar vacío"),
  descripcion: z.string().trim().min(1, "La descripción no puede estar vacía"),
  nombreCorto: z.string().trim().optional().nullable(),
  marca: z.string().trim().optional().nullable(),
  categoriaId: z.number().int().positive("Falta la categoría"),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  flagBalanza: flagBalanzaEnum,
  codigoBarras: z.string().trim().optional().nullable(),
  contenido: z.string().trim().optional().nullable(),
  capacidadPorCaja: z.string().trim().optional().nullable(),
  envase: z.string().trim().optional().nullable(),
  impuestoAdicional: z.number().min(0).optional().nullable(),
  duracion: z.string().trim().optional().nullable(),
  codigoProveedor: z.string().trim().optional().nullable(),
  umbralStockBajo: z.number().min(0).optional().nullable(),
  precioMayor: z.number().positive().optional().nullable(),
  // Familia para el selector de corte en la web (ej. "Vacuno", "Cerdo") —
  // null si el producto no debe mostrar selector de corte.
  familiaCorte: z.string().trim().optional().nullable(),
  // Texto corto para la tarjeta de producto en la web (opcional).
  descripcionCorta: z.string().trim().optional().nullable(),
  // Promoción por volumen en la web — los tres van juntos: si se llena uno
  // hay que llenar los tres (se valida en el frontend, ver ProductoForm).
  promoPrecioUnitario: z.number().positive().optional().nullable(),
  promoGramosMinimos: z.number().int().positive().optional().nullable(),
  promoEtiqueta: z.string().trim().optional().nullable(),
});

function validarCodigoBarrasVsFlag(data: {
  flagBalanza: string;
  codigoBarras?: string | null;
}): string | null {
  if (data.flagBalanza !== "NORMAL" && data.codigoBarras) {
    return "El código de barras (EAN) solo aplica a productos con Flag Balanza = Normal; los productos pesables/importe usan el código que imprime la balanza";
  }
  return null;
}

productosRouter.post("/", async (req, res) => {
  const parsed = productoBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const errorFlag = validarCodigoBarrasVsFlag(data);
  if (errorFlag) return res.status(400).json({ error: errorFlag });

  const categoria = await prisma.categoria.findUnique({ where: { id: data.categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  const pluExistente = await prisma.producto.findUnique({ where: { plu: data.plu } });
  if (pluExistente) {
    return res.status(409).json({
      error: pluExistente.activo
        ? "Ya existe un producto con ese PLU"
        : `Ese PLU ya lo usó "${pluExistente.descripcion}", un producto eliminado — actívalo "Mostrar eliminados" en Productos para reactivarlo en vez de crear uno nuevo`,
    });
  }

  if (data.codigoBarras) {
    const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: data.codigoBarras } });
    if (eanExistente) return res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  }

  const producto = await prisma.producto.create({
    data: { ...data, codigoBarras: data.codigoBarras || null },
    include: { categoria: true },
  });
  void sincronizarCatalogoConWeb();
  res.status(201).json(producto);
});

// El precio NO se edita por esta vía a propósito: todo cambio de precio debe
// pasar por /:id/precio para quedar registrado en el historial.
const productoUpdateSchema = productoBaseSchema.omit({ precio: true });

productosRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  const parsed = productoUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;

  const errorFlag = validarCodigoBarrasVsFlag(data);
  if (errorFlag) return res.status(400).json({ error: errorFlag });

  const categoria = await prisma.categoria.findUnique({ where: { id: data.categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  if (data.plu !== existente.plu) {
    const pluExistente = await prisma.producto.findUnique({ where: { plu: data.plu } });
    if (pluExistente) return res.status(409).json({ error: "Ya existe un producto con ese PLU" });
  }
  if (data.codigoBarras && data.codigoBarras !== existente.codigoBarras) {
    const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: data.codigoBarras } });
    if (eanExistente) return res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  }

  const producto = await prisma.producto.update({
    where: { id },
    data: { ...data, codigoBarras: data.codigoBarras || null },
    include: { categoria: true },
  });
  void sincronizarCatalogoConWeb();
  res.json(producto);
});

productosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  await prisma.producto.update({ where: { id }, data: { activo: false } });
  void sincronizarCatalogoConWeb();
  res.status(204).send();
});

// Vuelve a activar un producto eliminado — para cuando alguien quiere
// reusar su PLU en vez de crear uno nuevo (ver el mensaje de error en
// POST /, que apunta acá).
productosRouter.post("/:id/reactivar", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });
  if (existente.activo) return res.status(400).json({ error: "Este producto ya está activo" });

  const producto = await prisma.producto.update({
    where: { id },
    data: { activo: true },
    include: { categoria: true },
  });
  void sincronizarCatalogoConWeb();
  res.json(producto);
});

// Toggle rápido de visibilidad en la web (pantalla "Productos" — casillas
// "Oculto", "Destacado", "Pocas unidades" + selector de disponibilidad).
// Separado del PUT normal a propósito, para no obligar a mandar todos los
// demás campos del producto solo para tildar una casilla.
const webVisibilidadSchema = z.object({
  visibleEnWeb: z.boolean().optional(),
  disponibilidadWeb: z.enum(["disponible", "agotado", "proximamente"]).optional(),
  featured: z.boolean().optional(),
  lowStock: z.boolean().optional(),
});

productosRouter.put("/:id/web", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  const parsed = webVisibilidadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const producto = await prisma.producto.update({
    where: { id },
    data: parsed.data,
    include: { categoria: true },
  });
  void sincronizarCatalogoConWeb();
  res.json(producto);
});

// Cambio rápido del precio de venta al por mayor — a diferencia de "precio"
// (venta normal), este campo no pasa por el historial de cambios: es solo
// un valor de referencia editable directo, pensado para ajustarlo al vuelo
// mientras se carga una factura de cámara.
const precioMayorSchema = z.object({ precioMayor: z.number().positive("El precio debe ser mayor a 0") });

productosRouter.put("/:id/precio-mayor", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = precioMayorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  const producto = await prisma.producto.update({
    where: { id },
    data: { precioMayor: parsed.data.precioMayor },
    include: { categoria: true },
  });
  res.json(producto);
});

// --- Categorizar varios productos a la vez (ej. ordenar los que quedaron
// "Sin categorizar") — solo cambia la categoría, no toca ningún otro campo.

const categorizarMasivoSchema = z.object({
  productoIds: z.array(z.number().int().positive()).min(1, "Elige al menos un producto"),
  categoriaId: z.number().int().positive(),
});

productosRouter.post("/categorizar-masivo", async (req, res) => {
  const parsed = categorizarMasivoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoIds, categoriaId } = parsed.data;

  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } });
  if (!categoria) return res.status(400).json({ error: "La categoría indicada no existe" });

  const resultado = await prisma.producto.updateMany({
    where: { id: { in: productoIds } },
    data: { categoriaId },
  });
  void sincronizarCatalogoConWeb();
  res.json({ actualizados: resultado.count });
});

// --- Eliminar varios productos a la vez (ej. limpiar productos basura de
// una importación) — mismo borrado lógico (activo: false) que el DELETE de
// un solo producto, no borra filas de la base de datos.

const eliminarMasivoSchema = z.object({
  productoIds: z.array(z.number().int().positive()).min(1, "Elige al menos un producto"),
});

productosRouter.post("/eliminar-masivo", async (req, res) => {
  const parsed = eliminarMasivoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const resultado = await prisma.producto.updateMany({
    where: { id: { in: parsed.data.productoIds } },
    data: { activo: false },
  });
  void sincronizarCatalogoConWeb();
  res.json({ eliminados: resultado.count });
});

// --- Importar catálogo desde CSV (crear productos nuevos, no cambia precios
// de productos existentes) — columnas: plu,descripcion,precio,flag_balanza,
// categoria_codigo (categoria_codigo es opcional: si se deja vacío, el
// producto queda en la categoría "Sin categorizar" para ordenar después). ---

const CODIGO_CATEGORIA_SIN_CATEGORIZAR = "00";

interface FilaImportacion {
  fila: number;
  plu: string;
  descripcion: string;
  precio: number | null;
  flagBalanza: string | null;
  categoriaCodigo: string | null;
  yaExiste: boolean;
  error: string | null;
}

async function procesarCsvImportacion(buffer: Buffer): Promise<FilaImportacion[]> {
  let registros: Record<string, string>[];
  try {
    registros = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    throw new Error(
      "No se pudo leer el archivo. Debe ser un CSV con columnas: plu,descripcion,precio,flag_balanza,categoria_codigo"
    );
  }

  const resultado: FilaImportacion[] = [];
  for (let i = 0; i < registros.length; i++) {
    const fila = i + 2;
    const plu = (registros[i].plu ?? "").trim();
    const descripcion = (registros[i].descripcion ?? "").trim();
    const precioTexto = (registros[i].precio ?? "").trim();
    const flagBalanza = (registros[i].flag_balanza ?? "").trim().toUpperCase();
    const categoriaCodigo = (registros[i].categoria_codigo ?? "").trim() || null;

    const base = { fila, plu, descripcion, categoriaCodigo, yaExiste: false };

    if (!plu) {
      resultado.push({ ...base, precio: null, flagBalanza: null, error: "Falta el PLU" });
      continue;
    }
    if (!descripcion) {
      resultado.push({ ...base, precio: null, flagBalanza: null, error: "Falta la descripción" });
      continue;
    }
    const precio = Number(precioTexto);
    if (!precioTexto || Number.isNaN(precio) || precio <= 0) {
      resultado.push({ ...base, precio: null, flagBalanza: null, error: "precio inválido" });
      continue;
    }
    if (!flagBalanzaEnum.safeParse(flagBalanza).success) {
      resultado.push({ ...base, precio, flagBalanza: null, error: "flag_balanza debe ser NORMAL, PESABLE o IMPORTE" });
      continue;
    }

    const existente = await prisma.producto.findUnique({ where: { plu } });
    if (existente) {
      resultado.push({ ...base, precio, flagBalanza, yaExiste: true, error: "Ya existe un producto con ese PLU — se omite" });
      continue;
    }

    resultado.push({ ...base, precio, flagBalanza, error: null });
  }
  return resultado;
}

productosRouter.post("/importar-csv", upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo CSV" });
  const confirmar = req.body.confirmar === "true";

  let filas: FilaImportacion[];
  try {
    filas = await procesarCsvImportacion(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  if (!confirmar) {
    return res.json({ previsualizacion: true, filas });
  }

  const filasValidas = filas.filter((f) => !f.error && f.precio && f.flagBalanza);

  const codigosCategoria = new Set(
    filasValidas.map((f) => f.categoriaCodigo ?? CODIGO_CATEGORIA_SIN_CATEGORIZAR)
  );
  const categoriaIdPorCodigo = new Map<string, number>();
  for (const codigo of codigosCategoria) {
    let categoria = await prisma.categoria.findUnique({ where: { codigo } });
    if (!categoria && codigo === CODIGO_CATEGORIA_SIN_CATEGORIZAR) {
      categoria = await prisma.categoria.create({
        data: { codigo: CODIGO_CATEGORIA_SIN_CATEGORIZAR, nombre: "Sin categorizar", nivel: 1 },
      });
    }
    if (!categoria) {
      return res.status(400).json({ error: `No existe la categoría con código "${codigo}"` });
    }
    categoriaIdPorCodigo.set(codigo, categoria.id);
  }

  const creados = await prisma.$transaction(
    filasValidas.map((f) =>
      prisma.producto.create({
        data: {
          plu: f.plu,
          descripcion: f.descripcion,
          precio: f.precio!,
          flagBalanza: f.flagBalanza!,
          categoriaId: categoriaIdPorCodigo.get(f.categoriaCodigo ?? CODIGO_CATEGORIA_SIN_CATEGORIZAR)!,
        },
      })
    )
  );

  void sincronizarCatalogoConWeb();
  res.json({ previsualizacion: false, filas, creados: creados.length });
});

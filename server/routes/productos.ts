import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";

export const productosRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

productosRouter.get("/", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";
  const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : undefined;

  let categoriaIds: number[] | undefined;
  if (categoriaId) {
    categoriaIds = await obtenerIdsCategoriaYDescendientes(categoriaId);
  }

  const productos = await prisma.producto.findMany({
    where: {
      activo: true,
      ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
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
    orderBy: { descripcion: "asc" },
  });
  res.json(productos);
});

productosRouter.get("/:id", async (req, res) => {
  const producto = await prisma.producto.findUnique({
    where: { id: Number(req.params.id) },
    include: { categoria: true },
  });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(producto);
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
  if (pluExistente) return res.status(409).json({ error: "Ya existe un producto con ese PLU" });

  if (data.codigoBarras) {
    const eanExistente = await prisma.producto.findUnique({ where: { codigoBarras: data.codigoBarras } });
    if (eanExistente) return res.status(409).json({ error: "Ya existe un producto con ese código de barras" });
  }

  const producto = await prisma.producto.create({
    data: { ...data, codigoBarras: data.codigoBarras || null },
    include: { categoria: true },
  });
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
  res.json(producto);
});

productosRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existente = await prisma.producto.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Producto no encontrado" });

  await prisma.producto.update({ where: { id }, data: { activo: false } });
  res.status(204).send();
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
  res.json({ actualizados: resultado.count });
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

  res.json({ previsualizacion: false, filas, creados: creados.length });
});

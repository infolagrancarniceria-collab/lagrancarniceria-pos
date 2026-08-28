import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerIdsCategoriaYDescendientes } from "../lib/categorias";
import { verificarClaveConLimite } from "../lib/clave";
import { sincronizarCatalogoConWeb } from "../lib/syncWeb";

export const preciosRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// --- Cambio de precio individual ---

const cambioIndividualSchema = z.object({
  productoId: z.number().int().positive(),
  precioNuevo: z.number().positive("El precio debe ser mayor a 0"),
  usuarioId: z.number().int().positive(),
  // Solo los manda el cambio rápido de precio desde Punto de venta — el
  // resto de los llamadores (Productos, Entrada de cámara) nunca los pasan,
  // así que el cambio sigue sin pedir clave ahí, igual que siempre.
  clave: z.string().optional(),
  motivoAutorizacion: z.string().trim().optional(),
});

preciosRouter.post("/individual", async (req, res) => {
  const parsed = cambioIndividualSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, precioNuevo, usuarioId, clave, motivoAutorizacion } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  if (clave != null) {
    const claveSupervisor = await prisma.claveSupervisor.findFirst();
    if (!claveSupervisor) {
      return res.status(403).json({ error: "Clave de supervisor incorrecta" });
    }
    const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
    if (resultadoClave.bloqueado) {
      return res.status(429).json({
        error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo`,
      });
    }
    if (!resultadoClave.valida) {
      return res.status(403).json({ error: "Clave de supervisor incorrecta" });
    }
  }

  const [productoActualizado] = await prisma.$transaction([
    prisma.producto.update({ where: { id: productoId }, data: { precio: precioNuevo } }),
    prisma.historialPrecio.create({
      data: {
        productoId,
        usuarioId,
        precioAnterior: producto.precio,
        precioNuevo,
        tipoCambio: clave != null ? "individual_caja" : "individual",
        motivoAutorizacion: clave != null ? motivoAutorizacion || null : null,
      },
    }),
  ]);

  void sincronizarCatalogoConWeb();
  res.json(productoActualizado);
});

// --- Cambio masivo por categoría ---

function calcularPrecioNuevo(precioActual: number, tipo: "porcentaje" | "monto_fijo", valor: number): number {
  const bruto = tipo === "porcentaje" ? precioActual * (1 + valor / 100) : precioActual + valor;
  return Math.max(1, Math.round(bruto));
}

const cambioMasivoCategoriaSchema = z.object({
  categoriaId: z.number().int().positive(),
  tipo: z.enum(["porcentaje", "monto_fijo"]),
  valor: z.number(),
  usuarioId: z.number().int().positive(),
  confirmar: z.boolean().optional().default(false),
});

preciosRouter.post("/masivo-categoria", async (req, res) => {
  const parsed = cambioMasivoCategoriaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { categoriaId, tipo, valor, usuarioId, confirmar } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const categoriaIds = await obtenerIdsCategoriaYDescendientes(categoriaId);
  const productos = await prisma.producto.findMany({
    where: { activo: true, categoriaId: { in: categoriaIds } },
  });

  const cambios = productos.map((p) => ({
    productoId: p.id,
    plu: p.plu,
    descripcion: p.descripcion,
    precioActual: p.precio,
    precioNuevo: calcularPrecioNuevo(p.precio, tipo, valor),
  }));

  if (!confirmar) {
    return res.json({ previsualizacion: true, cambios });
  }

  await prisma.$transaction(
    cambios.flatMap((c) => [
      prisma.producto.update({ where: { id: c.productoId }, data: { precio: c.precioNuevo } }),
      prisma.historialPrecio.create({
        data: {
          productoId: c.productoId,
          usuarioId,
          precioAnterior: c.precioActual,
          precioNuevo: c.precioNuevo,
          tipoCambio: "masivo_categoria",
        },
      }),
    ])
  );

  void sincronizarCatalogoConWeb();
  res.json({ previsualizacion: false, cambios });
});

// --- Cambio masivo por planilla CSV (columnas: plu,precio_nuevo) ---

interface FilaCsv {
  fila: number;
  plu: string;
  precioNuevo: number | null;
  productoId: number | null;
  descripcion: string | null;
  precioActual: number | null;
  error: string | null;
}

async function procesarCsv(buffer: Buffer): Promise<FilaCsv[]> {
  let registros: Record<string, string>[];
  try {
    registros = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    throw new Error("No se pudo leer el archivo. Debe ser un CSV con columnas: plu,precio_nuevo");
  }

  const resultado: FilaCsv[] = [];
  for (let i = 0; i < registros.length; i++) {
    const fila = i + 2; // +1 por índice base 0, +1 por la fila de encabezado
    const plu = (registros[i].plu ?? "").trim();
    const precioTexto = (registros[i].precio_nuevo ?? "").trim();

    if (!plu) {
      resultado.push({ fila, plu, precioNuevo: null, productoId: null, descripcion: null, precioActual: null, error: "Falta el PLU" });
      continue;
    }
    const precioNuevo = Number(precioTexto);
    if (!precioTexto || Number.isNaN(precioNuevo) || precioNuevo <= 0) {
      resultado.push({ fila, plu, precioNuevo: null, productoId: null, descripcion: null, precioActual: null, error: "precio_nuevo inválido" });
      continue;
    }

    const producto = await prisma.producto.findUnique({ where: { plu } });
    if (!producto) {
      resultado.push({ fila, plu, precioNuevo, productoId: null, descripcion: null, precioActual: null, error: "No existe un producto con ese PLU" });
      continue;
    }

    resultado.push({
      fila,
      plu,
      precioNuevo,
      productoId: producto.id,
      descripcion: producto.descripcion,
      precioActual: producto.precio,
      error: null,
    });
  }
  return resultado;
}

preciosRouter.post("/masivo-csv", upload.single("archivo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo CSV" });

  const usuarioId = Number(req.body.usuarioId);
  const confirmar = req.body.confirmar === "true";

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  let filas: FilaCsv[];
  try {
    filas = await procesarCsv(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  if (!confirmar) {
    return res.json({ previsualizacion: true, filas });
  }

  const filasValidas = filas.filter((f) => !f.error && f.productoId && f.precioNuevo);
  await prisma.$transaction(
    filasValidas.flatMap((f) => [
      prisma.producto.update({ where: { id: f.productoId! }, data: { precio: f.precioNuevo! } }),
      prisma.historialPrecio.create({
        data: {
          productoId: f.productoId!,
          usuarioId,
          precioAnterior: f.precioActual!,
          precioNuevo: f.precioNuevo!,
          tipoCambio: "masivo_csv",
        },
      }),
    ])
  );

  void sincronizarCatalogoConWeb();
  res.json({ previsualizacion: false, filas, aplicados: filasValidas.length });
});

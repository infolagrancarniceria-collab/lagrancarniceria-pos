import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { validarUsuarioActivo, ROLES_CHARCUTERIA, establecerClavePersonal } from "../lib/rolesCharcuteria";
import { verificarClaveConLimite } from "../lib/clave";
import type { Prisma } from "@prisma/client";

export const charcuteriaRouter = Router();

// --- Unidades de negocio ---

charcuteriaRouter.get("/business-units", async (_req, res) => {
  const unidades = await prisma.businessUnit.findMany({ orderBy: { id: "asc" } });
  res.json(unidades);
});

// --- Configuración (umbral de "por vencer") ---

async function obtenerConfigCharcuteria() {
  const existente = await prisma.configuracionCharcuteria.findFirst();
  if (existente) return existente;
  return prisma.configuracionCharcuteria.create({ data: {} });
}

charcuteriaRouter.get("/configuracion", async (_req, res) => {
  res.json(await obtenerConfigCharcuteria());
});

const configSchema = z.object({ umbralVencimientoDias: z.number().int().positive() });

charcuteriaRouter.put("/configuracion", async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const existente = await obtenerConfigCharcuteria();
  const actualizada = await prisma.configuracionCharcuteria.update({
    where: { id: existente.id },
    data: parsed.data,
  });
  res.json(actualizada);
});

// --- Roles y clave personal ---
// Sin RLS (SQLite no la soporta) — la autorización vive en cada ruta del
// servidor, ver server/lib/rolesCharcuteria.ts.

// Asignar/cambiar el rol de un usuario requiere la clave de SUPERVISOR
// (la única autoridad ya establecida en el resto del sistema) — evita el
// problema de "quién es el primer admin" sin inventar una cuenta especial
// nueva. La clave PERSONAL de cada usuario, en cambio, se usa después solo
// para sus propias acciones del día a día dentro de este módulo (ver
// verificarClavePersonal).
const cambiarRolSchema = z.object({
  clave: z.string().min(1, "Falta la clave de supervisor"),
  rol: z.enum(ROLES_CHARCUTERIA),
});

charcuteriaRouter.put("/usuarios/:id/rol", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = cambiarRolSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  const resultado = verificarClaveConLimite(req.ip ?? "desconocido", parsed.data.clave, claveSupervisor.hashClave);
  if (resultado.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultado.valida) return res.status(403).json({ error: "Clave de supervisor incorrecta" });

  const usuario = await prisma.usuario.findUnique({ where: { id } });
  if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

  const actualizado = await prisma.usuario.update({ where: { id }, data: { rol: parsed.data.rol } });
  // Ver comentario en usuarios.ts: el hash de la clave personal nunca debe
  // llegar al cliente.
  const { hashClavePersonal: _hashClavePersonal, ...sinClave } = actualizado;
  res.json(sinClave);
});

const establecerClaveSchema = z.object({ claveNueva: z.string().min(4, "La clave debe tener al menos 4 caracteres") });

// Cada usuario configura su propia clave personal — no requiere la clave
// anterior (mismo criterio que "olvidé mi clave": cualquiera con acceso al
// programa ya está dentro del local, se confía en la red igual que el
// resto del sistema) ni la de otro usuario, solo su propio id.
charcuteriaRouter.put("/usuarios/:id/clave-personal", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = establecerClaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const usuario = await validarUsuarioActivo(id);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  await establecerClavePersonal(id, parsed.data.claveNueva);
  res.status(204).send();
});

// --- Catálogo (ItemCharcuteria) ---

export const TIPOS_ITEM = ["materia_prima", "insumo", "envase_etiqueta", "producto_elaborado", "producto_terminado"] as const;
const tipoItemEnum = z.enum(TIPOS_ITEM);

const itemConIncludes = {
  productoElaborado: true,
  productoEspejo: true,
} satisfies Prisma.ItemCharcuteriaInclude;

charcuteriaRouter.get("/items", async (req, res) => {
  const tipoItem = typeof req.query.tipoItem === "string" ? req.query.tipoItem : undefined;
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : undefined;
  const incluirInactivos = req.query.incluirInactivos === "true";

  if (tipoItem && !TIPOS_ITEM.includes(tipoItem as (typeof TIPOS_ITEM)[number])) {
    return res.status(400).json({ error: "tipoItem inválido" });
  }

  const items = await prisma.itemCharcuteria.findMany({
    where: {
      ...(tipoItem ? { tipoItem } : {}),
      ...(incluirInactivos ? {} : { activo: true }),
      ...(buscar
        ? { OR: [{ nombre: { contains: buscar } }, { codigo: { contains: buscar } }] }
        : {}),
    },
    include: itemConIncludes,
    orderBy: { nombre: "asc" },
  });
  res.json(items);
});

charcuteriaRouter.get("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.itemCharcuteria.findUnique({ where: { id }, include: itemConIncludes });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });
  res.json(item);
});

const crearItemSchema = z
  .object({
    usuarioId: z.number().int().positive(),
    codigo: z.string().trim().min(1, "Falta el código"),
    nombre: z.string().trim().min(1, "Falta el nombre"),
    tipoItem: tipoItemEnum,
    unidadMedida: z.enum(["gramos", "unidad"]).default("gramos"),
    costoReferencia: z.number().positive().optional().nullable(),
    // --- Solo producto_elaborado (rotulado) ---
    ingredientes: z.string().trim().optional().nullable(),
    alergenos: z.string().trim().optional().nullable(),
    condicionesConservacion: z.string().trim().optional().nullable(),
    vidaUtilDias: z.number().int().positive().optional().nullable(),
    sellosAltoEnTexto: z.string().trim().optional().nullable(),
    // --- Solo producto_terminado ---
    formatoGramos: z.number().int().positive().optional().nullable(),
    productoElaboradoId: z.number().int().positive().optional().nullable(),
    linea: z.enum(["tabla", "fiestas"]).optional().nullable(),
    // Precio de venta con IVA para el SKU — se copia a la fila espejo en
    // Producto (ver más abajo); no se guarda en ItemCharcuteria porque el
    // precio real de venta siempre vive en Producto.precio, para no tener
    // dos fuentes de verdad. Si se vincula un producto existente
    // (productoExistenteId) es opcional: sin valor, se deja el precio que
    // el producto ya tenía.
    precioVenta: z.number().positive().optional(),
    // Vincular un producto que ya existe en el catálogo de carnicería como
    // espejo del SKU nuevo, en vez de crear uno desde cero — evita
    // duplicar productos que ya se vendían antes de este módulo (ver
    // GET /productos-vinculables). Solo aplica a producto_terminado.
    productoExistenteId: z.number().int().positive().optional().nullable(),
  })
  .refine((d) => d.tipoItem !== "producto_terminado" || d.productoExistenteId != null || d.precioVenta != null, {
    message: "Falta el precio de venta",
    path: ["precioVenta"],
  });

// Categoría fija donde viven los productos "espejo" de charcutería dentro
// del catálogo de Producto — se crea sola la primera vez que hace falta.
// No se expone para editar: es solo un casillero técnico, no algo que el
// equipo necesite tocar (a diferencia de las categorías reales de
// carnicería, que sí clasifican productos que la gente busca).
async function obtenerCategoriaCharcuteria(tx: Prisma.TransactionClient) {
  const existente = await tx.categoria.findUnique({ where: { codigo: "CHARCUTERIA" } });
  if (existente) return existente;
  return tx.categoria.create({ data: { codigo: "CHARCUTERIA", nombre: "Charcutería", nivel: 1 } });
}

// Buscador para "vincular un producto existente" al crear un SKU de
// charcutería (ver POST /items, productoExistenteId): solo productos de
// carnicería (businessUnitId 1) activos que todavía no son la fila espejo
// de ningún ítem de charcutería.
charcuteriaRouter.get("/productos-vinculables", async (req, res) => {
  const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim() : "";

  const yaVinculados = await prisma.itemCharcuteria.findMany({
    where: { productoEspejoId: { not: null } },
    select: { productoEspejoId: true },
  });
  const idsVinculados = yaVinculados
    .map((i) => i.productoEspejoId)
    .filter((id): id is number => id != null);

  const productos = await prisma.producto.findMany({
    where: {
      activo: true,
      businessUnitId: 1,
      id: { notIn: idsVinculados },
      ...(buscar ? { OR: [{ plu: { contains: buscar } }, { descripcion: { contains: buscar } }] } : {}),
    },
    orderBy: { descripcion: "asc" },
    take: 20,
  });
  res.json(productos);
});

charcuteriaRouter.post("/items", async (req, res) => {
  const parsed = crearItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const codigoExistente = await prisma.itemCharcuteria.findUnique({ where: { codigo: data.codigo } });
  if (codigoExistente) return res.status(409).json({ error: "Ya existe un ítem con ese código" });

  if (data.tipoItem === "producto_terminado" && data.productoElaboradoId) {
    const elaborado = await prisma.itemCharcuteria.findUnique({ where: { id: data.productoElaboradoId } });
    if (!elaborado || elaborado.tipoItem !== "producto_elaborado") {
      return res.status(400).json({ error: "El producto elaborado indicado no existe o no es del tipo correcto" });
    }
  }

  // Vincular un producto que ya existía en el catálogo de carnicería (ej.
  // el Pastrami, cargado antes de que existiera este módulo) en vez de
  // crear uno nuevo — evita duplicarlo, conservando su mismo PLU, stock e
  // historial de ventas.
  let productoExistente: Awaited<ReturnType<typeof prisma.producto.findUnique>> = null;
  if (data.tipoItem === "producto_terminado" && data.productoExistenteId) {
    productoExistente = await prisma.producto.findUnique({ where: { id: data.productoExistenteId } });
    if (!productoExistente || !productoExistente.activo) {
      return res.status(400).json({ error: "El producto indicado no existe o está inactivo" });
    }
    const yaVinculado = await prisma.itemCharcuteria.findUnique({
      where: { productoEspejoId: productoExistente.id },
    });
    if (yaVinculado) {
      return res.status(409).json({ error: "Ese producto ya está vinculado a otro ítem de charcutería" });
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    let productoEspejoId: number | null = null;

    // Solo el SKU vendible (producto_terminado) tiene fila espejo en
    // Producto, para venderse por el flujo de Caja existente sin tocarlo
    // (ver comentario en schema.prisma). flagBalanza se decide solo según
    // si tiene formato fijo (NORMAL, se vende por unidad) o va a granel
    // (PESABLE, se vende por peso) — mismo criterio que ya usa el resto
    // del catálogo de carnicería.
    if (data.tipoItem === "producto_terminado") {
      if (productoExistente) {
        // Solo se toca lo necesario para que pase a venderse como SKU de
        // charcutería — plu, descripción, categoría y stockActual quedan
        // tal cual estaban (nunca se destruye ese historial). Si el SKU
        // queda con formato fijo, ese stock heredado no va a estar
        // asociado a ningún lote hasta que se registre uno nuevo en
        // Producción — Caja bloqueará la venta mientras tanto (mismo
        // chequeo que ya existe para cualquier SKU con formato fijo, ver
        // POST /caja/ventas/:id/confirmar).
        const actualizado = await tx.producto.update({
          where: { id: productoExistente.id },
          data: {
            businessUnitId: 2,
            flagBalanza: data.formatoGramos != null ? "NORMAL" : "PESABLE",
            ...(data.precioVenta != null ? { precio: data.precioVenta } : {}),
          },
        });
        productoEspejoId = actualizado.id;
      } else {
        const categoria = await obtenerCategoriaCharcuteria(tx);
        const espejo = await tx.producto.create({
          data: {
            plu: `CH-${data.codigo}`,
            descripcion: data.nombre,
            categoriaId: categoria.id,
            businessUnitId: 2,
            precio: data.precioVenta!,
            flagBalanza: data.formatoGramos != null ? "NORMAL" : "PESABLE",
          },
        });
        productoEspejoId = espejo.id;
      }
    }

    return tx.itemCharcuteria.create({
      data: {
        codigo: data.codigo,
        nombre: data.nombre,
        tipoItem: data.tipoItem,
        unidadMedida: data.unidadMedida,
        costoReferencia: data.costoReferencia ?? null,
        ingredientes: data.ingredientes ?? null,
        alergenos: data.alergenos ?? null,
        condicionesConservacion: data.condicionesConservacion ?? null,
        vidaUtilDias: data.vidaUtilDias ?? null,
        sellosAltoEnTexto: data.sellosAltoEnTexto ?? null,
        formatoGramos: data.formatoGramos ?? null,
        productoElaboradoId: data.productoElaboradoId ?? null,
        linea: data.linea ?? null,
        productoEspejoId,
        creadoPorId: data.usuarioId,
      },
      include: itemConIncludes,
    });
  });

  res.status(201).json(item);
});

const editarItemSchema = crearItemSchema.innerType().partial().extend({
  usuarioId: z.number().int().positive(),
});

charcuteriaRouter.put("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = editarItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const item = await prisma.itemCharcuteria.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });

  // productoExistenteId solo tiene sentido al crear (decide si se vincula
  // un producto ya existente en vez de crear uno nuevo) — no es una
  // columna real de ItemCharcuteria, así que nunca se debe reenviar acá.
  const { usuarioId: _usuarioId, codigo: _codigo, tipoItem: _tipoItem, precioVenta, productoExistenteId: _productoExistenteId, ...cambios } = data;

  const actualizado = await prisma.$transaction(async (tx) => {
    // El precio de venta de un SKU vendible se edita a través de la fila
    // espejo (mismo mecanismo — y mismo historial vía HistorialPrecio — que
    // cualquier otro producto del catálogo), no directo acá.
    if (precioVenta != null && item.productoEspejoId) {
      await tx.producto.update({ where: { id: item.productoEspejoId }, data: { precio: precioVenta } });
    }
    return tx.itemCharcuteria.update({ where: { id }, data: cambios, include: itemConIncludes });
  });

  res.json(actualizado);
});

charcuteriaRouter.delete("/items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.itemCharcuteria.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });

  await prisma.$transaction(async (tx) => {
    await tx.itemCharcuteria.update({ where: { id }, data: { activo: false } });
    if (item.productoEspejoId) {
      await tx.producto.update({ where: { id: item.productoEspejoId }, data: { activo: false } });
    }
  });
  res.status(204).send();
});

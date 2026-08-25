import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { rangoFechasDesdeTexto, parsearFechaSoloDia } from "./reportes";
import { verificarClaveConLimite } from "../lib/clave";

// Verifica la clave de supervisor con el mismo límite de intentos que ya usa
// Caja (5 fallidos seguidos por IP bloquean 1 minuto) — reutilizado acá para
// anular una caja o un lote de cámara, que antes solo pedían un motivo.
async function verificarClaveSupervisor(
  req: { ip?: string },
  clave: string
): Promise<{ status: number; error: string } | null> {
  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) return { status: 403, error: "Clave de supervisor incorrecta" };
  const resultado = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultado.bloqueado) {
    return { status: 429, error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` };
  }
  if (!resultado.valida) return { status: 403, error: "Clave de supervisor incorrecta" };
  return null;
}

export const camaraRouter = Router();

// Lista fija, igual a la que ya usaba el papá del usuario en su propio
// sistema — reemplaza la familia que antes se sacaba sola de la categoría
// del producto (más flexible en teoría, pero no calzaba con la lista corta
// que él ya conoce de memoria).
export const FAMILIAS_CAMARA = ["Vacuno", "Cerdo", "Pollo", "Otros"] as const;
const familiaCamaraEnum = z.enum(FAMILIAS_CAMARA);

// Solo aplica a la familia "Vacuno" — de dónde viene la carne.
export const PROCEDENCIAS_VACUNO = ["Nacional", "Brasil", "Paraguay"] as const;
const procedenciaCamaraEnum = z.enum(PROCEDENCIAS_VACUNO);

// Vacuno exige elegir procedencia; las demás familias no la usan — se
// valida acá en vez de en el schema de zod porque depende de otro campo
// (familia), y para dar un mensaje de error específico según el caso.
function validarProcedencia(familia: string, procedencia: string | undefined | null): string | null {
  if (familia === "Vacuno" && !procedencia) return "Falta indicar la procedencia (Nacional, Brasil o Paraguay)";
  if (familia !== "Vacuno" && procedencia) return "La procedencia solo aplica a la familia Vacuno";
  return null;
}

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// Reparte un peso total entre N cajas sin perder ni un gramo por redondeo:
// se trabaja en gramos enteros, y lo que sobra de la división (el resto) se
// reparte de a un gramo extra en las primeras cajas. La suma de lo
// devuelto siempre da exactamente el peso total pedido.
export function repartirPesoKg(pesoTotalKg: number, cantidadCajas: number): number[] {
  const gramosTotal = Math.round(pesoTotalKg * 1000);
  const base = Math.floor(gramosTotal / cantidadCajas);
  const resto = gramosTotal - base * cantidadCajas;
  return Array.from({ length: cantidadCajas }, (_, i) => (base + (i < resto ? 1 : 0)) / 1000);
}

const cajaConIncludes = {
  producto: true,
  creadoPor: true,
  lote: { include: { proveedor: true } },
} as const;

// --- Entrada de cajas (lote) ---

const lineaFacturaCamaraSchema = z
  .object({
    productoId: z.number().int().positive(),
    familia: familiaCamaraEnum,
    procedencia: procedenciaCamaraEnum.optional(),
    cantidadCajas: z.number().int().positive("La cantidad de cajas debe ser mayor a 0"),
    pesoTotalKg: z.number().positive().optional(),
    pesoIndividualKg: z.number().positive().optional(),
    costoNetoKg: z.number().positive("El costo debe ser mayor a 0"),
  })
  .refine((data) => (data.pesoTotalKg == null) !== (data.pesoIndividualKg == null), {
    message: "Indica el peso total del lote o el peso individual por caja, pero no ambos",
    path: ["pesoTotalKg"],
  });

type LineaFacturaCamara = z.infer<typeof lineaFacturaCamaraSchema>;

// Lógica central de "entrar un lote a cámara" (crea el LoteCamara, sus N
// CajaCamara repartiendo el peso, y un MovimientoCamara de entrada por
// caja) — compartida entre la entrada de un solo producto (POST /cajas) y
// la entrada de una factura completa con varias líneas (POST
// /cajas/factura), para no duplicar esta parte en los dos lugares.
async function crearLoteYCajas(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  linea: LineaFacturaCamara,
  opciones: {
    usuarioId: number;
    dispositivo?: string;
    proveedorId?: number | null;
    numeroFactura?: string | null;
    fechaIngreso?: Date;
  }
) {
  const { productoId, familia, procedencia, cantidadCajas, pesoTotalKg, pesoIndividualKg, costoNetoKg } = linea;
  const { usuarioId, dispositivo, proveedorId, numeroFactura, fechaIngreso } = opciones;

  const pesoEstimado = pesoTotalKg != null;
  const pesoTotalReal = pesoTotalKg ?? pesoIndividualKg! * cantidadCajas;
  const pesosPorCaja = pesoEstimado
    ? repartirPesoKg(pesoTotalKg!, cantidadCajas)
    : Array.from({ length: cantidadCajas }, () => pesoIndividualKg!);

  const lote = await tx.loteCamara.create({
    data: {
      productoId,
      familiaNombre: familia,
      procedencia: procedencia ?? null,
      cantidadCajas,
      pesoTotalKg: pesoTotalReal,
      costoNetoKg,
      totalNeto: Math.round(pesoTotalReal * costoNetoKg),
      creadoPorId: usuarioId,
      proveedorId: proveedorId ?? null,
      numeroFactura: numeroFactura ?? null,
      ...(fechaIngreso ? { fechaIngreso } : {}),
    },
  });
  const creadas = [];
  for (const pesoKg of pesosPorCaja) {
    const caja = await tx.cajaCamara.create({
      data: {
        productoId,
        loteId: lote.id,
        familiaNombre: familia,
        procedencia: procedencia ?? null,
        pesoInicialKg: pesoKg,
        saldoKg: pesoKg,
        costoNetoKg,
        pesoEstimado,
        creadoPorId: usuarioId,
        ...(fechaIngreso ? { fechaIngreso } : {}),
      },
      include: cajaConIncludes,
    });
    await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: "entrada",
        pesoKg,
        destino: "camara",
        usuarioId,
        dispositivo: dispositivo || null,
        claveIdempotencia: randomUUID(),
      },
    });
    creadas.push(caja);
  }
  return creadas;
}

const entradaLoteSchema = lineaFacturaCamaraSchema.and(
  z.object({
    usuarioId: z.number().int().positive(),
    dispositivo: z.string().trim().optional(),
  })
);

camaraRouter.post("/cajas", async (req, res) => {
  const parsed = entradaLoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, familia, procedencia, usuarioId, dispositivo } = parsed.data;

  const errorProcedencia = validarProcedencia(familia, procedencia);
  if (errorProcedencia) return res.status(400).json({ error: errorProcedencia });

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  // No se puede usar la forma "array" de $transaction acá porque cada
  // movimiento necesita el id de SU PROPIA caja, recién asignado por la
  // base de datos al crearla — se necesita la forma "interactiva" para
  // poder encadenar pasos que dependen del resultado del paso anterior,
  // todo o nada igual que el resto del sistema.
  const cajas = await prisma.$transaction(async (tx) =>
    crearLoteYCajas(tx, parsed.data, { usuarioId, dispositivo })
  );

  res.status(201).json(cajas);
});

// Entrada de una factura completa de cámara, con varias líneas (productos)
// bajo un mismo proveedor y N° de factura — a pedido del usuario (su papá
// quería ingresar la factura directo, con proveedor/fecha/N° de factura una
// sola vez para todas las líneas, en vez de repetir "Entrada de cámara"
// producto por producto). Reemplaza el flujo de la pantalla "Entrada de
// cámara"; el endpoint de un solo producto (POST /cajas) se mantiene tal
// cual porque lo sigue usando el asistente de IA (proponer_entrada_camara).
const entradaFacturaCamaraSchema = z.object({
  proveedorId: z.number().int().positive(),
  numeroFactura: z.string().trim().min(1, "Falta el N° de factura"),
  fecha: z.string().trim().optional(),
  usuarioId: z.number().int().positive(),
  lineas: z.array(lineaFacturaCamaraSchema).min(1, "Agrega al menos una línea"),
  // El frontend manda esto en true recién en el reintento, después de que la
  // persona ya vio la alerta de posible factura duplicada y decidió seguir
  // igual (ver GET /cajas/factura/verificar-duplicado más abajo). El
  // servidor vuelve a revisar por su cuenta (no confía en que el frontend
  // ya haya avisado) — así una factura con el mismo proveedor + N° nunca
  // se carga dos veces sin que alguien lo confirme a propósito.
  confirmarDuplicado: z.boolean().optional(),
});

// Compara proveedor + N° de factura contra los lotes ya cargados —
// insensible a mayúsculas/espacios extra, para no dejar pasar un
// "F-1234" vs "f-1234 " como si fueran distintos.
async function buscarLotesDuplicados(proveedorId: number, numeroFactura: string) {
  const normalizado = numeroFactura.trim().toLowerCase();
  const lotes = await prisma.loteCamara.findMany({
    where: { proveedorId, numeroFactura: { not: null } },
    include: { producto: true },
    orderBy: { fechaIngreso: "desc" },
  });
  return lotes.filter((l) => l.numeroFactura!.trim().toLowerCase() === normalizado);
}

// Usado por el frontend para avisar ANTES de armar todas las líneas de la
// factura (ej. al escribir el N° de factura, o al apretar "Revisar antes de
// ingresar") — de solo lectura, no bloquea nada por sí solo.
camaraRouter.get("/cajas/factura/verificar-duplicado", async (req, res) => {
  const proveedorId = Number(req.query.proveedorId);
  const numeroFactura = typeof req.query.numeroFactura === "string" ? req.query.numeroFactura : "";
  if (!proveedorId || !numeroFactura.trim()) return res.json({ duplicado: false, lotes: [] });

  const lotes = await buscarLotesDuplicados(proveedorId, numeroFactura);
  res.json({
    duplicado: lotes.length > 0,
    lotes: lotes.map((l) => ({
      id: l.id,
      producto: l.producto.descripcion,
      cantidadCajas: l.cantidadCajas,
      pesoTotalKg: l.pesoTotalKg,
      fechaIngreso: l.fechaIngreso,
    })),
  });
});

camaraRouter.post("/cajas/factura", async (req, res) => {
  const parsed = entradaFacturaCamaraSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { proveedorId, numeroFactura, fecha, usuarioId, lineas, confirmarDuplicado } = parsed.data;

  for (const linea of lineas) {
    const errorProcedencia = validarProcedencia(linea.familia, linea.procedencia);
    if (errorProcedencia) return res.status(400).json({ error: errorProcedencia });
  }

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } });
  if (!proveedor) return res.status(400).json({ error: "El proveedor indicado no existe" });

  const productos = await prisma.producto.findMany({ where: { id: { in: lineas.map((l) => l.productoId) } } });
  if (productos.length !== new Set(lineas.map((l) => l.productoId)).size) {
    return res.status(404).json({ error: "Uno de los productos indicados no existe" });
  }

  if (!confirmarDuplicado) {
    const duplicados = await buscarLotesDuplicados(proveedorId, numeroFactura);
    if (duplicados.length > 0) {
      return res.status(409).json({
        error: "Ya existe una factura registrada con este proveedor y N° de factura.",
        duplicado: true,
        lotes: duplicados.map((l) => ({
          id: l.id,
          producto: l.producto.descripcion,
          cantidadCajas: l.cantidadCajas,
          pesoTotalKg: l.pesoTotalKg,
          fechaIngreso: l.fechaIngreso,
        })),
      });
    }
  }

  const fechaIngreso = parsearFechaSoloDia(fecha) ?? undefined;

  const cajasPorLinea = await prisma.$transaction(async (tx) => {
    const resultado = [];
    for (const linea of lineas) {
      const cajas = await crearLoteYCajas(tx, linea, { usuarioId, proveedorId, numeroFactura, fechaIngreso });
      resultado.push(cajas);
    }
    return resultado;
  });

  res.status(201).json({ cajas: cajasPorLinea.flat() });
});

camaraRouter.get("/cajas", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const hayRangoFechas = req.query.desde != null || req.query.hasta != null;
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
  const cajas = await prisma.cajaCamara.findMany({
    where: {
      ...(estado ? { estado } : {}),
      ...(hayRangoFechas ? { fechaIngreso: { gte: desde, lte: hasta } } : {}),
    },
    include: cajaConIncludes,
    orderBy: { fechaIngreso: "desc" },
  });
  res.json(cajas);
});

camaraRouter.get("/cajas/:id", async (req, res) => {
  const caja = await prisma.cajaCamara.findUnique({
    where: { id: Number(req.params.id) },
    include: cajaConIncludes,
  });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  res.json(caja);
});

// Anular una entrada equivocada (ej. una caja de prueba, o un lote
// duplicado) — a pedido del usuario, tras hacer pruebas y no tener forma
// de corregirlas sin arriesgar quedar con stock duplicado. Solo se permite
// mientras la caja siga exactamente como se creó: sin ninguna salida
// (ni completa ni parcial) registrada todavía — mismo principio que
// "Anular una venta ya confirmada" en Caja, evitando el caso más
// complicado de tener que deshacer movimientos que ya dependen de ella
// (ej. stock que ya subió a sala de venta).
const anularEntradaSchema = z.object({
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().min(1, "Indica el motivo de la anulación"),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

camaraRouter.post("/cajas/:id/anular-entrada", async (req, res) => {
  const parsed = anularEntradaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const errorClave = await verificarClaveSupervisor(req, clave);
  if (errorClave) return res.status(errorClave.status).json({ error: errorClave.error });

  const caja = await prisma.cajaCamara.findUnique({ where: { id: Number(req.params.id) } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  if (caja.estado !== "en_camara" || Math.abs(caja.saldoKg - caja.pesoInicialKg) > EPSILON_KG) {
    return res.status(400).json({
      error:
        "Esta caja ya no se puede anular porque tuvo alguna salida registrada — corrígela con un ajuste manual en vez de anular la entrada",
    });
  }
  const movimientosPrevios = await prisma.movimientoCamara.count({ where: { cajaId: caja.id } });
  if (movimientosPrevios > 1) {
    return res.status(400).json({
      error: "Esta caja ya tiene movimientos además de la entrada — no se puede anular la entrada directamente",
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const cajaActualizada = await tx.cajaCamara.update({
      where: { id: caja.id },
      data: { saldoKg: 0, estado: "anulada", version: { increment: 1 } },
      include: cajaConIncludes,
    });
    const movimiento = await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: "anulacion",
        pesoKg: caja.pesoInicialKg,
        origen: "camara",
        destino: "anulada",
        motivo,
        usuarioId,
        claveIdempotencia: randomUUID(),
      },
    });
    return { caja: cajaActualizada, movimiento };
  });

  res.json(resultado);
});

// --- Salida de cajas (completa o parcial), con aviso FIFO ---

const ESTADOS_ACTIVOS = ["en_camara", "parcial"] as const;
// Media unidad de gramo, para no rechazar por ruido de punto flotante al
// comparar el peso que sale contra el saldo (ambos con precisión de gramo).
const EPSILON_KG = 0.0005;

// --- Lotes de cámara (agrupan las cajas que entraron juntas) ---

function numerosCajasResumen(cajas: { id: number }[]): string {
  if (cajas.length === 0) return "sin cajas";
  const ordenadas = [...cajas].sort((a, b) => a.id - b.id);
  if (ordenadas.length <= 5) return ordenadas.map((c) => String(c.id).padStart(6, "0")).join(", ");
  return `${String(ordenadas[0].id).padStart(6, "0")} a ${String(ordenadas[ordenadas.length - 1].id).padStart(6, "0")}`;
}

// Un lote se puede corregir, reimprimir o anular como grupo solo mientras
// TODAS sus cajas sigan exactamente como se crearon — sin ninguna salida
// registrada todavía — mismo principio que anular una caja individual
// (ver /cajas/:id/anular-entrada más arriba). Una corrección no cambia esta
// elegibilidad (deja la caja en el mismo estado "recién creada"), así que
// se puede corregir un lote más de una vez mientras nadie le haya sacado
// nada todavía.
function loteElegibleParaEditar(cajas: { estado: string; saldoKg: number; pesoInicialKg: number }[]): boolean {
  return cajas.every((c) => c.estado === "en_camara" && Math.abs(c.saldoKg - c.pesoInicialKg) <= EPSILON_KG);
}

camaraRouter.get("/lotes", async (req, res) => {
  const hayRangoFechas = req.query.desde != null || req.query.hasta != null;
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
  const lotes = await prisma.loteCamara.findMany({
    where: hayRangoFechas ? { fechaIngreso: { gte: desde, lte: hasta } } : {},
    include: { producto: true, creadoPor: true, cajas: true, proveedor: true },
    orderBy: { fechaIngreso: "desc" },
  });
  res.json(
    lotes.map((l) => ({
      ...l,
      numerosCajas: numerosCajasResumen(l.cajas),
      bloqueado: !loteElegibleParaEditar(l.cajas),
    }))
  );
});

camaraRouter.get("/lotes/:id", async (req, res) => {
  const lote = await prisma.loteCamara.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      producto: true,
      creadoPor: true,
      proveedor: true,
      cajas: { orderBy: { id: "asc" }, include: { producto: true } },
      correcciones: { include: { usuario: true }, orderBy: { creadoEn: "desc" } },
    },
  });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  res.json({ ...lote, numerosCajas: numerosCajasResumen(lote.cajas), bloqueado: !loteElegibleParaEditar(lote.cajas) });
});

const corregirLoteSchema = z.object({
  productoId: z.number().int().positive(),
  familia: familiaCamaraEnum,
  procedencia: procedenciaCamaraEnum.optional(),
  pesoTotalKg: z.number().positive("El peso total debe ser mayor a 0"),
  costoNetoKg: z.number().positive("El costo debe ser mayor a 0"),
  usuarioId: z.number().int().positive(),
});

// Corrige familia/producto/peso total/costo de TODO el lote a la vez,
// repartiendo el peso corregido entre sus cajas (mismo reparto exacto que
// al crearlas) — bloqueado si cualquier caja del lote ya tuvo una salida.
// Queda auditado en CorreccionLoteCamara (qué cambió, quién y cuándo) y
// además cada caja recibe un MovimientoCamara "correccion_entrada" con su
// peso nuevo, sin sobrescribir el movimiento de entrada original.
camaraRouter.put("/lotes/:id", async (req, res) => {
  const parsed = corregirLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { productoId, familia, procedencia, pesoTotalKg, costoNetoKg, usuarioId } = parsed.data;

  const errorProcedencia = validarProcedencia(familia, procedencia);
  if (errorProcedencia) return res.status(400).json({ error: errorProcedencia });

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const loteId = Number(req.params.id);
  const lote = await prisma.loteCamara.findUnique({
    where: { id: loteId },
    include: { cajas: { orderBy: { id: "asc" } }, producto: true },
  });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (!loteElegibleParaEditar(lote.cajas)) {
    return res.status(400).json({
      error: "Este lote ya tiene alguna salida registrada — no se puede corregir. Corrígelo con un ajuste manual en vez de editar la entrada.",
    });
  }

  const productoNuevo = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!productoNuevo) return res.status(404).json({ error: "Producto no encontrado" });

  const pesosPorCaja = repartirPesoKg(pesoTotalKg, lote.cajas.length);
  const totalNeto = Math.round(pesoTotalKg * costoNetoKg);

  const resultado = await prisma.$transaction(async (tx) => {
    await tx.correccionLoteCamara.create({
      data: {
        loteId,
        familiaAnterior: lote.familiaNombre,
        procedenciaAnterior: lote.procedencia,
        productoAnterior: lote.producto.descripcion,
        pesoTotalAnteriorKg: lote.pesoTotalKg,
        costoAnteriorKg: lote.costoNetoKg,
        familiaNueva: familia,
        procedenciaNueva: procedencia ?? null,
        productoNuevo: productoNuevo.descripcion,
        pesoTotalNuevoKg: pesoTotalKg,
        costoNuevoKg: costoNetoKg,
        usuarioId,
      },
    });
    const loteActualizado = await tx.loteCamara.update({
      where: { id: loteId },
      data: { productoId, familiaNombre: familia, procedencia: procedencia ?? null, pesoTotalKg, costoNetoKg, totalNeto },
      include: { producto: true, creadoPor: true },
    });
    const cajas = [];
    for (let i = 0; i < lote.cajas.length; i++) {
      const caja = lote.cajas[i];
      const pesoNuevo = pesosPorCaja[i];
      const cajaActualizada = await tx.cajaCamara.update({
        where: { id: caja.id },
        data: {
          productoId,
          familiaNombre: familia,
          procedencia: procedencia ?? null,
          pesoInicialKg: pesoNuevo,
          saldoKg: pesoNuevo,
          costoNetoKg,
          pesoEstimado: lote.cajas.length > 1,
          version: { increment: 1 },
        },
        include: cajaConIncludes,
      });
      await tx.movimientoCamara.create({
        data: {
          cajaId: caja.id,
          tipo: "correccion_entrada",
          pesoKg: pesoNuevo,
          origen: "camara",
          destino: "camara",
          motivo: "Corrección del lote",
          usuarioId,
          claveIdempotencia: randomUUID(),
        },
      });
      cajas.push(cajaActualizada);
    }
    return { lote: loteActualizado, cajas };
  });

  res.json(resultado);
});

const anularLoteSchema = z.object({
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().min(1, "Indica el motivo de la anulación"),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

// Igual que /cajas/:id/anular-entrada, pero aplicado a todas las cajas del
// lote de una vez — bloqueado si cualquiera ya tuvo una salida.
camaraRouter.post("/lotes/:id/anular", async (req, res) => {
  const parsed = anularLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const errorClave = await verificarClaveSupervisor(req, clave);
  if (errorClave) return res.status(errorClave.status).json({ error: errorClave.error });

  const loteId = Number(req.params.id);
  const lote = await prisma.loteCamara.findUnique({ where: { id: loteId }, include: { cajas: true } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (!loteElegibleParaEditar(lote.cajas)) {
    return res.status(400).json({
      error: "Este lote ya tiene alguna salida registrada — no se puede anular como grupo. Corrige cada caja por separado con un ajuste manual.",
    });
  }

  const cajas = await prisma.$transaction(async (tx) => {
    const actualizadas = [];
    for (const caja of lote.cajas) {
      const cajaActualizada = await tx.cajaCamara.update({
        where: { id: caja.id },
        data: { saldoKg: 0, estado: "anulada", version: { increment: 1 } },
        include: cajaConIncludes,
      });
      await tx.movimientoCamara.create({
        data: {
          cajaId: caja.id,
          tipo: "anulacion",
          pesoKg: caja.pesoInicialKg,
          origen: "camara",
          destino: "anulada",
          motivo,
          usuarioId,
          claveIdempotencia: randomUUID(),
        },
      });
      actualizadas.push(cajaActualizada);
    }
    return actualizadas;
  });

  res.json({ cajas });
});

// --- Existencias (stock actual por familia/producto) y reporte de salidas ---

// Umbral fijo (no configurable por producto, a pedido del usuario — más
// simple que el umbral de stock bajo del inventario general, que sí es
// configurable por producto).
const UMBRAL_STOCK_BAJO_CAJAS = 2;
// Una caja que nunca tuvo ninguna salida (ni parcial) y lleva más de este
// tiempo en cámara se marca como "estancada" — para no dejarla olvidada.
const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

camaraRouter.get("/existencias", async (_req, res) => {
  const cajas = await prisma.cajaCamara.findMany({
    where: { estado: { in: [...ESTADOS_ACTIVOS] } },
    include: { producto: true },
  });
  const totalCajas = cajas.length;
  const totalKilos = cajas.reduce((s, c) => s + c.saldoKg, 0);
  const totalValor = cajas.reduce((s, c) => s + c.saldoKg * c.costoNetoKg, 0);

  const grupos = new Map<string, { familia: string; producto: string; productoId: number; cajas: number }>();
  for (const c of cajas) {
    const clave = `${c.familiaNombre}|${c.productoId}`;
    const actual = grupos.get(clave) ?? { familia: c.familiaNombre, producto: c.producto.descripcion, productoId: c.productoId, cajas: 0 };
    actual.cajas++;
    grupos.set(clave, actual);
  }

  // Últimos 2 costos por kilo (de los lotes más recientes) por producto —
  // para poder comparar rápido si el precio subió o bajó en la última
  // compra, sin entrar al detalle de cada lote.
  const productoIds = [...new Set([...grupos.values()].map((g) => g.productoId))];
  const ultimosCostosPorProducto = new Map<number, number[]>();
  if (productoIds.length) {
    const lotesRecientes = await prisma.loteCamara.findMany({
      where: { productoId: { in: productoIds } },
      orderBy: { fechaIngreso: "desc" },
      select: { productoId: true, costoNetoKg: true },
    });
    for (const l of lotesRecientes) {
      const actual = ultimosCostosPorProducto.get(l.productoId) ?? [];
      if (actual.length < 2) {
        actual.push(l.costoNetoKg);
        ultimosCostosPorProducto.set(l.productoId, actual);
      }
    }
  }

  const porProducto = Array.from(grupos.values())
    .map((g) => ({
      ...g,
      ultimosCostos: ultimosCostosPorProducto.get(g.productoId) ?? [],
      bajoStock: g.cajas < UMBRAL_STOCK_BAJO_CAJAS,
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia, "es") || a.producto.localeCompare(b.producto, "es"));

  const limiteEstancada = new Date(Date.now() - UNA_SEMANA_MS);
  const cajasEstancadas = cajas
    .filter(
      (c) =>
        c.estado === "en_camara" &&
        Math.abs(c.saldoKg - c.pesoInicialKg) <= EPSILON_KG &&
        c.fechaIngreso <= limiteEstancada
    )
    .map((c) => ({
      cajaId: c.id,
      numero: String(c.id).padStart(6, "0"),
      producto: c.producto.descripcion,
      familia: c.familiaNombre,
      fechaIngreso: c.fechaIngreso,
      diasEnCamara: Math.floor((Date.now() - c.fechaIngreso.getTime()) / (24 * 60 * 60 * 1000)),
    }))
    .sort((a, b) => b.diasEnCamara - a.diasEnCamara);

  res.json({ totalCajas, totalKilos, totalValor, porProducto, cajasEstancadas });
});

// Destinos fijos de salida — "otro" se agregó a pedido del usuario (además
// de los que ya existían) para no dejar sin registrar una salida que no
// calza con ninguno de los otros.
const DESTINOS_CAMARA_REPORTE = ["sala_venta", "produccion", "merma", "donacion", "mayorista", "otro"] as const;
const ETIQUETA_DESTINO: Record<string, string> = {
  sala_venta: "Sala de venta",
  produccion: "Producción o elaboración",
  merma: "Merma",
  donacion: "Donación",
  mayorista: "Venta mayorista",
  otro: "Otro",
};

camaraRouter.get("/reporte-salidas", async (req, res) => {
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
  const movimientos = await prisma.movimientoCamara.findMany({
    where: { destino: { in: [...DESTINOS_CAMARA_REPORTE] }, creadoEn: { gte: desde, lte: hasta } },
    include: { caja: { include: { producto: true } } },
    orderBy: { creadoEn: "desc" },
  });

  const totalKilos = movimientos.reduce((s, m) => s + m.pesoKg, 0);
  const cajasDistintas = new Set(movimientos.map((m) => m.cajaId)).size;
  const totalValor = movimientos.reduce((s, m) => s + m.pesoKg * m.caja.costoNetoKg, 0);

  const porDestino = DESTINOS_CAMARA_REPORTE.map((destino) => {
    const delDestino = movimientos.filter((m) => m.destino === destino);
    return {
      destino,
      etiqueta: ETIQUETA_DESTINO[destino],
      cajasDistintas: new Set(delDestino.map((m) => m.cajaId)).size,
      kilos: delDestino.reduce((s, m) => s + m.pesoKg, 0),
      valor: delDestino.reduce((s, m) => s + m.pesoKg * m.caja.costoNetoKg, 0),
    };
  });

  const ultimosMovimientos = movimientos.slice(0, 50).map((m) => ({
    id: m.id,
    fecha: m.creadoEn,
    numero: String(m.cajaId).padStart(6, "0"),
    producto: m.caja.producto.descripcion,
    destino: m.destino,
    etiquetaDestino: ETIQUETA_DESTINO[m.destino ?? ""] ?? m.destino ?? "—",
    kilos: m.pesoKg,
  }));

  res.json({ desde, hasta, totalKilos, cajasDistintas, totalValor, porDestino, ultimosMovimientos });
});

// La caja más antigua (misma familia de producto) que todavía tiene saldo
// en cámara — para avisar (sin bloquear) si se está por sacar una caja más
// nueva mientras hay una más vieja disponible.
camaraRouter.get("/cajas/:id/fifo", async (req, res) => {
  const caja = await prisma.cajaCamara.findUnique({ where: { id: Number(req.params.id) } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });

  const masAntigua = await prisma.cajaCamara.findFirst({
    where: { productoId: caja.productoId, estado: { in: [...ESTADOS_ACTIVOS] } },
    orderBy: { fechaIngreso: "asc" },
  });

  const hayMasAntigua = masAntigua != null && masAntigua.id !== caja.id;
  res.json({
    hayMasAntigua,
    cajaMasAntigua: hayMasAntigua
      ? { id: masAntigua!.id, numero: String(masAntigua!.id).padStart(6, "0"), fechaIngreso: masAntigua!.fechaIngreso }
      : null,
  });
});

const salidaSchema = z
  .object({
    destino: z.enum(["sala_venta", "produccion", "merma", "donacion", "mayorista", "otro"]),
    pesoKg: z.number().positive().optional(),
    motivo: z.string().trim().optional(),
    usuarioId: z.number().int().positive(),
    dispositivo: z.string().trim().optional(),
    // La caja se lee antes de mostrar el formulario de salida — se manda de
    // vuelta la versión leída para detectar si otra persona la modificó
    // mientras tanto (dos operadores no pueden descontar la misma caja al
    // mismo tiempo sin darse cuenta).
    version: z.number().int().positive(),
    mayorista: z
      .object({
        clienteNombre: z.string().trim().optional(),
        precioTotal: z.number().positive("El precio de la venta por mayor debe ser mayor a 0"),
        estadoPago: z.enum(["pagado", "pendiente"]).default("pendiente"),
      })
      .optional(),
    // Generada por el que hace la salida (ej. el celular en la Etapa 6, modo
    // sin conexión) ANTES de mandar la petición — si esta misma petición ya
    // se procesó antes (reintento tras recuperar señal), se devuelve el
    // resultado ya guardado en vez de repetir el descuento de saldo.
    claveIdempotencia: z.string().trim().min(1).optional(),
  })
  .refine((data) => data.destino !== "mayorista" || data.mayorista != null, {
    message: "Faltan los datos de la venta por mayor (precio)",
    path: ["mayorista"],
  });

async function resultadoSalidaPorClave(claveIdempotencia: string) {
  const movimiento = await prisma.movimientoCamara.findUnique({ where: { claveIdempotencia } });
  if (!movimiento) return null;
  const caja = await prisma.cajaCamara.findUnique({ where: { id: movimiento.cajaId }, include: cajaConIncludes });
  let salidaMayorista = null;
  if (movimiento.referenciaTipo === "SalidaMayorista" && movimiento.referenciaId) {
    salidaMayorista = await prisma.salidaMayorista.findUnique({
      where: { id: movimiento.referenciaId },
      include: { producto: true, usuario: true, usuarioAnulacion: true },
    });
  }
  return { caja, movimiento, salidaMayorista };
}

// Tipo de MovimientoCamara según el destino elegido. Sala de venta y
// mayorista distinguen si la caja quedó vacía o con saldo; producción,
// merma y donación usan un tipo propio sin distinguir eso (una caja se
// puede consumir/mermar/donar de a poco igual).
function tipoMovimiento(destino: string, esCompleta: boolean): string {
  if (destino === "sala_venta" || destino === "mayorista") {
    return esCompleta ? "salida_completa" : "salida_parcial";
  }
  if (destino === "produccion") return "consumo_produccion";
  return destino; // "merma" | "donacion"
}

camaraRouter.post("/cajas/:id/salida", async (req, res) => {
  const parsed = salidaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { destino, pesoKg: pesoSolicitado, motivo, usuarioId, dispositivo, version, mayorista, claveIdempotencia } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  // Reintento de una salida que ya se procesó (ej. el celular recuperó
  // señal y reenvía sola una acción que había quedado en su cola local) —
  // se devuelve el resultado ya guardado, sin validar nada de nuevo (la
  // versión de la caja ya cambió desde el primer envío, así que validarla
  // otra vez rechazaría un reintento legítimo).
  if (claveIdempotencia) {
    const yaProcesada = await resultadoSalidaPorClave(claveIdempotencia);
    if (yaProcesada) return res.json(yaProcesada);
  }

  const cajaId = Number(req.params.id);
  const caja = await prisma.cajaCamara.findUnique({ where: { id: cajaId } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  if (caja.estado === "salida") {
    return res.status(400).json({ error: "Esta caja ya salió completa de cámara" });
  }
  if (caja.estado === "anulada") {
    return res.status(400).json({ error: "Esta caja fue anulada — no corresponde sacarle nada" });
  }
  if (caja.version !== version) {
    return res.status(409).json({
      error: "Esta caja fue modificada por otra persona mientras tanto — vuelve a escanearla e intenta de nuevo",
    });
  }

  const pesoKg = pesoSolicitado ?? caja.saldoKg;
  if (pesoKg > caja.saldoKg + EPSILON_KG) {
    return res.status(400).json({ error: `No puede sacar más peso del que queda en la caja (quedan ${caja.saldoKg} kg)` });
  }

  const esCompleta = pesoKg >= caja.saldoKg - EPSILON_KG;
  const nuevoSaldo = esCompleta ? 0 : Math.round((caja.saldoKg - pesoKg) * 1000) / 1000;
  const nuevoEstado = esCompleta ? "salida" : "parcial";

  // Se necesita la forma "interactiva" de $transaction (no la de array)
  // porque, cuando el destino es mayorista, el movimiento de cámara
  // necesita el id de la SalidaMayorista recién creada en el mismo paso.
  const resultado = await prisma.$transaction(async (tx) => {
    const cajaActualizada = await tx.cajaCamara.update({
      where: { id: cajaId },
      data: { saldoKg: nuevoSaldo, estado: nuevoEstado, version: { increment: 1 } },
      include: cajaConIncludes,
    });

    let salidaMayorista = null;
    let referenciaTipo: string | null = null;
    let referenciaId: number | null = null;
    if (destino === "mayorista" && mayorista) {
      salidaMayorista = await tx.salidaMayorista.create({
        data: {
          productoId: caja.productoId,
          cantidadKg: pesoKg,
          precioTotal: mayorista.precioTotal,
          estadoPago: mayorista.estadoPago,
          clienteNombre: mayorista.clienteNombre || null,
          cajaCamaraId: caja.id,
          usuarioId,
          observaciones: motivo || null,
        },
        include: { producto: true, usuario: true, usuarioAnulacion: true },
      });
      referenciaTipo = "SalidaMayorista";
      referenciaId = salidaMayorista.id;
    }

    const movimiento = await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: tipoMovimiento(destino, esCompleta),
        pesoKg,
        origen: "camara",
        destino,
        motivo: motivo || null,
        referenciaTipo,
        referenciaId,
        usuarioId,
        dispositivo: dispositivo || null,
        claveIdempotencia: claveIdempotencia || randomUUID(),
      },
    });

    // Solo "sala de venta" hace que el producto quede disponible para
    // vender en Caja — el resto (producción, merma, donación, mayorista)
    // son salidas de cámara que no suman al stock vendible general.
    if (destino === "sala_venta") {
      await tx.producto.update({ where: { id: caja.productoId }, data: { stockActual: { increment: pesoKg } } });
      await tx.movimientoInventario.create({
        data: {
          productoId: caja.productoId,
          usuarioId,
          tipo: "entrada",
          motivo: "entrada_camara",
          cantidad: pesoKg,
        },
      });
    }

    return { caja: cajaActualizada, movimiento, salidaMayorista };
  });

  res.json(resultado);
});

// --- Ventas por mayor ---

camaraRouter.get("/mayoristas", async (req, res) => {
  const { desde, hasta } = rangoFechasDesdeTexto(req.query.desde, req.query.hasta);
  const estadoPago = typeof req.query.estadoPago === "string" ? req.query.estadoPago : undefined;

  const salidas = await prisma.salidaMayorista.findMany({
    where: {
      fecha: { gte: desde, lte: hasta },
      ...(estadoPago ? { estadoPago } : {}),
    },
    include: { producto: true, usuario: true, usuarioAnulacion: true },
    orderBy: { fecha: "desc" },
  });
  res.json(salidas);
});

const estadoPagoSchema = z.object({
  estadoPago: z.enum(["pagado", "pendiente"]),
  usuarioId: z.number().int().positive(),
});

camaraRouter.put("/mayoristas/:id/estado-pago", async (req, res) => {
  const parsed = estadoPagoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const usuario = await validarUsuario(parsed.data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const salida = await prisma.salidaMayorista.findUnique({ where: { id: Number(req.params.id) } });
  if (!salida) return res.status(404).json({ error: "Venta por mayor no encontrada" });
  if (salida.anulada) return res.status(400).json({ error: "Esta venta está anulada" });

  const actualizada = await prisma.salidaMayorista.update({
    where: { id: salida.id },
    data: { estadoPago: parsed.data.estadoPago },
    include: { producto: true, usuario: true, usuarioAnulacion: true },
  });
  res.json(actualizada);
});

// Editar una venta al por mayor ya registrada — a pedido del usuario, para
// corregir un dato mal ingresado (ej. el nombre del cliente, o el precio
// que finalmente se acordó) sin tener que anular y rehacer todo. Solo los
// campos que NO afectan el stock de cámara (cliente, precio, notas) — el
// peso (`cantidadKg`) no es editable acá porque ya movió el saldo de una
// caja real; si el peso estuvo mal, la corrección es anular esta venta
// (devuelve el peso a la caja) y volver a registrar la salida correcta.
const editarMayoristaSchema = z.object({
  usuarioId: z.number().int().positive(),
  clienteNombre: z.string().trim().optional().nullable(),
  precioTotal: z.number().positive("El precio total debe ser mayor a 0"),
  observaciones: z.string().trim().optional().nullable(),
});

camaraRouter.put("/mayoristas/:id", async (req, res) => {
  const parsed = editarMayoristaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, clienteNombre, precioTotal, observaciones } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const salida = await prisma.salidaMayorista.findUnique({ where: { id: Number(req.params.id) } });
  if (!salida) return res.status(404).json({ error: "Venta por mayor no encontrada" });
  if (salida.anulada) return res.status(400).json({ error: "Esta venta está anulada — no se puede editar" });

  const actualizada = await prisma.salidaMayorista.update({
    where: { id: salida.id },
    data: { clienteNombre: clienteNombre || null, precioTotal, observaciones: observaciones || null },
    include: { producto: true, usuario: true, usuarioAnulacion: true },
  });
  res.json(actualizada);
});

// Anular una venta al por mayor — a pedido del usuario ("sobre todo si aún
// están marcadas como pendientes"), para corregir una venta mal ingresada
// por completo. Mismo principio que "Anular una entrada" de cámara: solo
// se permite mientras la caja de origen no haya tenido NINGÚN movimiento
// después de esta venta (si ya se le sacó algo más, deshacer el saldo acá
// dejaría el número mal) — devuelve el peso a la caja y la deja como
// estaba antes de esta venta.
const anularMayoristaSchema = z.object({
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().min(1, "Indica el motivo de la anulación"),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
});

camaraRouter.post("/mayoristas/:id/anular", async (req, res) => {
  const parsed = anularMayoristaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo, clave } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const errorClave = await verificarClaveSupervisor(req, clave);
  if (errorClave) return res.status(errorClave.status).json({ error: errorClave.error });

  const salida = await prisma.salidaMayorista.findUnique({ where: { id: Number(req.params.id) } });
  if (!salida) return res.status(404).json({ error: "Venta por mayor no encontrada" });
  if (salida.anulada) return res.status(400).json({ error: "Esta venta ya está anulada" });

  const movimiento = await prisma.movimientoCamara.findFirst({
    where: { referenciaTipo: "SalidaMayorista", referenciaId: salida.id },
  });
  if (!salida.cajaCamaraId || !movimiento) {
    return res.status(400).json({
      error: "Esta venta no tiene una caja de cámara asociada (dato antiguo) — no se puede anular automáticamente",
    });
  }

  const caja = await prisma.cajaCamara.findUnique({ where: { id: salida.cajaCamaraId } });
  if (!caja) return res.status(404).json({ error: "La caja de origen ya no existe" });

  const movimientoMasReciente = await prisma.movimientoCamara.findFirst({
    where: { cajaId: caja.id },
    orderBy: { id: "desc" },
  });
  if (movimientoMasReciente?.id !== movimiento.id) {
    return res.status(400).json({
      error: "La caja de origen tuvo movimientos después de esta venta — no se puede anular directamente, corrígelo con un ajuste manual",
    });
  }

  const nuevoSaldo = Math.min(caja.pesoInicialKg, Math.round((caja.saldoKg + salida.cantidadKg) * 1000) / 1000);
  const nuevoEstado = nuevoSaldo >= caja.pesoInicialKg - EPSILON_KG ? "en_camara" : "parcial";

  const resultado = await prisma.$transaction(async (tx) => {
    const cajaActualizada = await tx.cajaCamara.update({
      where: { id: caja.id },
      data: { saldoKg: nuevoSaldo, estado: nuevoEstado, version: { increment: 1 } },
      include: cajaConIncludes,
    });
    const salidaAnulada = await tx.salidaMayorista.update({
      where: { id: salida.id },
      data: {
        anulada: true,
        usuarioAnulacionId: usuarioId,
        motivoAnulacion: motivo,
        fechaAnulacion: new Date(),
      },
      include: { producto: true, usuario: true, usuarioAnulacion: true },
    });
    const movimientoReversion = await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: "anulacion_mayorista",
        pesoKg: salida.cantidadKg,
        origen: "camara",
        destino: "en_camara",
        motivo,
        referenciaTipo: "SalidaMayorista",
        referenciaId: salida.id,
        usuarioId,
        claveIdempotencia: randomUUID(),
      },
    });
    return { caja: cajaActualizada, salida: salidaAnulada, movimiento: movimientoReversion };
  });

  res.json(resultado);
});

// --- Inventario por escaneo + conciliación de faltantes ---

function esEstadoActivoCamara(estado: string): boolean {
  return estado === "en_camara" || estado === "parcial";
}

const sesionConIncludes = {
  iniciadoPor: true,
  finalizadoPor: true,
} as const;

camaraRouter.post("/inventario/sesiones", async (req, res) => {
  const usuarioId = Number(req.body?.usuarioId);
  if (!usuarioId) return res.status(400).json({ error: "Falta el usuario" });
  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesionAbierta = await prisma.sesionInventarioCamara.findFirst({ where: { estado: "abierta" } });
  if (sesionAbierta) {
    return res
      .status(400)
      .json({ error: `Ya hay un conteo abierto (sesión #${sesionAbierta.id}) — ciérralo antes de iniciar otro` });
  }

  // Foto de qué cajas deberían estar en cámara AHORA — se compara contra lo
  // que se vaya escaneando durante la sesión, sin importar si entran o
  // salen cajas nuevas mientras tanto (esas no cuentan ni a favor ni en
  // contra del conteo).
  const cajasActivas = await prisma.cajaCamara.findMany({ where: { estado: { in: ["en_camara", "parcial"] } } });

  const sesion = await prisma.$transaction(async (tx) => {
    const creada = await tx.sesionInventarioCamara.create({
      data: { iniciadoPorId: usuarioId, estado: "abierta" },
    });
    if (cajasActivas.length > 0) {
      await tx.inventarioCamaraEsperado.createMany({
        data: cajasActivas.map((c) => ({
          sesionId: creada.id,
          cajaId: c.id,
          saldoEsperadoKg: c.saldoKg,
          estadoEsperado: c.estado,
        })),
      });
    }
    return creada;
  });

  res.status(201).json({ ...sesion, totalEsperadas: cajasActivas.length });
});

camaraRouter.get("/inventario/sesiones", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const sesiones = await prisma.sesionInventarioCamara.findMany({
    where: estado ? { estado } : undefined,
    include: sesionConIncludes,
    orderBy: { fechaInicio: "desc" },
  });
  res.json(sesiones);
});

camaraRouter.get("/inventario/sesiones/:id", async (req, res) => {
  const sesionId = Number(req.params.id);
  const sesion = await prisma.sesionInventarioCamara.findUnique({
    where: { id: sesionId },
    include: sesionConIncludes,
  });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });

  const [esperados, escaneos] = await Promise.all([
    prisma.inventarioCamaraEsperado.findMany({
      where: { sesionId },
      include: { caja: { include: cajaConIncludes } },
    }),
    prisma.escaneoInventarioCamara.findMany({
      where: { sesionId },
      include: { caja: { include: cajaConIncludes }, escaneadoPor: true },
      orderBy: { escaneadoEn: "desc" },
    }),
  ]);

  res.json({ sesion, esperados, escaneos });
});

const escanearInventarioSchema = z.object({
  codigo: z.string().trim().min(1, "Falta el código escaneado"),
  usuarioId: z.number().int().positive(),
  dispositivo: z.string().trim().optional(),
});

camaraRouter.post("/inventario/sesiones/:id/escanear", async (req, res) => {
  const parsed = escanearInventarioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { codigo, usuarioId, dispositivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesionId = Number(req.params.id);
  const sesion = await prisma.sesionInventarioCamara.findUnique({ where: { id: sesionId } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (sesion.estado !== "abierta") {
    return res.status(400).json({ error: "Esta sesión de conteo ya está cerrada" });
  }

  const cajaId = Number(codigo);
  if (!cajaId || !Number.isInteger(cajaId)) {
    return res.status(400).json({ error: `Código no reconocido: "${codigo}"` });
  }
  const caja = await prisma.cajaCamara.findUnique({ where: { id: cajaId }, include: cajaConIncludes });
  if (!caja) return res.status(404).json({ error: `No existe ninguna caja con el número ${codigo}` });

  // Un doble escaneo de la misma caja no duplica el conteo — se avisa y se
  // devuelve el escaneo ya existente en vez de fallar.
  const yaEscaneada = await prisma.escaneoInventarioCamara.findUnique({
    where: { sesionId_cajaId: { sesionId, cajaId } },
  });
  if (yaEscaneada) {
    const esperado = await prisma.inventarioCamaraEsperado.findUnique({
      where: { sesionId_cajaId: { sesionId, cajaId } },
    });
    return res.json({ escaneo: yaEscaneada, caja, esperada: esperado != null, yaEscaneada: true });
  }

  const esperado = await prisma.inventarioCamaraEsperado.findUnique({
    where: { sesionId_cajaId: { sesionId, cajaId } },
  });

  const escaneo = await prisma.escaneoInventarioCamara.create({
    data: {
      sesionId,
      cajaId,
      escaneadoPorId: usuarioId,
      dispositivo: dispositivo || null,
      estadoAlEscanear: caja.estado,
      saldoAlEscanearKg: caja.saldoKg,
    },
  });

  res.status(201).json({ escaneo, caja, esperada: esperado != null, yaEscaneada: false });
});

const cerrarSesionSchema = z.object({
  usuarioId: z.number().int().positive(),
  observaciones: z.string().trim().optional(),
});

camaraRouter.post("/inventario/sesiones/:id/cerrar", async (req, res) => {
  const parsed = cerrarSesionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, observaciones } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const sesionId = Number(req.params.id);
  const sesion = await prisma.sesionInventarioCamara.findUnique({ where: { id: sesionId } });
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (sesion.estado !== "abierta") {
    return res.status(400).json({ error: "Esta sesión de conteo ya está cerrada" });
  }

  const [esperados, escaneos] = await Promise.all([
    prisma.inventarioCamaraEsperado.findMany({ where: { sesionId } }),
    prisma.escaneoInventarioCamara.findMany({ where: { sesionId } }),
  ]);
  const cajaIdsEscaneadas = new Set(escaneos.map((e) => e.cajaId));
  const cajaIdsEsperadas = new Set(esperados.map((e) => e.cajaId));

  const candidatasFaltante = esperados.filter((e) => !cajaIdsEscaneadas.has(e.cajaId));
  const idsNoEsperadas = escaneos.filter((e) => !cajaIdsEsperadas.has(e.cajaId)).map((e) => e.cajaId);

  // Solo se marca "ajuste_pendiente" si la caja SIGUE activa en cámara — si
  // mientras tanto salió por el flujo normal (Etapa 3), no faltó nada,
  // simplemente ya no correspondía contarla en este conteo.
  const cajasFaltantes = await prisma.$transaction(async (tx) => {
    const marcadas = [];
    for (const candidata of candidatasFaltante) {
      const cajaActual = await tx.cajaCamara.findUnique({ where: { id: candidata.cajaId } });
      if (cajaActual && esEstadoActivoCamara(cajaActual.estado)) {
        const actualizada = await tx.cajaCamara.update({
          where: { id: cajaActual.id },
          data: { estado: "ajuste_pendiente", version: { increment: 1 } },
          include: cajaConIncludes,
        });
        marcadas.push(actualizada);
      }
    }
    await tx.sesionInventarioCamara.update({
      where: { id: sesionId },
      data: {
        estado: "finalizada",
        fechaFin: new Date(),
        finalizadoPorId: usuarioId,
        observaciones: observaciones || null,
      },
    });
    return marcadas;
  });

  const cajasNoEsperadas = idsNoEsperadas.length
    ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNoEsperadas } }, include: cajaConIncludes })
    : [];

  res.json({
    totalEsperadas: esperados.length,
    totalEscaneadas: escaneos.length,
    faltantes: cajasFaltantes,
    noEsperadas: cajasNoEsperadas,
  });
});

// --- Resolver cajas marcadas "ajuste_pendiente" tras un conteo ---

const resolverAjusteSchema = z.object({
  usuarioId: z.number().int().positive(),
  motivo: z.string().trim().optional(),
  // Ver nota de claveIdempotencia en salidaSchema — mismo mecanismo para
  // que un reintento sin conexión no duplique el ajuste.
  claveIdempotencia: z.string().trim().min(1).optional(),
});

async function resultadoAjustePorClave(claveIdempotencia: string) {
  const movimiento = await prisma.movimientoCamara.findUnique({ where: { claveIdempotencia } });
  if (!movimiento) return null;
  const caja = await prisma.cajaCamara.findUnique({ where: { id: movimiento.cajaId }, include: cajaConIncludes });
  return { caja, movimiento };
}

camaraRouter.post("/cajas/:id/confirmar-falta", async (req, res) => {
  const parsed = resolverAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo, claveIdempotencia } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  if (claveIdempotencia) {
    const yaProcesada = await resultadoAjustePorClave(claveIdempotencia);
    if (yaProcesada) return res.json(yaProcesada);
  }

  const caja = await prisma.cajaCamara.findUnique({ where: { id: Number(req.params.id) } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  if (caja.estado !== "ajuste_pendiente") {
    return res.status(400).json({ error: "Esta caja no está pendiente de ajuste" });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const cajaActualizada = await tx.cajaCamara.update({
      where: { id: caja.id },
      data: { saldoKg: 0, estado: "salida", version: { increment: 1 } },
      include: cajaConIncludes,
    });
    const movimiento = await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: "ajuste_salida",
        pesoKg: Math.max(caja.saldoKg, 0.001),
        origen: "camara",
        destino: "ajuste",
        motivo: motivo || "Faltante de inventario (conteo por escaneo)",
        usuarioId,
        claveIdempotencia: claveIdempotencia || randomUUID(),
      },
    });
    return { caja: cajaActualizada, movimiento };
  });

  res.json(resultado);
});

camaraRouter.post("/cajas/:id/encontrada", async (req, res) => {
  const parsed = resolverAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo, claveIdempotencia } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  if (claveIdempotencia) {
    const yaProcesada = await resultadoAjustePorClave(claveIdempotencia);
    if (yaProcesada) return res.json(yaProcesada);
  }

  const caja = await prisma.cajaCamara.findUnique({ where: { id: Number(req.params.id) } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  if (caja.estado !== "ajuste_pendiente") {
    return res.status(400).json({ error: "Esta caja no está pendiente de ajuste" });
  }

  const nuevoEstado = caja.saldoKg >= caja.pesoInicialKg - EPSILON_KG ? "en_camara" : "parcial";

  const resultado = await prisma.$transaction(async (tx) => {
    const cajaActualizada = await tx.cajaCamara.update({
      where: { id: caja.id },
      data: { estado: nuevoEstado, version: { increment: 1 } },
      include: cajaConIncludes,
    });
    const movimiento = await tx.movimientoCamara.create({
      data: {
        cajaId: caja.id,
        tipo: "ajuste_entrada",
        pesoKg: Math.max(caja.saldoKg, 0.001),
        origen: "ajuste",
        destino: "camara",
        motivo: motivo || "Caja encontrada tras conteo por escaneo",
        usuarioId,
        claveIdempotencia: claveIdempotencia || randomUUID(),
      },
    });
    return { caja: cajaActualizada, movimiento };
  });

  res.json(resultado);
});

// --- Importador del prototipo HTML anterior (localStorage) ---
//
// El prototipo (camara_actual_referencia.html) guardaba todo en
// localStorage del navegador, sin base de datos compartida. Para no
// perder lo ya cargado ahí, se pega el JSON exportado (con la consola del
// navegador: copy(localStorage.getItem('granCarniceria_camara_v1'))) acá.
// Los números de caja del prototipo SE PRESERVAN tal cual (id explícito en
// vez de dejar que la base de datos asigne uno nuevo) porque ya están
// impresos en etiquetas físicas pegadas en cajas reales — confirmado con
// el usuario que el sistema nuevo seguía vacío de datos reales, así que no
// hay riesgo de choque con cajas ya creadas acá.

const cajaPrototipoSchema = z.object({
  id: z.string(),
  producto: z.string(),
  familia: z.string(),
  pesoInicial: z.number(),
  saldo: z.number(),
  costo: z.number(),
  ingreso: z.string(),
  pesoEstimado: z.boolean().optional(),
});

const dbPrototipoSchema = z.object({
  cajas: z.array(cajaPrototipoSchema),
});

function claveGrupoPrototipo(familia: string, producto: string): string {
  return `${familia}|||${producto}`;
}

function parsearJsonPrototipo(
  crudo: unknown
): { ok: true; cajas: z.infer<typeof cajaPrototipoSchema>[] } | { ok: false; error: string } {
  if (typeof crudo !== "string" || !crudo.trim()) {
    return { ok: false, error: "Pega el contenido exportado del sistema anterior" };
  }
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    return { ok: false, error: "El texto pegado no es JSON válido — revisa que se haya copiado completo" };
  }
  const validado = dbPrototipoSchema.safeParse(parseado);
  if (!validado.success) {
    return { ok: false, error: "El JSON no tiene la forma esperada (¿es realmente el respaldo de la cámara anterior?)" };
  }
  return { ok: true, cajas: validado.data.cajas };
}

// --- Importador de un "resumen transcrito desde capturas" ---
//
// Cuando el export directo de localStorage no funcionó (ej. el navegador
// del prototipo no dejaba usar la consola), se puede armar a mano un JSON
// con los totales por lote a partir de fotos de la pantalla de Existencias
// del sistema anterior — sin peso individual por caja, solo totales por
// lote (fecha, hora, familia, producto, cantidad de cajas, sus números, kg
// totales y valor neto total). Mismo principio que el importador de
// arriba (nunca adivina el producto, revisa conflictos de número de caja),
// pero acá el peso de cada caja se reparte desde el total del lote
// (repartirPesoKg, igual que en Entrada de cámara) porque no está
// disponible por caja — y sí se crea el LoteCamara explícito, con los
// datos reales del lote en vez de una reconstrucción heurística.

const loteResumenSchema = z.object({
  fecha: z.string(),
  hora: z.string().optional(),
  familia: z.string(),
  producto: z.string(),
  procedencia: z.string().optional(),
  cantidad_cajas: z.number().int().positive(),
  numeros_caja: z.array(z.string()).min(1),
  kilos_totales: z.number().positive(),
  total_neto: z.number().nonnegative(),
});

const dbResumenSchema = z.object({
  lotes: z.array(loteResumenSchema),
});

type LoteResumen = z.infer<typeof loteResumenSchema>;

function detectarFormatoImportacion(crudo: unknown): { formato: "prototipo" | "resumen" | "invalido"; parseado?: unknown } {
  if (typeof crudo !== "string" || !crudo.trim()) return { formato: "invalido" };
  let parseado: unknown;
  try {
    parseado = JSON.parse(crudo);
  } catch {
    return { formato: "invalido" };
  }
  if (parseado && typeof parseado === "object") {
    if (Array.isArray((parseado as Record<string, unknown>).cajas)) return { formato: "prototipo", parseado };
    if (Array.isArray((parseado as Record<string, unknown>).lotes)) return { formato: "resumen", parseado };
  }
  return { formato: "invalido", parseado };
}

function parsearJsonResumen(parseado: unknown): { ok: true; lotes: LoteResumen[] } | { ok: false; error: string } {
  const validado = dbResumenSchema.safeParse(parseado);
  if (!validado.success) {
    return { ok: false, error: "El JSON no tiene la forma esperada (¿es realmente el resumen de la cámara anterior?)" };
  }
  for (const lote of validado.data.lotes) {
    if (lote.numeros_caja.length !== lote.cantidad_cajas) {
      return {
        ok: false,
        error: `El lote de "${lote.producto}" dice ${lote.cantidad_cajas} caja(s) pero trae ${lote.numeros_caja.length} número(s) de caja — revisa el archivo`,
      };
    }
    if (lote.familia === "Vacuno" && !lote.procedencia) {
      return {
        ok: false,
        error: `El lote de "${lote.producto}" es familia Vacuno pero no indica procedencia (Nacional/Brasil/Paraguay) — agrégala al archivo antes de importar`,
      };
    }
  }
  return { ok: true, lotes: validado.data.lotes };
}

camaraRouter.post("/importar-prototipo/previsualizar", async (req, res) => {
  const { formato, parseado } = detectarFormatoImportacion(req.body?.json);
  if (formato === "invalido") {
    return res.status(400).json({ error: "Pega el contenido exportado del sistema anterior (JSON válido)" });
  }

  const productosActivos = await prisma.producto.findMany({ where: { activo: true } });
  const porDescripcion = new Map(productosActivos.map((p) => [p.descripcion.trim().toLowerCase(), p]));

  type Grupo = { clave: string; familia: string; producto: string; cantidadCajas: number; productoIdSugerido: number | null; productoSugerido: string | null };
  const grupos = new Map<string, Grupo>();
  function acumular(familia: string, producto: string, cantidad: number) {
    const clave = claveGrupoPrototipo(familia, producto);
    if (!grupos.has(clave)) {
      const match = porDescripcion.get(producto.trim().toLowerCase());
      grupos.set(clave, {
        clave,
        familia,
        producto,
        cantidadCajas: 0,
        productoIdSugerido: match ? match.id : null,
        productoSugerido: match ? match.descripcion : null,
      });
    }
    grupos.get(clave)!.cantidadCajas += cantidad;
  }

  let totalCajas = 0;
  let idsNumericos: number[] = [];

  if (formato === "prototipo") {
    const resultado = parsearJsonPrototipo(req.body?.json);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    for (const c of resultado.cajas) acumular(c.familia, c.producto, 1);
    idsNumericos = resultado.cajas.map((c) => Number(c.id)).filter((n) => Number.isInteger(n));
    totalCajas = resultado.cajas.length;
  } else {
    const resultado = parsearJsonResumen(parseado);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    for (const l of resultado.lotes) acumular(l.familia, l.producto, l.cantidad_cajas);
    idsNumericos = resultado.lotes.flatMap((l) => l.numeros_caja.map((n) => Number(n))).filter((n) => Number.isInteger(n));
    totalCajas = idsNumericos.length;
  }

  const existentes = idsNumericos.length
    ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNumericos } }, select: { id: true } })
    : [];
  const cajasConConflicto = existentes.map((c) => c.id);

  res.json({
    totalCajas,
    cajasConConflicto,
    grupos: [...grupos.values()],
  });
});

const confirmarImportacionSchema = z.object({
  json: z.string().min(1),
  usuarioId: z.number().int().positive(),
  mapeo: z.array(z.object({ clave: z.string(), productoId: z.number().int().positive().nullable() })),
});

camaraRouter.post("/importar-prototipo/confirmar", async (req, res) => {
  const parsed = confirmarImportacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, mapeo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const { formato, parseado } = detectarFormatoImportacion(parsed.data.json);
  if (formato === "invalido") {
    return res.status(400).json({ error: "Pega el contenido exportado del sistema anterior (JSON válido)" });
  }

  const mapaProducto = new Map(mapeo.map((m) => [m.clave, m.productoId]));
  let importadas = 0;
  const omitidasPorConflicto: number[] = [];
  const omitidasPorProducto: number[] = [];

  if (formato === "prototipo") {
    const resultado = parsearJsonPrototipo(parsed.data.json);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    const cajasPrototipo = resultado.cajas;

    const idsNumericos = cajasPrototipo.map((c) => Number(c.id)).filter((n) => Number.isInteger(n));
    const existentes = idsNumericos.length
      ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNumericos } }, select: { id: true } })
      : [];
    const idsConflicto = new Set(existentes.map((c) => c.id));

    await prisma.$transaction(async (tx) => {
      for (const c of cajasPrototipo) {
        const idNum = Number(c.id);
        if (!Number.isInteger(idNum)) continue;
        if (idsConflicto.has(idNum)) {
          omitidasPorConflicto.push(idNum);
          continue;
        }
        const productoId = mapaProducto.get(claveGrupoPrototipo(c.familia, c.producto));
        if (!productoId) {
          omitidasPorProducto.push(idNum);
          continue;
        }

        const pesoInicial = c.pesoInicial;
        const saldo = Math.max(0, c.saldo);
        const estado = saldo <= EPSILON_KG ? "salida" : saldo < pesoInicial - EPSILON_KG ? "parcial" : "en_camara";
        const fechaIngreso = new Date(c.ingreso);

        await tx.cajaCamara.create({
          data: {
            id: idNum,
            productoId,
            familiaNombre: c.familia,
            fechaIngreso,
            pesoInicialKg: pesoInicial,
            saldoKg: saldo,
            costoNetoKg: c.costo,
            estado,
            pesoEstimado: c.pesoEstimado ?? false,
            creadoPorId: usuarioId,
          },
        });

        await tx.movimientoCamara.create({
          data: {
            cajaId: idNum,
            tipo: "entrada",
            pesoKg: pesoInicial,
            destino: "camara",
            motivo: "Importado del sistema anterior",
            usuarioId,
            claveIdempotencia: randomUUID(),
            creadoEn: fechaIngreso,
          },
        });

        // No se migra el historial de salidas del prototipo tal cual (los
        // destinos registrados ahí no calzan uno a uno con los del sistema
        // nuevo) — se resume en un solo movimiento que deja el saldo
        // correcto y auditado, aclarando en el motivo que el detalle
        // original no se migró.
        if (saldo < pesoInicial - EPSILON_KG) {
          await tx.movimientoCamara.create({
            data: {
              cajaId: idNum,
              tipo: saldo <= EPSILON_KG ? "salida_completa" : "salida_parcial",
              pesoKg: Math.round((pesoInicial - saldo) * 1000) / 1000,
              origen: "camara",
              destino: "otro",
              motivo: "Salida registrada en el sistema anterior (detalle no migrado)",
              usuarioId,
              claveIdempotencia: randomUUID(),
            },
          });
        }

        importadas++;
      }
    });
  } else {
    const resultado = parsearJsonResumen(parseado);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    const lotes = resultado.lotes;

    const idsNumericos = lotes.flatMap((l) => l.numeros_caja.map((n) => Number(n)));
    const existentes = idsNumericos.length
      ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNumericos } }, select: { id: true } })
      : [];
    const idsConflicto = new Set(existentes.map((c) => c.id));

    await prisma.$transaction(async (tx) => {
      for (const lote of lotes) {
        const numerosLote = lote.numeros_caja.map((n) => Number(n));
        const productoId = mapaProducto.get(claveGrupoPrototipo(lote.familia, lote.producto));
        const indicesSinConflicto = numerosLote
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => !idsConflicto.has(n));

        for (const { n } of numerosLote.map((n) => ({ n })).filter(({ n }) => idsConflicto.has(n))) {
          omitidasPorConflicto.push(n);
        }
        if (!productoId) {
          for (const { n } of indicesSinConflicto) omitidasPorProducto.push(n);
          continue;
        }
        if (indicesSinConflicto.length === 0) continue;

        const costoNetoKg = lote.total_neto / lote.kilos_totales;
        const fechaIngreso = new Date(`${lote.fecha}T${lote.hora ?? "00:00"}:00`);
        const pesos = repartirPesoKg(lote.kilos_totales, lote.cantidad_cajas);
        const pesoTotalCreado = Math.round(indicesSinConflicto.reduce((s, { i }) => s + pesos[i], 0) * 1000) / 1000;

        const loteCreado = await tx.loteCamara.create({
          data: {
            productoId,
            familiaNombre: lote.familia,
            procedencia: lote.procedencia ?? null,
            cantidadCajas: indicesSinConflicto.length,
            pesoTotalKg: pesoTotalCreado,
            costoNetoKg,
            totalNeto: Math.round(pesoTotalCreado * costoNetoKg),
            fechaIngreso,
            creadoPorId: usuarioId,
            reconstruido: false,
          },
        });

        for (const { n, i } of indicesSinConflicto) {
          const peso = pesos[i];
          await tx.cajaCamara.create({
            data: {
              id: n,
              loteId: loteCreado.id,
              productoId,
              familiaNombre: lote.familia,
              procedencia: lote.procedencia ?? null,
              fechaIngreso,
              pesoInicialKg: peso,
              saldoKg: peso,
              costoNetoKg,
              estado: "en_camara",
              pesoEstimado: true,
              creadoPorId: usuarioId,
            },
          });
          await tx.movimientoCamara.create({
            data: {
              cajaId: n,
              tipo: "entrada",
              pesoKg: peso,
              destino: "camara",
              motivo: "Importado del sistema anterior (resumen transcrito de capturas, sin peso individual por caja)",
              usuarioId,
              claveIdempotencia: randomUUID(),
              creadoEn: fechaIngreso,
            },
          });
          importadas++;
        }
      }
    });
  }

  res.json({ importadas, omitidasPorConflicto, omitidasPorProducto });
});

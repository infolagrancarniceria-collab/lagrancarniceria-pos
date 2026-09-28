import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { validarUsuarioActivo, tienePermiso, verificarClavePersonal } from "../lib/rolesCharcuteria";
import { verificarClaveConLimite } from "../lib/clave";
import type { Prisma } from "@prisma/client";

export const charcuteriaLotesRouter = Router();

const loteConIncludes = {
  receta: { include: { productoElaborado: true } },
  responsable: true,
  insumosConsumidos: { include: { item: true } },
  envasados: { include: { sku: true, envaseItem: true, etiquetaItem: true } },
  stockPorSku: { include: { sku: true } },
  cambiosVencimiento: { include: { usuario: true }, orderBy: { creadoEn: "desc" } },
} satisfies Prisma.LoteProduccionInclude;

// Costo unitario de un ítem de charcutería en la MISMA unidad que su
// unidadMedida (por gramo si "gramos", por unidad si "unidad") —
// ItemCharcuteria.costoReferencia siempre se guarda por kg/unidad (ver
// charcuteriaTransferencias.ts), así que un ítem por peso se convierte acá.
function costoPorUnidadMedida(item: { costoReferencia: number | null; unidadMedida: string }): number {
  if (item.costoReferencia == null) return 0;
  return item.unidadMedida === "gramos" ? item.costoReferencia / 1000 : item.costoReferencia;
}

// Recalcula LoteProduccion.costoTotal sumando: insumos consumidos (a su
// costo real al momento, ya congelado en cada LoteInsumoConsumido — no se
// recalcula con el costo actual del ítem, así un lote viejo no cambia de
// costo si el precio de transferencia sube después) + mano de obra
// imputada + envases/etiquetas ya consumidos en cualquier Envasado de este
// lote (a su costo actual, porque ahí no se congela un costoUnitario
// propio) + otros costos manuales. Se llama después de cualquier cambio
// que afecte el costo (agregar insumo, cerrar el lote, envasar).
export async function recalcularCostoLote(tx: Prisma.TransactionClient, loteId: number) {
  const lote = await tx.loteProduccion.findUniqueOrThrow({
    where: { id: loteId },
    include: { insumosConsumidos: true, envasados: { include: { envaseItem: true, etiquetaItem: true } } },
  });

  const costoInsumos = lote.insumosConsumidos.reduce((s, i) => s + i.cantidad * i.costoUnitarioAlMomento, 0);
  const costoManoObra = (lote.horasManoObra ?? 0) * (lote.costoHoraManoObra ?? 0);
  const costoEnvasesEtiquetas = lote.envasados.reduce((s, e) => {
    const costoEnvase = e.envaseItem && e.envasesConsumidos ? costoPorUnidadMedida(e.envaseItem) * e.envasesConsumidos : 0;
    const costoEtiqueta = e.etiquetaItem && e.etiquetasConsumidas ? costoPorUnidadMedida(e.etiquetaItem) * e.etiquetasConsumidas : 0;
    return s + costoEnvase + costoEtiqueta;
  }, 0);
  const costoTotal = costoInsumos + costoManoObra + costoEnvasesEtiquetas + (lote.otrosCostosManuales ?? 0);

  await tx.loteProduccion.update({ where: { id: loteId }, data: { costoTotal: Math.round(costoTotal) } });
}

// "CH-AAMMDD-NN" — NN reinicia cada día, contando los lotes ya creados hoy
// (a cualquier hora del día calendario, no un período de 24h). Alcanza de
// sobra para el volumen de una carnicería; ajustable después si hace falta
// un correlativo global.
async function generarCodigoLote(tx: Prisma.TransactionClient): Promise<string> {
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const finDia = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000);
  const cantidadHoy = await tx.loteProduccion.count({
    where: { fechaElaboracion: { gte: inicioDia, lt: finDia } },
  });
  const aa = String(ahora.getFullYear()).slice(-2);
  const mm = String(ahora.getMonth() + 1).padStart(2, "0");
  const dd = String(ahora.getDate()).padStart(2, "0");
  const nn = String(cantidadHoy + 1).padStart(2, "0");
  return `CH-${aa}${mm}${dd}-${nn}`;
}

charcuteriaLotesRouter.get("/", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const lotes = await prisma.loteProduccion.findMany({
    where: estado ? { estado } : undefined,
    include: loteConIncludes,
    orderBy: { fechaElaboracion: "desc" },
    take: 200,
  });
  res.json(lotes);
});

charcuteriaLotesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const lote = await prisma.loteProduccion.findUnique({ where: { id }, include: loteConIncludes });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  res.json(lote);
});

const crearLoteSchema = z.object({
  usuarioId: z.number().int().positive(),
  recetaId: z.number().int().positive(),
});

charcuteriaLotesRouter.post("/", async (req, res) => {
  const parsed = crearLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin", "produccion"])) {
    return res.status(403).json({ error: "Tu rol no puede crear lotes de producción" });
  }

  const receta = await prisma.receta.findUnique({ where: { id: data.recetaId }, include: { productoElaborado: true } });
  if (!receta) return res.status(404).json({ error: "Receta no encontrada" });

  const lote = await prisma.$transaction(async (tx) => {
    const codigo = await generarCodigoLote(tx);
    const fechaVencimiento = receta.productoElaborado.vidaUtilDias
      ? new Date(Date.now() + receta.productoElaborado.vidaUtilDias * 24 * 60 * 60 * 1000)
      : null;
    return tx.loteProduccion.create({
      data: {
        codigo,
        recetaId: receta.id,
        recetaVersion: receta.version,
        responsableId: data.usuarioId,
        mermaEsperadaPct: 100 - receta.rendimientoEsperadoPct,
        fechaVencimiento,
      },
      include: loteConIncludes,
    });
  });

  res.status(201).json(lote);
});

const agregarInsumoSchema = z.object({
  usuarioId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  origenTipo: z.enum(["transferencia", "compra"]).default("transferencia"),
});

charcuteriaLotesRouter.post("/:id/insumos", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = agregarInsumoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin", "produccion"])) {
    return res.status(403).json({ error: "Tu rol no puede registrar consumo de insumos" });
  }

  const lote = await prisma.loteProduccion.findUnique({ where: { id: loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (lote.estado !== "en_proceso") {
    return res.status(400).json({ error: `No se pueden agregar insumos a un lote en estado "${lote.estado}"` });
  }

  const item = await prisma.itemCharcuteria.findUnique({ where: { id: data.itemId } });
  if (!item) return res.status(404).json({ error: "Ítem no encontrado" });
  if (item.stockActual < data.cantidad) {
    return res.status(400).json({
      error: `Stock insuficiente de "${item.nombre}": quedan ${item.stockActual} ${item.unidadMedida}, se intentó usar ${data.cantidad}`,
    });
  }

  const costoUnitarioAlMomento = costoPorUnidadMedida(item);

  const actualizado = await prisma.$transaction(async (tx) => {
    await tx.loteInsumoConsumido.create({
      data: {
        loteId,
        itemId: data.itemId,
        cantidad: data.cantidad,
        origenTipo: data.origenTipo,
        costoUnitarioAlMomento,
      },
    });
    await tx.itemCharcuteria.update({ where: { id: data.itemId }, data: { stockActual: { decrement: data.cantidad } } });
    await tx.movimientoCharcuteria.create({
      data: {
        itemId: data.itemId,
        tipo: "salida",
        motivo: "consumo_lote",
        cantidad: data.cantidad,
        referenciaTipo: "lote",
        referenciaId: loteId,
        usuarioId: data.usuarioId,
      },
    });

    // pesoEntradaKg se acumula solo con lo que sea materia_prima medida en
    // gramos — insumos (sal, especias, tripas) no cuentan como "entrada de
    // carne" para el cálculo de merma. Se arma el valor a mano (en vez de
    // usar { increment } de Prisma) porque el campo empieza en null, y en
    // SQL "null + lo que sea" sigue dando null — { increment } nunca
    // lograba dejar el primer valor puesto.
    if (item.tipoItem === "materia_prima" && item.unidadMedida === "gramos") {
      await tx.loteProduccion.update({
        where: { id: loteId },
        data: { pesoEntradaKg: (lote.pesoEntradaKg ?? 0) + data.cantidad / 1000 },
      });
    }

    await recalcularCostoLote(tx, loteId);
    return tx.loteProduccion.findUniqueOrThrow({ where: { id: loteId }, include: loteConIncludes });
  });

  res.json(actualizado);
});

const cerrarLoteSchema = z.object({
  usuarioId: z.number().int().positive(),
  pesoSalidaKg: z.number().positive("El peso de salida debe ser mayor a 0"),
  // Si se manda, sobrescribe el peso de entrada acumulado automáticamente
  // al agregar insumos (ej. el operador pesó la materia prima antes de
  // cargarla, y ese peso real difiere un poco de la suma de cantidades
  // tipeadas por insumo).
  pesoEntradaKg: z.number().positive().optional(),
  horasManoObra: z.number().min(0).optional(),
  costoHoraManoObra: z.number().min(0).optional(),
  otrosCostosManuales: z.number().min(0).optional(),
  parametrosRealesProceso: z.string().trim().optional().nullable(),
});

charcuteriaLotesRouter.put("/:id/cerrar", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = cerrarLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin", "produccion"])) {
    return res.status(403).json({ error: "Tu rol no puede cerrar lotes" });
  }

  const lote = await prisma.loteProduccion.findUnique({ where: { id: loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (lote.estado !== "en_proceso") {
    return res.status(400).json({ error: `El lote ya está en estado "${lote.estado}"` });
  }

  const pesoEntradaKg = data.pesoEntradaKg ?? lote.pesoEntradaKg;
  if (!pesoEntradaKg || pesoEntradaKg <= 0) {
    return res.status(400).json({ error: "Falta el peso de entrada — registra al menos un insumo de materia prima antes de cerrar" });
  }
  const mermaRealPct = Math.round((1 - data.pesoSalidaKg / pesoEntradaKg) * 10000) / 100;

  const actualizado = await prisma.$transaction(async (tx) => {
    await tx.loteProduccion.update({
      where: { id: loteId },
      data: {
        pesoEntradaKg,
        pesoSalidaKg: data.pesoSalidaKg,
        mermaRealPct,
        horasManoObra: data.horasManoObra ?? null,
        costoHoraManoObra: data.costoHoraManoObra ?? null,
        otrosCostosManuales: data.otrosCostosManuales ?? null,
        parametrosRealesProceso: data.parametrosRealesProceso ?? null,
        estado: "terminado",
      },
    });
    await recalcularCostoLote(tx, loteId);
    return tx.loteProduccion.findUniqueOrThrow({ where: { id: loteId }, include: loteConIncludes });
  });

  res.json(actualizado);
});

const editarVencimientoSchema = z.object({
  usuarioId: z.number().int().positive(),
  clave: z.string().min(1, "Falta la clave"),
  vencimientoNuevo: z.string().datetime().or(z.string().min(1)),
  motivo: z.string().trim().min(1, "Falta el motivo del cambio"),
});

// Editar el vencimiento de un lote — solo admin, con clave personal y
// registro del cambio (nunca se sobrescribe en silencio, ver
// LoteVencimientoCambio).
charcuteriaLotesRouter.put("/:id/vencimiento", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = editarVencimientoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin"])) {
    return res.status(403).json({ error: "Solo un admin puede editar el vencimiento de un lote" });
  }

  const errorClave = await verificarClavePersonal(data.usuarioId, data.clave, req.ip ?? "desconocido");
  if (errorClave) return res.status(errorClave.status).json({ error: errorClave.error });

  const lote = await prisma.loteProduccion.findUnique({ where: { id: loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });

  const vencimientoNuevo = new Date(data.vencimientoNuevo);
  if (Number.isNaN(vencimientoNuevo.getTime())) return res.status(400).json({ error: "Fecha de vencimiento inválida" });

  const actualizado = await prisma.$transaction(async (tx) => {
    await tx.loteVencimientoCambio.create({
      data: {
        loteId,
        vencimientoAnterior: lote.fechaVencimiento,
        vencimientoNuevo,
        motivo: data.motivo,
        usuarioId: data.usuarioId,
      },
    });
    return tx.loteProduccion.update({
      where: { id: loteId },
      data: { fechaVencimiento: vencimientoNuevo },
      include: loteConIncludes,
    });
  });

  res.json(actualizado);
});

const anularLoteSchema = z.object({
  usuarioId: z.number().int().positive(),
  clave: z.string().min(1, "Falta la clave"),
});

// Anular un lote — mismo criterio que anular una venta: clave de
// supervisor (no personal, porque es una acción excepcional/correctiva,
// igual que las anulaciones del resto del sistema). No revierte stock ya
// envasado/vendido: solo bloquea que se siga usando o vendiendo desde acá
// en adelante (ver validación de "no vender lotes anulados").
charcuteriaLotesRouter.put("/:id/anular", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = anularLoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  const resultado = verificarClaveConLimite(req.ip ?? "desconocido", data.clave, claveSupervisor.hashClave);
  if (resultado.bloqueado) {
    return res.status(429).json({ error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultado.valida) return res.status(403).json({ error: "Clave de supervisor incorrecta" });

  const lote = await prisma.loteProduccion.findUnique({ where: { id: loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });

  const actualizado = await prisma.loteProduccion.update({
    where: { id: loteId },
    data: { estado: "anulado" },
    include: loteConIncludes,
  });
  res.json(actualizado);
});

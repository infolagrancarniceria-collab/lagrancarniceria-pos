import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { validarUsuarioActivo, tienePermiso } from "../lib/rolesCharcuteria";
import { recalcularCostoLote } from "./charcuteriaLotes";
import type { Prisma } from "@prisma/client";

export const charcuteriaEnvasadoRouter = Router();

const envasadoConIncludes = {
  lote: true,
  sku: true,
  envaseItem: true,
  etiquetaItem: true,
  responsable: true,
} satisfies Prisma.EnvasadoInclude;

// Fracciona el stock a granel de un lote ya terminado en unidades de un SKU
// de formato fijo — solo soporta SKU envasado en formato fijo (con
// formatoGramos), no SKU a granel (ese caso no pasa por Envasado/
// StockLoteSku todavía; ver informe de cierre de Fase 1).
const envasarSchema = z.object({
  usuarioId: z.number().int().positive(),
  skuId: z.number().int().positive(),
  cantidadUnidadesGeneradas: z.number().int().positive("La cantidad de unidades debe ser mayor a 0"),
  pesoRealTotalUsadoG: z.number().int().positive("El peso usado debe ser mayor a 0"),
  envaseItemId: z.number().int().positive().optional(),
  envasesConsumidos: z.number().int().positive().optional(),
  etiquetaItemId: z.number().int().positive().optional(),
  etiquetasConsumidas: z.number().int().positive().optional(),
});

charcuteriaEnvasadoRouter.post("/lotes/:id/envasar", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = envasarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin", "produccion"])) {
    return res.status(403).json({ error: "Tu rol no puede envasar" });
  }

  const lote = await prisma.loteProduccion.findUnique({
    where: { id: loteId },
    include: { receta: true, envasados: true },
  });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (lote.estado !== "terminado" && lote.estado !== "envasado") {
    return res.status(400).json({ error: `No se puede envasar un lote en estado "${lote.estado}"` });
  }

  const sku = await prisma.itemCharcuteria.findUnique({ where: { id: data.skuId } });
  if (!sku || sku.tipoItem !== "producto_terminado") {
    return res.status(400).json({ error: "El SKU indicado no existe o no es un producto terminado" });
  }
  if (sku.formatoGramos == null) {
    return res.status(400).json({ error: "Este SKU se vende a granel — el envasado en unidades no aplica" });
  }
  if (sku.productoElaboradoId !== lote.receta.productoElaboradoId) {
    return res.status(400).json({ error: "Este SKU no corresponde al producto elaborado de este lote" });
  }

  const pesoSalidaG = Math.round((lote.pesoSalidaKg ?? 0) * 1000);
  const yaUsadoG = lote.envasados.reduce((s, e) => s + e.pesoRealTotalUsadoG, 0);
  if (yaUsadoG + data.pesoRealTotalUsadoG > pesoSalidaG) {
    return res.status(400).json({
      error: `El lote solo rindió ${pesoSalidaG} g (ya se envasaron ${yaUsadoG} g) — no se puede usar ${data.pesoRealTotalUsadoG} g más`,
    });
  }

  let envaseItem = null;
  if (data.envaseItemId) {
    envaseItem = await prisma.itemCharcuteria.findUnique({ where: { id: data.envaseItemId } });
    if (!envaseItem || envaseItem.tipoItem !== "envase_etiqueta") {
      return res.status(400).json({ error: "El envase indicado no existe o no es del tipo correcto" });
    }
    if (data.envasesConsumidos && envaseItem.stockActual < data.envasesConsumidos) {
      return res.status(400).json({ error: `Stock insuficiente de envases: quedan ${envaseItem.stockActual}` });
    }
  }
  let etiquetaItem = null;
  if (data.etiquetaItemId) {
    etiquetaItem = await prisma.itemCharcuteria.findUnique({ where: { id: data.etiquetaItemId } });
    if (!etiquetaItem || etiquetaItem.tipoItem !== "envase_etiqueta") {
      return res.status(400).json({ error: "La etiqueta indicada no existe o no es del tipo correcto" });
    }
    if (data.etiquetasConsumidas && etiquetaItem.stockActual < data.etiquetasConsumidas) {
      return res.status(400).json({ error: `Stock insuficiente de etiquetas: quedan ${etiquetaItem.stockActual}` });
    }
  }

  const diferenciaPesoG = data.pesoRealTotalUsadoG - data.cantidadUnidadesGeneradas * sku.formatoGramos;

  const envasado = await prisma.$transaction(async (tx) => {
    const nuevo = await tx.envasado.create({
      data: {
        loteId,
        skuId: data.skuId,
        cantidadUnidadesGeneradas: data.cantidadUnidadesGeneradas,
        pesoNetoPorUnidadG: sku.formatoGramos!,
        pesoRealTotalUsadoG: data.pesoRealTotalUsadoG,
        diferenciaPesoG,
        envaseItemId: data.envaseItemId ?? null,
        envasesConsumidos: data.envasesConsumidos ?? null,
        etiquetaItemId: data.etiquetaItemId ?? null,
        etiquetasConsumidas: data.etiquetasConsumidas ?? null,
        responsableId: data.usuarioId,
      },
      include: envasadoConIncludes,
    });

    if (data.envaseItemId && data.envasesConsumidos) {
      await tx.itemCharcuteria.update({ where: { id: data.envaseItemId }, data: { stockActual: { decrement: data.envasesConsumidos } } });
      await tx.movimientoCharcuteria.create({
        data: {
          itemId: data.envaseItemId,
          tipo: "salida",
          motivo: "envasado",
          cantidad: data.envasesConsumidos,
          referenciaTipo: "lote",
          referenciaId: loteId,
          usuarioId: data.usuarioId,
        },
      });
    }
    if (data.etiquetaItemId && data.etiquetasConsumidas) {
      await tx.itemCharcuteria.update({ where: { id: data.etiquetaItemId }, data: { stockActual: { decrement: data.etiquetasConsumidas } } });
      await tx.movimientoCharcuteria.create({
        data: {
          itemId: data.etiquetaItemId,
          tipo: "salida",
          motivo: "envasado",
          cantidad: data.etiquetasConsumidas,
          referenciaTipo: "lote",
          referenciaId: loteId,
          usuarioId: data.usuarioId,
        },
      });
    }

    await tx.stockLoteSku.upsert({
      where: { loteId_skuId: { loteId, skuId: data.skuId } },
      create: { loteId, skuId: data.skuId, saldoUnidades: data.cantidadUnidadesGeneradas },
      update: { saldoUnidades: { increment: data.cantidadUnidadesGeneradas } },
    });

    if (lote.estado === "terminado") {
      await tx.loteProduccion.update({ where: { id: loteId }, data: { estado: "envasado" } });
    }

    await recalcularCostoLote(tx, loteId);

    return nuevo;
  });

  res.status(201).json(envasado);
});

const cerrarDefinitivoSchema = z.object({ usuarioId: z.number().int().positive() });

// Marca el lote como "cerrado" — a partir de acá ya no se puede seguir
// envasando ni agregando insumos (archivado, no anulado: el stock ya
// generado y vendido queda intacto).
charcuteriaEnvasadoRouter.put("/lotes/:id/cerrar-definitivo", async (req, res) => {
  const loteId = Number(req.params.id);
  const parsed = cerrarDefinitivoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const usuario = await validarUsuarioActivo(parsed.data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });
  if (!tienePermiso(usuario.rol, ["admin", "produccion"])) {
    return res.status(403).json({ error: "Tu rol no puede cerrar lotes" });
  }

  const lote = await prisma.loteProduccion.findUnique({ where: { id: loteId } });
  if (!lote) return res.status(404).json({ error: "Lote no encontrado" });
  if (lote.estado !== "envasado" && lote.estado !== "terminado") {
    return res.status(400).json({ error: `No se puede cerrar un lote en estado "${lote.estado}"` });
  }

  const actualizado = await prisma.loteProduccion.update({ where: { id: loteId }, data: { estado: "cerrado" } });
  res.json(actualizado);
});

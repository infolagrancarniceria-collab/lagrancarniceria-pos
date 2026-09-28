import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { validarUsuarioActivo } from "../lib/rolesCharcuteria";
import type { Prisma } from "@prisma/client";

export const charcuteriaTransferenciasRouter = Router();

const transferenciaConIncludes = {
  productoOrigen: true,
  itemDestino: true,
  responsable: true,
} satisfies Prisma.TransferenciaInternaInclude;

charcuteriaTransferenciasRouter.get("/", async (req, res) => {
  const itemDestinoId = req.query.itemDestinoId ? Number(req.query.itemDestinoId) : undefined;
  const transferencias = await prisma.transferenciaInterna.findMany({
    where: itemDestinoId ? { itemDestinoId } : undefined,
    include: transferenciaConIncludes,
    orderBy: { fecha: "desc" },
    take: 200,
  });
  res.json(transferencias);
});

// Precio por defecto cuando no se configuró ninguno todavía para este
// ítem: primero el precio de venta neto vigente del producto de origen en
// carnicería (regla pedida); si ese no sirve de referencia real (0, o el
// producto no se vende directo al público), cae al costo de la última
// compra registrada de ese producto; si tampoco hay ninguna compra, cae al
// costo de referencia ya cargado en el ítem de destino. Si nada de eso
// existe, no hay default posible — se exige ingresarlo a mano (nunca
// costo cero).
async function calcularPrecioTransferenciaDefault(productoOrigenId: number, itemDestinoId: number): Promise<number | null> {
  const origen = await prisma.producto.findUnique({ where: { id: productoOrigenId } });
  if (origen && origen.precio > 0) return origen.precio;

  const ultimaCompra = await prisma.movimientoInventario.findFirst({
    where: { productoId: productoOrigenId, tipo: "entrada", motivo: "compra", costoUnitario: { not: null } },
    orderBy: { fecha: "desc" },
  });
  if (ultimaCompra?.costoUnitario) return ultimaCompra.costoUnitario;

  const destino = await prisma.itemCharcuteria.findUnique({ where: { id: itemDestinoId } });
  if (destino?.costoReferencia) return destino.costoReferencia;

  return null;
}

charcuteriaTransferenciasRouter.get("/precio-sugerido", async (req, res) => {
  const productoOrigenId = Number(req.query.productoOrigenId);
  const itemDestinoId = Number(req.query.itemDestinoId);
  if (!productoOrigenId || !itemDestinoId) {
    return res.status(400).json({ error: "Faltan productoOrigenId/itemDestinoId" });
  }
  const vigente = await prisma.precioTransferencia.findFirst({
    where: { itemId: itemDestinoId },
    orderBy: { vigenteDesde: "desc" },
  });
  if (vigente) return res.json({ sugerido: vigente.precioPorKgOUnidad, configurado: true });
  const sugerido = await calcularPrecioTransferenciaDefault(productoOrigenId, itemDestinoId);
  res.json({ sugerido, configurado: false });
});

const crearTransferenciaSchema = z.object({
  usuarioId: z.number().int().positive(),
  productoOrigenId: z.number().int().positive(),
  itemDestinoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  // Si no se manda, se usa el precio de transferencia vigente para el
  // ítem, o el default calculado (ver calcularPrecioTransferenciaDefault).
  precioPorKg: z.number().positive("El precio de transferencia no puede ser cero").optional(),
});

charcuteriaTransferenciasRouter.post("/", async (req, res) => {
  const parsed = crearTransferenciaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const data = parsed.data;

  const usuario = await validarUsuarioActivo(data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const productoOrigen = await prisma.producto.findUnique({ where: { id: data.productoOrigenId } });
  if (!productoOrigen) return res.status(404).json({ error: "Producto de origen no encontrado" });
  if (productoOrigen.businessUnitId !== 1) {
    return res.status(400).json({ error: "El producto de origen debe ser del catálogo de carnicería" });
  }
  if (productoOrigen.stockActual < data.cantidad) {
    return res.status(400).json({
      error: `Stock insuficiente en carnicería: quedan ${productoOrigen.stockActual}, se intentó transferir ${data.cantidad}`,
    });
  }

  const itemDestino = await prisma.itemCharcuteria.findUnique({ where: { id: data.itemDestinoId } });
  if (!itemDestino) return res.status(404).json({ error: "Ítem de destino no encontrado" });
  if (!["materia_prima", "insumo"].includes(itemDestino.tipoItem)) {
    return res.status(400).json({ error: "Solo se puede transferir hacia materia prima o insumos" });
  }

  const vigente = await prisma.precioTransferencia.findFirst({
    where: { itemId: data.itemDestinoId },
    orderBy: { vigenteDesde: "desc" },
  });

  let precioPorKg = data.precioPorKg ?? vigente?.precioPorKgOUnidad ?? null;
  if (precioPorKg == null) {
    precioPorKg = await calcularPrecioTransferenciaDefault(data.productoOrigenId, data.itemDestinoId);
  }
  if (precioPorKg == null) {
    return res.status(400).json({
      error: "No hay ningún precio de referencia para este ítem — indica el precio de transferencia a mano",
    });
  }
  if (precioPorKg <= 0) return res.status(400).json({ error: "El precio de transferencia no puede ser cero" });

  const transferencia = await prisma.$transaction(async (tx) => {
    // Se crea una fila de historial de precio nueva solo si no hay ninguna
    // vigente todavía, o si el precio usado esta vez es distinto al
    // vigente — así el historial no se llena de filas idénticas repetidas
    // en cada transferencia normal.
    const precioTransferenciaRegistro =
      vigente && vigente.precioPorKgOUnidad === precioPorKg
        ? vigente
        : await tx.precioTransferencia.create({
            data: { itemId: data.itemDestinoId, precioPorKgOUnidad: precioPorKg!, creadoPorId: data.usuarioId },
          });

    await tx.producto.update({
      where: { id: data.productoOrigenId },
      data: { stockActual: { decrement: data.cantidad } },
    });
    await tx.movimientoInventario.create({
      data: {
        productoId: data.productoOrigenId,
        usuarioId: data.usuarioId,
        tipo: "salida",
        motivo: "transferencia_charcuteria",
        cantidad: data.cantidad,
        businessUnitId: 1,
      },
    });

    const nueva = await tx.transferenciaInterna.create({
      data: {
        productoOrigenId: data.productoOrigenId,
        itemDestinoId: data.itemDestinoId,
        cantidad: data.cantidad,
        precioTransferenciaId: precioTransferenciaRegistro.id,
        precioPorKg: precioPorKg!,
        responsableId: data.usuarioId,
      },
      include: transferenciaConIncludes,
    });

    // TransferenciaInterna.cantidad viaja en kg (mismo criterio que el
    // stock de carnicería, de donde sale) — pero el catálogo de
    // charcutería mide en gramos enteros (ver ItemCharcuteria.unidadMedida),
    // así que se convierte acá al sumar el stock de destino. Si algún día
    // se transfiere un insumo cuya unidadMedida es "unidad" (ej. una caja
    // de tripas contada por pieza, no por peso), esta conversión no aplica
    // — no soportado todavía, ver informe de cierre de fase.
    const cantidadGramos = Math.round(data.cantidad * 1000);
    await tx.itemCharcuteria.update({
      where: { id: data.itemDestinoId },
      // costoReferencia queda en la misma unidad que PrecioTransferencia
      // ($/kg o $/unidad) — se actualiza con cada transferencia para que
      // el costeo de lotes siempre use el costo real más reciente.
      data: { stockActual: { increment: cantidadGramos }, costoReferencia: precioPorKg! },
    });
    await tx.movimientoCharcuteria.create({
      data: {
        itemId: data.itemDestinoId,
        tipo: "entrada",
        motivo: "transferencia",
        cantidad: cantidadGramos,
        referenciaTipo: "transferencia",
        referenciaId: nueva.id,
        usuarioId: data.usuarioId,
      },
    });

    return nueva;
  });

  res.status(201).json(transferencia);
});

import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerCategoriaRaiz } from "../lib/categorias";

export const camaraRouter = Router();

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
} as const;

// --- Entrada de cajas (lote) ---

const entradaLoteSchema = z
  .object({
    productoId: z.number().int().positive(),
    cantidadCajas: z.number().int().positive("La cantidad de cajas debe ser mayor a 0"),
    pesoTotalKg: z.number().positive().optional(),
    pesoIndividualKg: z.number().positive().optional(),
    costoNetoKg: z.number().positive("El costo debe ser mayor a 0"),
    usuarioId: z.number().int().positive(),
    dispositivo: z.string().trim().optional(),
  })
  .refine((data) => (data.pesoTotalKg == null) !== (data.pesoIndividualKg == null), {
    message: "Indica el peso total del lote o el peso individual por caja, pero no ambos",
    path: ["pesoTotalKg"],
  });

camaraRouter.post("/cajas", async (req, res) => {
  const parsed = entradaLoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { productoId, cantidadCajas, pesoTotalKg, pesoIndividualKg, costoNetoKg, usuarioId, dispositivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  const familia = await obtenerCategoriaRaiz(producto.categoriaId);

  const pesoEstimado = pesoTotalKg != null;
  const pesosPorCaja = pesoEstimado
    ? repartirPesoKg(pesoTotalKg!, cantidadCajas)
    : Array.from({ length: cantidadCajas }, () => pesoIndividualKg!);

  // No se puede usar la forma "array" de $transaction acá porque cada
  // movimiento necesita el id de SU PROPIA caja, recién asignado por la
  // base de datos al crearla — se necesita la forma "interactiva" para
  // poder encadenar pasos que dependen del resultado del paso anterior,
  // todo o nada igual que el resto del sistema.
  const cajas = await prisma.$transaction(async (tx) => {
    const creadas = [];
    for (const pesoKg of pesosPorCaja) {
      const caja = await tx.cajaCamara.create({
        data: {
          productoId,
          familiaNombre: familia.nombre,
          pesoInicialKg: pesoKg,
          saldoKg: pesoKg,
          costoNetoKg,
          pesoEstimado,
          creadoPorId: usuarioId,
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
  });

  res.status(201).json(cajas);
});

camaraRouter.get("/cajas/:id", async (req, res) => {
  const caja = await prisma.cajaCamara.findUnique({
    where: { id: Number(req.params.id) },
    include: cajaConIncludes,
  });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  res.json(caja);
});

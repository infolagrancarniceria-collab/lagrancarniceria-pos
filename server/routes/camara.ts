import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { obtenerCategoriaRaiz } from "../lib/categorias";
import { rangoFechasDesdeTexto } from "./reportes";

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

// --- Salida de cajas (completa o parcial), con aviso FIFO ---

const ESTADOS_ACTIVOS = ["en_camara", "parcial"] as const;
// Media unidad de gramo, para no rechazar por ruido de punto flotante al
// comparar el peso que sale contra el saldo (ambos con precisión de gramo).
const EPSILON_KG = 0.0005;

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
    destino: z.enum(["sala_venta", "produccion", "merma", "donacion", "mayorista"]),
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
  })
  .refine((data) => data.destino !== "mayorista" || data.mayorista != null, {
    message: "Faltan los datos de la venta por mayor (precio)",
    path: ["mayorista"],
  });

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
  const { destino, pesoKg: pesoSolicitado, motivo, usuarioId, dispositivo, version, mayorista } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const cajaId = Number(req.params.id);
  const caja = await prisma.cajaCamara.findUnique({ where: { id: cajaId } });
  if (!caja) return res.status(404).json({ error: "Caja no encontrada" });
  if (caja.estado === "salida") {
    return res.status(400).json({ error: "Esta caja ya salió completa de cámara" });
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
        include: { producto: true, usuario: true },
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
        claveIdempotencia: randomUUID(),
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
    include: { producto: true, usuario: true },
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

  const actualizada = await prisma.salidaMayorista.update({
    where: { id: salida.id },
    data: { estadoPago: parsed.data.estadoPago },
    include: { producto: true, usuario: true },
  });
  res.json(actualizada);
});

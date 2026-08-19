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

camaraRouter.get("/cajas", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const cajas = await prisma.cajaCamara.findMany({
    where: estado ? { estado } : undefined,
    include: cajaConIncludes,
    orderBy: { fechaIngreso: "asc" },
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
});

camaraRouter.post("/cajas/:id/confirmar-falta", async (req, res) => {
  const parsed = resolverAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

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
        claveIdempotencia: randomUUID(),
      },
    });
    return { caja: cajaActualizada, movimiento };
  });

  res.json(resultado);
});

camaraRouter.post("/cajas/:id/encontrada", async (req, res) => {
  const parsed = resolverAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { usuarioId, motivo } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

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
        claveIdempotencia: randomUUID(),
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

camaraRouter.post("/importar-prototipo/previsualizar", async (req, res) => {
  const resultado = parsearJsonPrototipo(req.body?.json);
  if (!resultado.ok) return res.status(400).json({ error: resultado.error });
  const cajasPrototipo = resultado.cajas;

  const idsNumericos = cajasPrototipo.map((c) => Number(c.id)).filter((n) => Number.isInteger(n));
  const existentes = idsNumericos.length
    ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNumericos } }, select: { id: true } })
    : [];
  const cajasConConflicto = existentes.map((c) => c.id);

  // Agrupar por producto+familia — se pide UNA sola confirmación de mapeo
  // por grupo, no una por cada caja individual (puede haber decenas de
  // cajas del mismo corte).
  const productosActivos = await prisma.producto.findMany({ where: { activo: true } });
  const porDescripcion = new Map(productosActivos.map((p) => [p.descripcion.trim().toLowerCase(), p]));

  const grupos = new Map<
    string,
    { clave: string; familia: string; producto: string; cantidadCajas: number; productoIdSugerido: number | null; productoSugerido: string | null }
  >();
  for (const c of cajasPrototipo) {
    const clave = claveGrupoPrototipo(c.familia, c.producto);
    if (!grupos.has(clave)) {
      const match = porDescripcion.get(c.producto.trim().toLowerCase());
      grupos.set(clave, {
        clave,
        familia: c.familia,
        producto: c.producto,
        cantidadCajas: 0,
        productoIdSugerido: match ? match.id : null,
        productoSugerido: match ? match.descripcion : null,
      });
    }
    grupos.get(clave)!.cantidadCajas++;
  }

  res.json({
    totalCajas: cajasPrototipo.length,
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

  const resultado = parsearJsonPrototipo(parsed.data.json);
  if (!resultado.ok) return res.status(400).json({ error: resultado.error });
  const cajasPrototipo = resultado.cajas;

  const mapaProducto = new Map(mapeo.map((m) => [m.clave, m.productoId]));

  const idsNumericos = cajasPrototipo.map((c) => Number(c.id)).filter((n) => Number.isInteger(n));
  const existentes = idsNumericos.length
    ? await prisma.cajaCamara.findMany({ where: { id: { in: idsNumericos } }, select: { id: true } })
    : [];
  const idsConflicto = new Set(existentes.map((c) => c.id));

  let importadas = 0;
  const omitidasPorConflicto: number[] = [];
  const omitidasPorProducto: number[] = [];

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

  res.json({ importadas, omitidasPorConflicto, omitidasPorProducto });
});

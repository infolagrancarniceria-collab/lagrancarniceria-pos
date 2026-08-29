import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { verificarClaveConLimite } from "../lib/clave";
import { traerPedidosWebPendientes } from "../lib/syncWeb";

type ProductoConCombo = Prisma.ProductoGetPayload<{ include: { componentesDelCombo: true } }>;

export const pedidosWebRouter = Router();

const ESTADOS = ["pendiente", "atendido", "anulado"] as const;

async function validarUsuario(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

const CON_RELACIONES = {
  regalos: { include: { producto: true, agregadoPor: true } },
  ventaGenerada: { select: { id: true } },
} satisfies Prisma.PedidoWebInclude;

type PedidoWebCompleto = Prisma.PedidoWebGetPayload<{ include: typeof CON_RELACIONES }>;

function serializar(p: PedidoWebCompleto) {
  const { itemsJson, ventaGenerada, ...resto } = p;
  let items: unknown = [];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    items = [];
  }
  return { ...resto, items, ventaGeneradaId: ventaGenerada?.id ?? null };
}

pedidosWebRouter.get("/", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  if (estado && !ESTADOS.includes(estado as (typeof ESTADOS)[number])) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  const pedidos = await prisma.pedidoWeb.findMany({
    where: estado ? { estado } : undefined,
    orderBy: { fecha: "desc" },
    include: CON_RELACIONES,
  });
  res.json(pedidos.map(serializar));
});

// Fuerza un ciclo de sincronización con la web ahora mismo, en vez de
// esperar al próximo automático (cada 5 minutos, ver iniciarSyncWeb) — para
// el botón "Actualizar" de la pantalla, así el equipo no tiene que cerrar y
// volver a abrir el programa entero (que sí fuerza un ciclo, al arrancar)
// solo para ver un pedido recién llegado.
pedidosWebRouter.post("/sincronizar", async (_req, res) => {
  const nuevos = await traerPedidosWebPendientes();
  res.json({ nuevos });
});

const atenderSchema = z.object({ usuarioId: z.number().int().positive() });

pedidosWebRouter.put("/:id/atender", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = atenderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.pedidoWeb.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Pedido no encontrado" });

  const usuario = await prisma.usuario.findUnique({ where: { id: parsed.data.usuarioId } });
  if (!usuario || !usuario.activo) return res.status(400).json({ error: "Usuario inválido" });

  const pedido = await prisma.pedidoWeb.update({
    where: { id },
    data: { estado: "atendido", atendidoPorId: parsed.data.usuarioId, atendidoEn: new Date() },
    include: CON_RELACIONES,
  });
  res.json(serializar(pedido));
});

// Anular un pedido web (el cliente canceló, pedido duplicado, no contesta,
// etc.) pide clave de supervisor — mismo nivel de control que anular una
// venta ya pagada (ver POST /api/caja/ventas/:id/cancelar), aunque acá no
// haya stock ni dinero que devolver: es una decisión explícita del negocio,
// no solo un trámite como marcar "atendido".
const anularSchema = z.object({
  usuarioId: z.number().int().positive(),
  clave: z.string().trim().min(1, "Falta la clave de supervisor"),
  motivo: z.string().trim().min(1, "Falta el motivo de la anulación"),
});

pedidosWebRouter.put("/:id/anular", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = anularSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, clave, motivo } = parsed.data;

  const existente = await prisma.pedidoWeb.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Pedido no encontrado" });
  if (existente.estado === "anulado") return res.status(400).json({ error: "Este pedido ya estaba anulado" });

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const claveSupervisor = await prisma.claveSupervisor.findFirst();
  if (!claveSupervisor) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }
  const resultadoClave = verificarClaveConLimite(req.ip ?? "desconocido", clave, claveSupervisor.hashClave);
  if (resultadoClave.bloqueado) {
    return res
      .status(429)
      .json({ error: `Demasiados intentos fallidos — espera ${resultadoClave.segundosRestantes} segundos e intenta de nuevo` });
  }
  if (!resultadoClave.valida) {
    return res.status(403).json({ error: "Clave de supervisor incorrecta" });
  }

  const pedido = await prisma.pedidoWeb.update({
    where: { id },
    data: { estado: "anulado", motivoAnulacion: motivo, anuladoPorId: usuarioId, anuladoEn: new Date() },
    include: CON_RELACIONES,
  });
  res.json(serializar(pedido));
});

// Descuento/promoción informativa sobre el pedido — no hay pasarela de pago
// ni venta real acá (ver comentario de descuentoTipo en el schema), así que
// no requiere clave de supervisor, solo queda visible para quien cobre en
// Caja. Se pasa null en descuentoTipo/descuentoValor para quitar un
// descuento ya aplicado.
const descuentoSchema = z.object({
  usuarioId: z.number().int().positive(),
  descuentoTipo: z.enum(["porcentaje", "monto"]).nullable(),
  descuentoValor: z.number().nonnegative().nullable(),
  descuentoMotivo: z.string().trim().max(200).nullable(),
});

pedidosWebRouter.put("/:id/descuento", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = descuentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, descuentoTipo, descuentoValor, descuentoMotivo } = parsed.data;
  if (descuentoTipo && descuentoValor == null) {
    return res.status(400).json({ error: "Falta el valor del descuento" });
  }

  const existente = await prisma.pedidoWeb.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Pedido no encontrado" });

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const pedido = await prisma.pedidoWeb.update({
    where: { id },
    data: { descuentoTipo, descuentoValor, descuentoMotivo: descuentoTipo ? descuentoMotivo : null },
    include: CON_RELACIONES,
  });
  res.json(serializar(pedido));
});

// --- Regalos (ej. longaniza o hamburguesas de cortesía) ---
//
// A diferencia de itemsJson (lo que pidió y paga el cliente), un regalo es
// un producto real del catálogo que el equipo decide incluir sin costo — no
// suma al total del pedido, pero sí es una merma real: descuenta stock y
// queda un MovimientoInventario igual que cualquier salida, para que quede
// reflejado en Inventario aunque el pedido nunca se cobre en Caja.

const agregarRegaloSchema = z.object({
  usuarioId: z.number().int().positive(),
  productoId: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});

pedidosWebRouter.post("/:id/regalos", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = agregarRegaloSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId, productoId, cantidad } = parsed.data;

  const pedido = await prisma.pedidoWeb.findUnique({ where: { id } });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  if (pedido.estado === "anulado") return res.status(400).json({ error: "Este pedido está anulado" });

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const producto = await prisma.producto.findUnique({ where: { id: productoId } });
  if (!producto) return res.status(404).json({ error: "Producto no encontrado" });

  // No se bloquea por falta de stock — mismo criterio que el resto de
  // Inventario (ver inventario.ts): puede quedar negativo y se corrige
  // después con un ajuste manual.
  await prisma.$transaction([
    prisma.pedidoWebRegalo.create({
      data: { pedidoWebId: id, productoId, cantidad, agregadoPorId: usuarioId },
    }),
    prisma.producto.update({ where: { id: productoId }, data: { stockActual: { decrement: cantidad } } }),
    prisma.movimientoInventario.create({
      data: { productoId, usuarioId, tipo: "salida", motivo: "regalo_pedido_web", cantidad },
    }),
  ]);

  const pedidoActualizado = await prisma.pedidoWeb.findUnique({ where: { id }, include: CON_RELACIONES });
  res.status(201).json(serializar(pedidoActualizado!));
});

const quitarRegaloSchema = z.object({ usuarioId: z.number().int().positive() });

pedidosWebRouter.delete("/:id/regalos/:regaloId", async (req, res) => {
  const id = Number(req.params.id);
  const regaloId = Number(req.params.regaloId);
  const parsed = quitarRegaloSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const usuario = await validarUsuario(parsed.data.usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const regalo = await prisma.pedidoWebRegalo.findUnique({ where: { id: regaloId } });
  if (!regalo || regalo.pedidoWebId !== id) return res.status(404).json({ error: "Regalo no encontrado" });

  // Repone el stock que se había descontado al agregarlo, con su propio
  // movimiento de entrada — nunca se edita el movimiento original, para
  // dejar el rastro completo (se agregó y se corrigió), igual que anular
  // una venta le devuelve el stock a los productos vendidos.
  await prisma.$transaction([
    prisma.pedidoWebRegalo.delete({ where: { id: regaloId } }),
    prisma.producto.update({ where: { id: regalo.productoId }, data: { stockActual: { increment: regalo.cantidad } } }),
    prisma.movimientoInventario.create({
      data: {
        productoId: regalo.productoId,
        usuarioId: parsed.data.usuarioId,
        tipo: "entrada",
        motivo: "regalo_revertido",
        cantidad: regalo.cantidad,
      },
    }),
  ]);

  const pedidoActualizado = await prisma.pedidoWeb.findUnique({ where: { id }, include: CON_RELACIONES });
  res.json(serializar(pedidoActualizado!));
});

// --- Enviar a Caja como venta a crédito ---
//
// El equipo suele recibir el pago (transferencia, efectivo o tarjeta) recién
// cuando el cliente retira o recibe el pedido, no al cotizar por la web —
// mismo caso que una venta fiada. Por eso esto no cobra nada acá: arma la
// venta completa (con los productos reales del catálogo, a precio actual) y
// la deja pagada con un pago "credito" sin cobrar, para que aparezca en
// Créditos pendientes y el equipo lo cobre ahí cuando corresponda (ver
// GET/POST /api/caja/creditos-pendientes). Los regalos NO se agregan como
// ítems acá — ya descontaron su stock al agregarse (ver POST .../regalos),
// volver a incluirlos duplicaría la merma.
interface ItemPedidoWebCrudo {
  plu: string;
  cantidad: number;
  unidad: string;
}

const enviarACajaSchema = z.object({ usuarioId: z.number().int().positive() });

pedidosWebRouter.post("/:id/enviar-a-caja", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = enviarACajaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { usuarioId } = parsed.data;

  const usuario = await validarUsuario(usuarioId);
  if (!usuario) return res.status(400).json({ error: "Usuario inválido" });

  const pedido = await prisma.pedidoWeb.findUnique({ where: { id }, include: { ventaGenerada: true } });
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  if (pedido.estado === "anulado") return res.status(400).json({ error: "Este pedido está anulado" });
  if (pedido.ventaGenerada) {
    return res.status(400).json({ error: `Este pedido ya se envió a Caja (venta #${pedido.ventaGenerada.id})` });
  }

  const sesion = await prisma.sesionCaja.findFirst({ where: { estado: "abierta" } });
  if (!sesion) return res.status(400).json({ error: "No hay una caja abierta — ábrela primero" });

  let itemsCrudos: ItemPedidoWebCrudo[];
  try {
    itemsCrudos = JSON.parse(pedido.itemsJson);
  } catch {
    return res.status(500).json({ error: "El detalle del pedido está dañado" });
  }
  if (itemsCrudos.length === 0) return res.status(400).json({ error: "El pedido no tiene productos" });

  // Se matchea por PLU al catálogo real — el precio se toma actual (Punto
  // de Venta nunca usa un precio congelado), no el que el cliente vio al
  // cotizar, que puede haber cambiado desde entonces.
  const plusFaltantes: string[] = [];
  const itemsConProducto: { producto: ProductoConCombo; cantidad: number }[] = [];
  for (const item of itemsCrudos) {
    const producto = await prisma.producto.findUnique({
      where: { plu: item.plu },
      include: { componentesDelCombo: true },
    });
    if (!producto) {
      plusFaltantes.push(item.plu);
      continue;
    }
    const cantidadVenta = item.unidad === "kg" ? item.cantidad / 1000 : item.cantidad;
    itemsConProducto.push({ producto, cantidad: cantidadVenta });
  }
  if (plusFaltantes.length > 0) {
    return res.status(400).json({
      error: `No se encontró en el catálogo el producto con PLU ${plusFaltantes.join(", ")} — revisa que siga existiendo antes de enviar a Caja`,
    });
  }

  // Un combo no tiene stock propio — al venderse, se descuenta el de sus
  // componentes (cantidad de la receta × cuántos combos se vendieron), no
  // el del combo mismo. Se suma todo en un solo mapa (combos y productos
  // normales juntos) para que, si un mismo producto aparece tanto suelto
  // como dentro de un combo en el mismo pedido, quede un solo movimiento de
  // inventario con el total — mismo criterio que ya usa confirmarVenta en
  // caja.ts para no duplicar movimientos del mismo producto.
  const decrementosPorProducto = new Map<number, number>();
  for (const { producto, cantidad } of itemsConProducto) {
    if (producto.esCombo) {
      for (const componente of producto.componentesDelCombo) {
        const actual = decrementosPorProducto.get(componente.componenteProductoId) ?? 0;
        decrementosPorProducto.set(componente.componenteProductoId, actual + componente.cantidad * cantidad);
      }
    } else {
      const actual = decrementosPorProducto.get(producto.id) ?? 0;
      decrementosPorProducto.set(producto.id, actual + cantidad);
    }
  }

  let comunaId: number | null = null;
  if (pedido.tipoEntrega === "despacho" && pedido.comunaNombre) {
    const comuna = await prisma.comuna.findUnique({ where: { nombre: pedido.comunaNombre } });
    if (!comuna) return res.status(400).json({ error: `No se encontró la comuna "${pedido.comunaNombre}" en el catálogo` });
    comunaId = comuna.id;
  }

  const subtotalItems = itemsConProducto.reduce((suma, i) => suma + Math.round(i.producto.precio * i.cantidad), 0);
  let descuentoMonto = 0;
  if (pedido.descuentoTipo === "porcentaje" && pedido.descuentoValor) {
    descuentoMonto = Math.round(subtotalItems * (pedido.descuentoValor / 100));
  } else if (pedido.descuentoTipo === "monto" && pedido.descuentoValor) {
    descuentoMonto = pedido.descuentoValor;
  }
  descuentoMonto = Math.min(descuentoMonto, subtotalItems);
  const costoEnvio = pedido.tipoEntrega === "despacho" ? (pedido.costoEnvio ?? 0) : 0;
  const total = subtotalItems - descuentoMonto + costoEnvio;

  const [venta] = await prisma.$transaction([
    prisma.venta.create({
      data: {
        sesionCajaId: sesion.id,
        usuarioId,
        estado: "pagada",
        total,
        comentario: pedido.comentario,
        esDespacho: pedido.tipoEntrega === "despacho",
        comunaId,
        costoEnvio: pedido.tipoEntrega === "despacho" ? pedido.costoEnvio : null,
        descuentoTipo: pedido.descuentoTipo === "monto" ? "monto_fijo" : pedido.descuentoTipo,
        descuentoValor: pedido.descuentoValor,
        origenPedidoWebId: pedido.id,
        items: {
          create: itemsConProducto.map((i) => ({
            productoId: i.producto.id,
            cantidad: i.cantidad,
            precioUnitario: i.producto.precio,
            subtotal: Math.round(i.producto.precio * i.cantidad),
          })),
        },
        pagos: {
          create: { medio: "credito", monto: total, clienteNombre: pedido.clienteNombre },
        },
      },
    }),
    ...Array.from(decrementosPorProducto.entries()).flatMap(([productoId, cantidad]) => [
      prisma.producto.update({ where: { id: productoId }, data: { stockActual: { decrement: cantidad } } }),
      prisma.movimientoInventario.create({
        data: { productoId, usuarioId, tipo: "salida", motivo: "venta", cantidad },
      }),
    ]),
    prisma.pedidoWeb.update({
      where: { id },
      data: { estado: "atendido", atendidoPorId: usuarioId, atendidoEn: new Date() },
    }),
  ]);

  const pedidoActualizado = await prisma.pedidoWeb.findUnique({ where: { id }, include: CON_RELACIONES });
  res.status(201).json({ pedido: serializar(pedidoActualizado!), ventaId: venta.id });
});

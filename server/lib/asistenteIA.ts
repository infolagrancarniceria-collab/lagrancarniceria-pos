import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db";
import { rangoFechasDesdeTexto } from "../routes/reportes";

// Herramientas de solo lectura: el asistente las ejecuta directo, nunca
// cambian datos. Las herramientas "proponer_*" son distintas a propósito:
// el asistente NUNCA las ejecuta — solo arma la propuesta y la persona la
// confirma desde la pantalla, usando el mismo endpoint que usaría a mano.
const HERRAMIENTAS_PROPONER = new Set([
  "proponer_cambio_precio",
  "proponer_cambio_precio_masivo_categoria",
  "proponer_crear_categoria",
  "proponer_entrada_inventario",
  "proponer_salida_inventario",
]);

const herramientas: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca productos del catálogo por texto (PLU, nombre o marca). Sin texto, devuelve los primeros productos activos. Usar esto antes de proponer cualquier cambio sobre un producto, para tener su id y sus datos actuales.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string", description: "Texto a buscar (opcional)" } },
    },
  },
  {
    name: "listar_categorias",
    description: "Lista todas las categorías de productos, con su código, nivel y categoría padre.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_proveedores",
    description: "Lista los proveedores activos.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "reporte_inventario",
    description:
      "Entradas y salidas de inventario (por motivo) y los productos con más merma, en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD (opcional, por defecto hace 30 días)" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD (opcional, por defecto hoy)" },
      },
    },
  },
  {
    name: "reporte_precios",
    description: "Cambios de precio realizados y las mayores variaciones, en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD" },
      },
    },
  },
  {
    name: "reporte_ventas",
    description:
      "Ventas confirmadas en un rango de fechas: total vendido, cantidad de ventas, y los productos más vendidos por cantidad e ingreso.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD" },
      },
    },
  },
  {
    name: "proponer_cambio_precio",
    description:
      "Propone cambiar el precio de UN producto. No cambia nada todavía — la persona tiene que confirmarlo en pantalla. Usar buscar_productos primero para tener el productoId y el precio actual.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer" },
        precioNuevo: { type: "number", description: "Precio nuevo en pesos chilenos, mayor a 0" },
        resumen: {
          type: "string",
          description:
            "Frase corta en español describiendo el cambio para mostrarle a la persona, ej: 'Cambiar el precio de Trutro de pollo de $3.500 a $3.680'",
        },
      },
      required: ["productoId", "precioNuevo", "resumen"],
    },
  },
  {
    name: "proponer_cambio_precio_masivo_categoria",
    description:
      "Propone cambiar el precio de todos los productos de una categoría (y sus subcategorías), por porcentaje o monto fijo. No cambia nada todavía.",
    input_schema: {
      type: "object",
      properties: {
        categoriaId: { type: "integer" },
        tipo: { type: "string", enum: ["porcentaje", "monto_fijo"] },
        valor: { type: "number", description: "Positivo para subir, negativo para bajar" },
        resumen: { type: "string" },
      },
      required: ["categoriaId", "tipo", "valor", "resumen"],
    },
  },
  {
    name: "proponer_crear_categoria",
    description: "Propone crear una categoría nueva. No la crea todavía.",
    input_schema: {
      type: "object",
      properties: {
        codigo: { type: "string" },
        nombre: { type: "string" },
        nivel: { type: "integer", enum: [1, 2, 3] },
        padreId: { type: "integer", description: "Obligatorio si nivel es 2 o 3" },
        resumen: { type: "string" },
      },
      required: ["codigo", "nombre", "nivel", "resumen"],
    },
  },
  {
    name: "proponer_entrada_inventario",
    description:
      "Propone registrar una entrada de mercadería (compra a proveedor, o ajuste positivo por conteo físico). No la registra todavía.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer" },
        cantidad: { type: "number" },
        motivo: { type: "string", enum: ["compra", "ajuste"] },
        proveedorId: { type: "integer", description: "Opcional, solo aplica si motivo es compra" },
        costoUnitario: { type: "number", description: "Opcional, solo aplica si motivo es compra" },
        resumen: { type: "string" },
      },
      required: ["productoId", "cantidad", "motivo", "resumen"],
    },
  },
  {
    name: "proponer_salida_inventario",
    description:
      "Propone registrar una salida de inventario por descarte/merma o ajuste negativo. No la registra todavía. No usar esto para ventas — las ventas se hacen desde el módulo de caja, no desde acá.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer" },
        cantidad: { type: "number" },
        motivo: { type: "string", enum: ["descarte", "ajuste"] },
        resumen: { type: "string" },
      },
      required: ["productoId", "cantidad", "motivo", "resumen"],
    },
  },
];

async function ejecutarHerramientaLectura(nombre: string, input: Record<string, unknown>): Promise<unknown> {
  switch (nombre) {
    case "buscar_productos": {
      const texto = typeof input.texto === "string" ? input.texto.trim() : "";
      const productos = await prisma.producto.findMany({
        where: {
          activo: true,
          ...(texto
            ? {
                OR: [
                  { plu: { contains: texto } },
                  { descripcion: { contains: texto } },
                  { marca: { contains: texto } },
                ],
              }
            : {}),
        },
        include: { categoria: true },
        take: 20,
      });
      return productos.map((p) => ({
        id: p.id,
        plu: p.plu,
        descripcion: p.descripcion,
        precio: p.precio,
        categoria: p.categoria.nombre,
        stockActual: p.stockActual,
        flagBalanza: p.flagBalanza,
      }));
    }
    case "listar_categorias": {
      const categorias = await prisma.categoria.findMany({ orderBy: { codigo: "asc" } });
      return categorias.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, nivel: c.nivel, padreId: c.padreId }));
    }
    case "listar_proveedores": {
      const proveedores = await prisma.proveedor.findMany({ where: { activo: true } });
      return proveedores.map((p) => ({ id: p.id, nombre: p.nombre }));
    }
    case "reporte_inventario": {
      const { desde, hasta } = rangoFechasDesdeTexto(input.desde, input.hasta);
      const movimientos = await prisma.movimientoInventario.findMany({
        where: { fecha: { gte: desde, lte: hasta } },
        include: { producto: true },
      });
      const entradasTotal = movimientos.filter((m) => m.tipo === "entrada").reduce((s, m) => s + m.cantidad, 0);
      const salidasPorMotivo: Record<string, number> = { venta: 0, descarte: 0, ajuste: 0 };
      for (const m of movimientos) {
        if (m.tipo === "salida") salidasPorMotivo[m.motivo] = (salidasPorMotivo[m.motivo] ?? 0) + m.cantidad;
      }
      const mermaPorProducto = new Map<number, { descripcion: string; cantidad: number }>();
      for (const m of movimientos) {
        if (m.tipo === "salida" && m.motivo === "descarte") {
          const actual = mermaPorProducto.get(m.productoId) ?? { descripcion: m.producto.descripcion, cantidad: 0 };
          actual.cantidad += m.cantidad;
          mermaPorProducto.set(m.productoId, actual);
        }
      }
      const topMerma = Array.from(mermaPorProducto.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
      return { desde: desde.toISOString(), hasta: hasta.toISOString(), entradasTotal, salidasPorMotivo, topMerma };
    }
    case "reporte_precios": {
      const { desde, hasta } = rangoFechasDesdeTexto(input.desde, input.hasta);
      const cambios = await prisma.historialPrecio.findMany({
        where: { fecha: { gte: desde, lte: hasta } },
        include: { producto: true },
      });
      const mayoresCambios = cambios
        .map((c) => ({
          descripcion: c.producto.descripcion,
          precioAnterior: c.precioAnterior,
          precioNuevo: c.precioNuevo,
          variacionPorcentual: c.precioAnterior > 0 ? ((c.precioNuevo - c.precioAnterior) / c.precioAnterior) * 100 : 0,
        }))
        .sort((a, b) => Math.abs(b.variacionPorcentual) - Math.abs(a.variacionPorcentual))
        .slice(0, 10);
      return { desde: desde.toISOString(), hasta: hasta.toISOString(), totalCambios: cambios.length, mayoresCambios };
    }
    case "reporte_ventas": {
      const { desde, hasta } = rangoFechasDesdeTexto(input.desde, input.hasta);
      const items = await prisma.itemVenta.findMany({
        where: { anulado: false, venta: { estado: "pagada", fecha: { gte: desde, lte: hasta } } },
        include: { producto: true },
      });
      const ventasEnRango = await prisma.venta.findMany({
        where: { estado: "pagada", fecha: { gte: desde, lte: hasta } },
      });
      const totalVentas = ventasEnRango.reduce((s, v) => s + v.total, 0);
      const porProducto = new Map<number, { descripcion: string; cantidad: number; ingreso: number }>();
      for (const i of items) {
        const actual = porProducto.get(i.productoId) ?? { descripcion: i.producto.descripcion, cantidad: 0, ingreso: 0 };
        actual.cantidad += i.cantidad;
        actual.ingreso += i.subtotal;
        porProducto.set(i.productoId, actual);
      }
      const masVendidosPorCantidad = Array.from(porProducto.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
      const masVendidosPorIngreso = Array.from(porProducto.values()).sort((a, b) => b.ingreso - a.ingreso).slice(0, 10);
      return {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        cantidadVentas: ventasEnRango.length,
        totalVentas,
        masVendidosPorCantidad,
        masVendidosPorIngreso,
      };
    }
    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

export interface MensajeHistorial {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlockParam[];
}

export type RespuestaAsistente =
  | { tipo: "respuesta"; texto: string; historial: MensajeHistorial[] }
  | { tipo: "propuesta"; descripcion: string; accion: { tipo: string; datos: Record<string, unknown> }; historial: MensajeHistorial[] };

const SYSTEM_PROMPT = `Eres el asistente del sistema de punto de venta de "La Gran Carnicería". Respondes en español de Chile, simple y directo.

Reglas:
- Los precios son pesos chilenos (CLP), sin decimales.
- Antes de responder preguntas sobre productos, categorías, inventario, precios o ventas, usa las herramientas de consulta — nunca inventes datos ni respondas de memoria.
- Si la persona pide un cambio (precio, categoría, inventario), usa la herramienta "proponer_*" correspondiente. Nunca digas que ya hiciste el cambio: solo se aplica si la persona lo confirma en pantalla después.
- Llama como máximo una herramienta "proponer_*" por pedido. Si falta información para proponer el cambio (ej. no sabes a qué producto se refiere), pregunta primero en vez de adivinar.
- Sé breve. No hace falta repetir toda la data cruda de una consulta, resume lo relevante.`;

export async function procesarMensaje(
  apiKey: string,
  mensajeUsuario: string,
  historialPrevio: MensajeHistorial[]
): Promise<RespuestaAsistente> {
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...(historialPrevio as Anthropic.MessageParam[]),
    { role: "user", content: mensajeUsuario },
  ];

  const MAX_VUELTAS = 6;
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const respuesta = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: herramientas,
      messages,
    });

    const bloquesHerramienta = respuesta.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const bloquePropuesta = bloquesHerramienta.find((b) => HERRAMIENTAS_PROPONER.has(b.name));
    if (bloquePropuesta) {
      const { resumen, ...datos } = bloquePropuesta.input as Record<string, unknown> & { resumen: string };
      return {
        tipo: "propuesta",
        descripcion: resumen,
        accion: { tipo: bloquePropuesta.name, datos },
        historial: [...historialPrevio, { role: "user", content: mensajeUsuario }],
      };
    }

    if (respuesta.stop_reason !== "tool_use" || bloquesHerramienta.length === 0) {
      const texto = respuesta.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        tipo: "respuesta",
        texto: texto || "No tengo una respuesta para eso.",
        historial: [
          ...historialPrevio,
          { role: "user", content: mensajeUsuario },
          { role: "assistant", content: respuesta.content },
        ],
      };
    }

    messages.push({ role: "assistant", content: respuesta.content });
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloque of bloquesHerramienta) {
      const resultado = await ejecutarHerramientaLectura(bloque.name, bloque.input as Record<string, unknown>);
      resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(resultado) });
    }
    messages.push({ role: "user", content: resultados });
  }

  return {
    tipo: "respuesta",
    texto: "No pude terminar de procesar el pedido — intenta reformularlo más simple.",
    historial: [...historialPrevio, { role: "user", content: mensajeUsuario }],
  };
}

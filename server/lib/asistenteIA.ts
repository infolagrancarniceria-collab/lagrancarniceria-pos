import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db";
import { rangoFechasDesdeTexto, calcularReporteVentas } from "../routes/reportes";

// Herramientas de solo lectura: el asistente las ejecuta directo, nunca
// cambian datos. Las herramientas "proponer_*" son distintas a propósito:
// el asistente NUNCA las ejecuta — solo arma la propuesta y la persona la
// confirma desde la pantalla, usando el mismo endpoint que usaría a mano.
const HERRAMIENTAS_PROPONER = new Set([
  "proponer_cambio_precio",
  "proponer_cambio_precio_masivo_categoria",
  "proponer_cambios_precio_masivos",
  "proponer_crear_categoria",
  "proponer_categorizar_masivo",
  "proponer_entrada_inventario",
  "proponer_entradas_inventario_masivas",
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
    name: "proponer_categorizar_masivo",
    description:
      "Propone asignar la MISMA categoría a varios productos a la vez (ej. ordenar productos que quedaron 'Sin categorizar'). No cambia nada todavía. Usa buscar_productos y listar_categorias primero para tener los ids exactos — nunca adivines un productoId o categoriaId.",
    input_schema: {
      type: "object",
      properties: {
        categoriaId: { type: "integer" },
        categoriaNombre: { type: "string", description: "Nombre de la categoría destino, para mostrarlo en la revisión" },
        items: {
          type: "array",
          description: "Productos a los que se les asignará la categoría",
          items: {
            type: "object",
            properties: {
              productoId: { type: "integer" },
              descripcion: { type: "string", description: "Nombre del producto, para mostrarlo en la revisión" },
            },
            required: ["productoId", "descripcion"],
          },
        },
        resumen: { type: "string" },
      },
      required: ["categoriaId", "categoriaNombre", "items", "resumen"],
    },
  },
  {
    name: "proponer_cambios_precio_masivos",
    description:
      "Propone cambiar el precio de varios productos DISTINTOS a la vez, cada uno con su propio precio nuevo (a diferencia de proponer_cambio_precio_masivo_categoria, que aplica el mismo % o monto fijo a toda una categoría). Útil cuando la persona pega una lista de precios nuevos. No cambia nada todavía. Usa buscar_productos primero para tener el productoId y precio actual de cada uno — si no encuentras un producto con confianza (nombre ambiguo o no existe), pregunta antes de proponer nada.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              productoId: { type: "integer" },
              descripcion: { type: "string", description: "Nombre del producto, para mostrarlo en la revisión" },
              precioActual: { type: "number" },
              precioNuevo: { type: "number" },
            },
            required: ["productoId", "descripcion", "precioNuevo"],
          },
        },
        resumen: { type: "string" },
      },
      required: ["items", "resumen"],
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
    name: "proponer_entradas_inventario_masivas",
    description:
      "Propone registrar varias entradas de mercadería a la vez (ej. todas las líneas de la factura de un proveedor que la persona pegó en el chat). No registra nada todavía. Para cada línea, usa buscar_productos para encontrar el productoId — si un producto de la factura no aparece con un match claro y único, NO lo incluyas ni adivines: pregunta a la persona qué producto es antes de proponer el resto.",
    input_schema: {
      type: "object",
      properties: {
        proveedorId: { type: "integer", description: "Opcional — usa listar_proveedores para encontrarlo" },
        numeroFactura: { type: "string", description: "Opcional" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              productoId: { type: "integer" },
              descripcion: { type: "string", description: "Nombre del producto, para mostrarlo en la revisión" },
              cantidad: { type: "number" },
              costoUnitario: { type: "number", description: "Opcional, costo unitario de esta línea" },
            },
            required: ["productoId", "descripcion", "cantidad"],
          },
        },
        resumen: { type: "string" },
      },
      required: ["items", "resumen"],
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
        take: 40,
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
    case "reporte_ventas":
      return calcularReporteVentas(input.desde, input.hasta);
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
- Llama como máximo una herramienta "proponer_*" por pedido — pero esa herramienta puede ser una de las masivas (proponer_entradas_inventario_masivas, proponer_categorizar_masivo, proponer_cambios_precio_masivos) para proponer varios cambios de una vez como un solo lote que la persona revisa y confirma junto.
- Si falta información para proponer el cambio (ej. no sabes a qué producto se refiere), pregunta primero en vez de adivinar.

Sobre pedidos con varias líneas (ej. la persona pega el texto de una factura, o pide categorizar/cambiar precio a una lista de productos):
- Identifica cada línea/producto por separado y usa buscar_productos para encontrar su productoId real — nunca inventes un id ni asumas cuál es sin buscarlo.
- Si el nombre de una línea no tiene un match único y claro en el catálogo (no aparece, o hay varios productos parecidos y no es obvio cuál es), NO lo incluyas en la propuesta ni elijas uno al azar: dile a la persona qué línea(s) no pudiste identificar con confianza y pregúntale a cuál producto corresponde, antes de proponer el resto.
- Arma la propuesta final (una sola llamada a la herramienta "proponer_*" masiva correspondiente) solo con las líneas que sí identificaste con confianza.
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

  // Más vueltas que antes porque una factura con varias líneas puede
  // necesitar varias idas y vueltas de búsqueda de productos antes de
  // armar la propuesta final.
  const MAX_VUELTAS = 12;
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const respuesta = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096, // más margen que antes: una propuesta masiva (ej. factura con varias líneas) puede ser larga
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

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db";
import { rangoFechasDesdeTexto, calcularReporteVentas, calcularReporteDespachos } from "../routes/reportes";
import { calcularReporteGastos } from "../routes/gastos";
import { calcularReporteAnulaciones } from "../routes/caja";

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
  "proponer_registrar_gasto",
  "proponer_marcar_credito_cobrado",
  "proponer_crear_proveedor",
  "proponer_crear_producto",
  "proponer_desactivar_producto",
  "proponer_crear_comuna",
  "proponer_entrada_camara",
  "proponer_salida_camara",
]);

export const herramientas: Anthropic.Tool[] = [
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
  {
    name: "consultar_venta",
    description: "Trae el detalle completo de una venta de Caja por su número (ej. 'Venta #22' → numeroVenta: 22): productos, pagos, total, estado, comuna de despacho si aplica.",
    input_schema: {
      type: "object",
      properties: { numeroVenta: { type: "integer" } },
      required: ["numeroVenta"],
    },
  },
  {
    name: "creditos_pendientes",
    description: "Lista los créditos (ventas fiadas) todavía sin cobrar, con el nombre del cliente y el monto. Usar esto ANTES de proponer_marcar_credito_cobrado, para tener el pagoId real.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "reporte_anulaciones",
    description: "Productos anulados y ventas canceladas/anuladas en un rango de fechas, con motivo y quién anuló.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD" },
      },
    },
  },
  {
    name: "reporte_despachos",
    description: "Despachos a domicilio en un rango de fechas: cantidad y costo de envío cobrado, desglosado por comuna.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD" },
      },
    },
  },
  {
    name: "reporte_gastos",
    description: "Gastos generales del negocio (sueldos, luz, agua, etc. — no incluye compra de mercadería) en un rango de fechas, con el total por categoría.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha de inicio, formato YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha de fin, formato YYYY-MM-DD" },
      },
    },
  },
  {
    name: "historial_precio_producto",
    description: "Todos los cambios de precio de UN producto puntual, del más reciente al más antiguo (a diferencia de reporte_precios, que es agregado por rango de fechas, no por producto). Usar buscar_productos primero para tener el productoId.",
    input_schema: {
      type: "object",
      properties: { productoId: { type: "integer" } },
      required: ["productoId"],
    },
  },
  {
    name: "productos_stock_negativo",
    description: "Lista los productos que quedaron con stock negativo (se vendieron sin que el sistema tuviera stock suficiente registrado) — pendientes de un ajuste manual.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "productos_sin_venta_reciente",
    description: "Lista productos activos que no han tenido ninguna venta confirmada en los últimos N días (útil para detectar productos estancados o que convendría liquidar).",
    input_schema: {
      type: "object",
      properties: {
        diasSinVenta: { type: "integer", description: "Cantidad de días hacia atrás a revisar (opcional, por defecto 30)" },
      },
    },
  },
  {
    name: "consultar_camara",
    description: "Lista las cajas activas (en cámara o con saldo parcial) en la cámara frigorífica, opcionalmente filtradas por producto. Trae el id, saldo y version de cada caja — necesario para proponer_salida_camara.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer", description: "Opcional, para filtrar por un producto puntual" },
      },
    },
  },
  {
    name: "ventas_mayoristas_pendientes",
    description: "Ventas por mayor (desde la cámara frigorífica) que todavía están pendientes de pago.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "proponer_registrar_gasto",
    description: "Propone registrar un gasto general del negocio (sueldos, luz, agua, arriendo, etc. — no mercadería, eso es entrada de inventario). No lo registra todavía.",
    input_schema: {
      type: "object",
      properties: {
        categoria: { type: "string" },
        monto: { type: "number", description: "Mayor a 0" },
        descripcion: { type: "string", description: "Opcional" },
        resumen: { type: "string" },
      },
      required: ["categoria", "monto", "resumen"],
    },
  },
  {
    name: "proponer_marcar_credito_cobrado",
    description: "Propone marcar un crédito (venta fiada) como cobrado. No lo marca todavía. Usar creditos_pendientes primero para tener el pagoId real — nunca adivinarlo.",
    input_schema: {
      type: "object",
      properties: {
        pagoId: { type: "integer" },
        medioCobro: { type: "string", enum: ["efectivo", "tarjeta"], description: "Con qué se cobró realmente" },
        resumen: { type: "string" },
      },
      required: ["pagoId", "medioCobro", "resumen"],
    },
  },
  {
    name: "proponer_crear_proveedor",
    description: "Propone crear un proveedor nuevo. No lo crea todavía.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        contacto: { type: "string", description: "Opcional" },
        resumen: { type: "string" },
      },
      required: ["nombre", "resumen"],
    },
  },
  {
    name: "proponer_crear_producto",
    description:
      "Propone crear un producto nuevo en el catálogo. No lo crea todavía. Usa buscar_productos primero para confirmar que el PLU no esté ya usado, y listar_categorias para tener el categoriaId — nunca inventes ninguno de los dos.",
    input_schema: {
      type: "object",
      properties: {
        plu: { type: "string", description: "Código PLU del producto, sin ceros a la izquierda" },
        descripcion: { type: "string" },
        categoriaId: { type: "integer" },
        precio: { type: "number", description: "Precio de venta en pesos chilenos, mayor a 0" },
        flagBalanza: {
          type: "string",
          enum: ["NORMAL", "PESABLE", "IMPORTE"],
          description: "NORMAL = se vende por unidad con código de barras propio; PESABLE/IMPORTE = va a la balanza",
        },
        marca: { type: "string", description: "Opcional" },
        codigoBarras: { type: "string", description: "Opcional — solo aplica si flagBalanza es NORMAL" },
        resumen: { type: "string" },
      },
      required: ["plu", "descripcion", "categoriaId", "precio", "flagBalanza", "resumen"],
    },
  },
  {
    name: "proponer_desactivar_producto",
    description: "Propone dar de baja (desactivar) un producto — no lo elimina del historial, solo deja de aparecer en el catálogo activo. No lo hace todavía. Usar buscar_productos primero para tener el productoId.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer" },
        resumen: { type: "string" },
      },
      required: ["productoId", "resumen"],
    },
  },
  {
    name: "proponer_crear_comuna",
    description: "Propone agregar una comuna nueva con su costo de envío fijo, para el módulo de despachos a domicilio. No la crea todavía.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        costoEnvio: { type: "number", description: "Costo de envío en pesos chilenos, 0 o más" },
        resumen: { type: "string" },
      },
      required: ["nombre", "costoEnvio", "resumen"],
    },
  },
  {
    name: "proponer_entrada_camara",
    description:
      "Propone registrar la entrada de un lote de cajas a la cámara frigorífica. No la registra todavía. Usar buscar_productos primero para tener el productoId. Si familia es 'Vacuno', procedencia es obligatoria (Nacional, Brasil o Paraguay); para las demás familias no se debe incluir.",
    input_schema: {
      type: "object",
      properties: {
        productoId: { type: "integer" },
        familia: { type: "string", enum: ["Vacuno", "Cerdo", "Pollo", "Otros"] },
        procedencia: { type: "string", enum: ["Nacional", "Brasil", "Paraguay"], description: "Obligatoria solo si familia es 'Vacuno'" },
        cantidadCajas: { type: "integer", description: "Cantidad de cajas del lote" },
        pesoTotalKg: { type: "number", description: "Peso total del lote — usar esto O pesoIndividualKg, nunca ambos" },
        pesoIndividualKg: { type: "number", description: "Peso de cada caja, si se pesó cada una por separado" },
        costoNetoKg: { type: "number" },
        resumen: { type: "string" },
      },
      required: ["productoId", "familia", "cantidadCajas", "costoNetoKg", "resumen"],
    },
  },
  {
    name: "proponer_salida_camara",
    description:
      "Propone sacar peso de UNA caja de la cámara frigorífica (completa o parcial) con destino a sala de venta, producción, merma, donación, venta por mayor u otro. No la registra todavía. Usar consultar_camara primero para tener el cajaId y su version exactos — nunca adivinarlos. Si el destino es 'mayorista', hay que incluir también los datos de esa venta.",
    input_schema: {
      type: "object",
      properties: {
        cajaId: { type: "integer" },
        version: { type: "integer", description: "La version de la caja, tal como la devolvió consultar_camara" },
        destino: { type: "string", enum: ["sala_venta", "produccion", "merma", "donacion", "mayorista", "otro"] },
        pesoKg: { type: "number", description: "Opcional — si no se indica, se saca el saldo completo de la caja" },
        motivo: { type: "string", description: "Opcional" },
        mayorista: {
          type: "object",
          description: "Obligatorio solo si destino es 'mayorista'",
          properties: {
            clienteNombre: { type: "string", description: "Opcional" },
            precioTotal: { type: "number" },
            estadoPago: { type: "string", enum: ["pagado", "pendiente"] },
          },
        },
        resumen: { type: "string" },
      },
      required: ["cajaId", "version", "destino", "resumen"],
    },
  },
];

export async function ejecutarHerramientaLectura(nombre: string, input: Record<string, unknown>): Promise<unknown> {
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
    case "consultar_venta": {
      const numeroVenta = Number(input.numeroVenta);
      const venta = await prisma.venta.findUnique({
        where: { id: numeroVenta },
        include: {
          items: { include: { producto: true } },
          pagos: true,
          usuario: true,
          comuna: true,
        },
      });
      if (!venta) return { error: `No existe la venta #${numeroVenta}` };
      return {
        numero: venta.id,
        fecha: venta.fecha.toISOString(),
        estado: venta.estado,
        total: venta.total,
        vendedor: venta.usuario.nombre,
        comentario: venta.comentario,
        esDespacho: venta.esDespacho,
        comuna: venta.comuna?.nombre ?? null,
        items: venta.items.map((it) => ({
          producto: it.producto.descripcion,
          cantidad: it.cantidad,
          subtotal: it.subtotal,
          anulado: it.anulado,
        })),
        pagos: venta.pagos.map((p) => ({ medio: p.medio, monto: p.monto, clienteNombre: p.clienteNombre })),
      };
    }
    case "creditos_pendientes": {
      const creditos = await prisma.pagoVenta.findMany({
        where: { medio: "credito", cobrado: false },
        include: { venta: true },
        orderBy: { venta: { fecha: "asc" } },
      });
      return creditos.map((c) => ({
        pagoId: c.id,
        cliente: c.clienteNombre,
        monto: c.monto,
        venta: c.ventaId,
        fecha: c.venta.fecha.toISOString(),
      }));
    }
    case "reporte_anulaciones": {
      const { items, ventas } = await calcularReporteAnulaciones(input.desde, input.hasta);
      return {
        productosAnulados: items.map((it) => ({
          venta: it.ventaId,
          producto: it.producto.descripcion,
          cantidad: it.cantidad,
          motivo: it.motivoAnulacion,
          quien: it.usuarioAnulacion?.nombre ?? null,
          fecha: it.fechaAnulacion?.toISOString() ?? null,
        })),
        ventasAnuladas: ventas.map((v) => ({
          venta: v.id,
          total: v.total,
          motivo: v.motivoAnulacion,
          quien: v.usuarioAnulacion?.nombre ?? null,
          fecha: v.fechaAnulacion?.toISOString() ?? null,
        })),
      };
    }
    case "reporte_despachos":
      return calcularReporteDespachos(input.desde, input.hasta);
    case "reporte_gastos":
      return calcularReporteGastos(input.desde, input.hasta);
    case "historial_precio_producto": {
      const productoId = Number(input.productoId);
      const cambios = await prisma.historialPrecio.findMany({
        where: { productoId },
        include: { usuario: true },
        orderBy: { fecha: "desc" },
      });
      return cambios.map((c) => ({
        fecha: c.fecha.toISOString(),
        precioAnterior: c.precioAnterior,
        precioNuevo: c.precioNuevo,
        quien: c.usuario.nombre,
      }));
    }
    case "productos_stock_negativo": {
      const productos = await prisma.producto.findMany({
        where: { activo: true, stockActual: { lt: 0 } },
        include: { categoria: true },
        orderBy: { stockActual: "asc" },
      });
      return productos.map((p) => ({ id: p.id, plu: p.plu, descripcion: p.descripcion, categoria: p.categoria.nombre, stockActual: p.stockActual }));
    }
    case "productos_sin_venta_reciente": {
      const dias = Number(input.diasSinVenta) > 0 ? Number(input.diasSinVenta) : 30;
      const umbral = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const vendidosRecientes = await prisma.itemVenta.findMany({
        where: { anulado: false, venta: { estado: "pagada", fecha: { gte: umbral } } },
        select: { productoId: true },
        distinct: ["productoId"],
      });
      const idsVendidos = new Set(vendidosRecientes.map((v) => v.productoId));
      const productosActivos = await prisma.producto.findMany({
        where: { activo: true },
        include: { categoria: true },
        orderBy: { descripcion: "asc" },
      });
      const sinVenta = productosActivos.filter((p) => !idsVendidos.has(p.id));
      return {
        diasSinVenta: dias,
        totalSinVentaReciente: sinVenta.length,
        productos: sinVenta.slice(0, 60).map((p) => ({ id: p.id, plu: p.plu, descripcion: p.descripcion, categoria: p.categoria.nombre, stockActual: p.stockActual })),
      };
    }
    case "consultar_camara": {
      const productoId = input.productoId != null ? Number(input.productoId) : undefined;
      const cajas = await prisma.cajaCamara.findMany({
        where: { estado: { in: ["en_camara", "parcial"] }, ...(productoId ? { productoId } : {}) },
        include: { producto: true },
        orderBy: { fechaIngreso: "asc" },
      });
      return cajas.map((c) => ({
        cajaId: c.id,
        numero: String(c.id).padStart(6, "0"),
        producto: c.producto.descripcion,
        familia: c.familiaNombre,
        procedencia: c.procedencia,
        fechaIngreso: c.fechaIngreso.toISOString(),
        saldoKg: c.saldoKg,
        estado: c.estado,
        version: c.version,
      }));
    }
    case "ventas_mayoristas_pendientes": {
      const salidas = await prisma.salidaMayorista.findMany({
        where: { estadoPago: "pendiente" },
        include: { producto: true },
        orderBy: { fecha: "asc" },
      });
      return salidas.map((s) => ({
        id: s.id,
        producto: s.producto.descripcion,
        cliente: s.clienteNombre,
        cantidadKg: s.cantidadKg,
        precioTotal: s.precioTotal,
        fecha: s.fecha.toISOString(),
      }));
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
- Llama como máximo una herramienta "proponer_*" por pedido — pero esa herramienta puede ser una de las masivas (proponer_entradas_inventario_masivas, proponer_categorizar_masivo, proponer_cambios_precio_masivos) para proponer varios cambios de una vez como un solo lote que la persona revisa y confirma junto.
- Si falta información para proponer el cambio (ej. no sabes a qué producto se refiere), pregunta primero en vez de adivinar.

Sobre pedidos con varias líneas (ej. la persona pega el texto de una factura, o pide categorizar/cambiar precio a una lista de productos):
- Identifica cada línea/producto por separado y usa buscar_productos para encontrar su productoId real — nunca inventes un id ni asumas cuál es sin buscarlo.
- Si el nombre de una línea no tiene un match único y claro en el catálogo (no aparece, o hay varios productos parecidos y no es obvio cuál es), NO lo incluyas en la propuesta ni elijas uno al azar: dile a la persona qué línea(s) no pudiste identificar con confianza y pregúntale a cuál producto corresponde, antes de proponer el resto.
- Arma la propuesta final (una sola llamada a la herramienta "proponer_*" masiva correspondiente) solo con las líneas que sí identificaste con confianza.
- Sé breve. No hace falta repetir toda la data cruda de una consulta, resume lo relevante.

Sobre comparar períodos (ej. "¿vendimos más este mes que el anterior?"): no hay una herramienta aparte para esto — llama la herramienta de reporte que corresponda (reporte_ventas, reporte_inventario, reporte_precios, reporte_gastos o reporte_despachos) más de una vez, una por cada rango de fechas que necesites, y compará los resultados vos mismo en la respuesta.

Sobre la cámara frigorífica: cada caja tiene una "version" que cambia cada vez que se le saca algo — para proponer_salida_camara, usa siempre el cajaId y la version que te devolvió consultar_camara en la MISMA conversación (no reuses una version vieja de un mensaje anterior, puede estar desactualizada).

Sobre créditos (ventas fiadas): usa creditos_pendientes primero para tener el pagoId real antes de proponer_marcar_credito_cobrado — nunca inventes un pagoId.

Sobre crear un producto nuevo: usa buscar_productos primero para confirmar que el PLU que te dieron no esté ya en uso (si ya existe, avisa en vez de proponer un duplicado) y listar_categorias para tener el categoriaId real. Si no te dan la categoría, pregunta antes de asumir una.`;

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

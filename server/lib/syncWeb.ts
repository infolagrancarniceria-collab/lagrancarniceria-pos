// Sincronización con la página web (lagrancarniceria.com): empuja el
// catálogo público (productos visibles, comunas, opciones de corte) y trae
// los pedidos armados ahí para el panel "Pedidos web".
//
// La web es la única pieza que toca la base de datos en la nube
// directamente — este módulo nunca guarda ni lee esa base de datos, solo le
// habla por HTTPS a las rutas /api/sync/* de la web, autenticado con una
// llave acotada solo para sincronizar catálogo/pedidos (no la contraseña
// completa de esa base de datos).
//
// La configuración (URL + llave) vive en la tabla ConfiguracionSyncWeb
// (pantalla Configuración → "Sincronización con la web"), no solo en
// variables de entorno — un .env sirve para desarrollo, pero el instalador
// que llega al PC de la carnicería no trae ningún archivo .env, así que sin
// esto no habría forma de configurarlo ahí. Las variables de entorno
// (WEB_SYNC_URL / SYNC_API_KEY) quedan como respaldo para desarrollo local.
//
// Es "best effort" a propósito: si el local está sin internet o la web no
// responde, se reintenta solo en el próximo ciclo — nunca bloquea ni afecta
// ninguna operación normal del POS (venta, cambio de precio, etc.). Por eso
// cada llamador la invoca sin esperarla ("void sincronizarCatalogoConWeb()")
// en vez de hacer que el cajero espere una respuesta de internet para poder
// seguir trabajando.
import { prisma } from "../db";

const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos — respaldo por si un push puntual falló sin internet
const TIMEOUT_MS = 15_000;

interface ConfigSyncWeb {
  url: string;
  clave: string;
}

async function obtenerConfig(): Promise<ConfigSyncWeb | null> {
  const fila = await prisma.configuracionSyncWeb.findFirst();
  const url = fila?.webSyncUrl || process.env.WEB_SYNC_URL;
  const clave = fila?.syncApiKey || process.env.SYNC_API_KEY;
  if (!url || !clave) return null;
  return { url: url.replace(/\/+$/, ""), clave };
}

interface ProductoSync {
  idPos: number;
  plu: string;
  descripcion: string;
  nombreCorto: string | null;
  categoriaNombre: string;
  marca: string | null;
  descripcionCorta: string | null;
  precio: number;
  unidad: "kg" | "unidad";
  familiaCorte: string | null;
  disponibilidad: "disponible" | "agotado" | "proximamente";
  featured: boolean;
  lowStock: boolean;
  promoPrecioUnitario: number | null;
  promoGramosMinimos: number | null;
  promoEtiqueta: string | null;
}

interface SnapshotCatalogo {
  productos: ProductoSync[];
  comunas: { nombre: string; costoEnvio: number }[];
  cortes: { familia: string; nombre: string; orden: number }[];
}

async function construirSnapshotCatalogo(): Promise<SnapshotCatalogo> {
  const [productos, comunas, cortes] = await Promise.all([
    prisma.producto.findMany({
      where: { activo: true, visibleEnWeb: true },
      include: { categoria: true },
    }),
    prisma.comuna.findMany({ where: { activo: true } }),
    prisma.corteOpcion.findMany({ where: { activo: true }, orderBy: { orden: "asc" } }),
  ]);

  return {
    productos: productos.map((p) => ({
      idPos: p.id,
      plu: p.plu,
      descripcion: p.descripcion,
      nombreCorto: p.nombreCorto,
      categoriaNombre: p.categoria.nombre,
      marca: p.marca,
      descripcionCorta: p.descripcionCorta,
      precio: p.precio,
      // Mismo criterio que ya usa el resto del sistema (ver comentario en
      // Producto.precio): NORMAL se vende por unidad, PESABLE/IMPORTE por kg.
      unidad: p.flagBalanza === "NORMAL" ? "unidad" : "kg",
      familiaCorte: p.familiaCorte,
      disponibilidad: p.disponibilidadWeb as "disponible" | "agotado" | "proximamente",
      featured: p.featured,
      lowStock: p.lowStock,
      promoPrecioUnitario: p.promoPrecioUnitario,
      promoGramosMinimos: p.promoGramosMinimos,
      promoEtiqueta: p.promoEtiqueta,
    })),
    comunas: comunas.map((c) => ({ nombre: c.nombre, costoEnvio: c.costoEnvio })),
    cortes: cortes.map((c) => ({ familia: c.familia, nombre: c.nombre, orden: c.orden })),
  };
}

let sincronizandoCatalogo = false;

// Manda el catálogo completo (no un diff) cada vez — el catálogo de una
// carnicería no es tan grande como para que esto pese, y evita toda la
// complejidad extra (y los bugs) de calcular diffs incrementales. La web
// trata cada snapshot recibido como la verdad completa del momento.
export async function sincronizarCatalogoConWeb(): Promise<void> {
  if (sincronizandoCatalogo) return;
  const config = await obtenerConfig();
  if (!config) return;

  sincronizandoCatalogo = true;
  try {
    const snapshot = await construirSnapshotCatalogo();
    const respuesta = await fetch(`${config.url}/api/sync/catalogo`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": config.clave },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      console.warn(`[sync-web] la web respondió ${respuesta.status} al sincronizar catálogo`);
    }
  } catch (err) {
    console.warn("[sync-web] no se pudo sincronizar el catálogo (¿sin internet?):", (err as Error).message);
  } finally {
    sincronizandoCatalogo = false;
  }
}

interface PedidoWebRemoto {
  idWeb: string;
  fecha: string;
  clienteNombre: string;
  clienteTelefono: string;
  tipoEntrega: string;
  clienteDireccion: string | null;
  comunaNombre: string | null;
  costoEnvio: number | null;
  fechaEntrega: string | null;
  medioPago: string | null;
  items: unknown;
  comentario?: string | null;
}

// Cuántos PedidoWeb ya hay guardados para el mismo día local de "fecha"
// (más 1) — usado para asignar numeroDelDia. Se recalcula contando la
// tabla en vez de llevar un contador aparte porque es más simple y el
// volumen de pedidos web de una carnicería no justifica optimizarlo.
async function siguienteNumeroDelDia(fecha: Date): Promise<number> {
  const inicioDelDia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const finDelDia = new Date(inicioDelDia);
  finDelDia.setDate(finDelDia.getDate() + 1);
  const cantidad = await prisma.pedidoWeb.count({ where: { fecha: { gte: inicioDelDia, lt: finDelDia } } });
  return cantidad + 1;
}

let sincronizandoPedidos = false;

// Trae los pedidos que la web tiene pendientes de entregar al POS, los
// guarda en PedidoWeb (para el panel "Pedidos web") y le confirma a la web
// cuáles quedaron guardados, para que no los vuelva a mandar la próxima vez.
// "idWeb" es la clave para no duplicar un pedido si la confirmación se
// pierde y la web lo reenvía. Devuelve cuántos pedidos nuevos se guardaron
// — lo usa el botón "Actualizar" de Pedidos web para avisar si había algo
// nuevo o no, en vez de forzar a cerrar y volver a abrir el programa entero
// para que corra el próximo ciclo automático (cada 5 minutos).
export async function traerPedidosWebPendientes(): Promise<number> {
  if (sincronizandoPedidos) return 0;
  const config = await obtenerConfig();
  if (!config) return 0;

  sincronizandoPedidos = true;
  try {
    const respuesta = await fetch(`${config.url}/api/sync/pedidos-pendientes`, {
      headers: { "x-sync-key": config.clave },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      console.warn(`[sync-web] la web respondió ${respuesta.status} al pedir pedidos pendientes`);
      return 0;
    }
    const { pedidos } = (await respuesta.json()) as { pedidos: PedidoWebRemoto[] };
    if (pedidos.length === 0) return 0;

    let nuevos = 0;
    const idsGuardados: string[] = [];
    for (const pedido of pedidos) {
      const yaExiste = await prisma.pedidoWeb.findUnique({ where: { idWeb: pedido.idWeb } });
      if (!yaExiste) {
        const fecha = new Date(pedido.fecha);
        const numeroDelDia = await siguienteNumeroDelDia(fecha);
        await prisma.pedidoWeb.create({
          data: {
            idWeb: pedido.idWeb,
            fecha,
            numeroDelDia,
            clienteNombre: pedido.clienteNombre,
            clienteTelefono: pedido.clienteTelefono,
            tipoEntrega: pedido.tipoEntrega,
            clienteDireccion: pedido.clienteDireccion,
            comunaNombre: pedido.comunaNombre,
            costoEnvio: pedido.costoEnvio,
            fechaEntrega: pedido.fechaEntrega,
            medioPago: pedido.medioPago,
            itemsJson: JSON.stringify(pedido.items),
            comentario: pedido.comentario ?? null,
          },
        });
        nuevos++;
      }
      idsGuardados.push(pedido.idWeb);
    }

    await fetch(`${config.url}/api/sync/pedidos-confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": config.clave },
      body: JSON.stringify({ idsWeb: idsGuardados }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return nuevos;
  } catch (err) {
    console.warn("[sync-web] no se pudo traer pedidos pendientes (¿sin internet?):", (err as Error).message);
    return 0;
  } finally {
    sincronizandoPedidos = false;
  }
}

let intervalo: NodeJS.Timeout | undefined;

// Se llama una vez al levantar el servidor (ver server/index.ts). El
// intervalo siempre queda corriendo — cada ciclo revisa solo si hay
// configuración guardada (obtenerConfig), así que si todavía no se
// configuró (instalación nueva) o se configura después desde la pantalla de
// Configuración, el sync se activa solo, sin reiniciar el programa.
export function iniciarSyncWeb(): void {
  if (intervalo) return;
  const ciclo = () => {
    void sincronizarCatalogoConWeb();
    void traerPedidosWebPendientes();
  };
  ciclo();
  intervalo = setInterval(ciclo, INTERVALO_MS);
}

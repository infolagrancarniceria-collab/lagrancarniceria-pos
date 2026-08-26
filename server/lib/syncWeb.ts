// Sincronización con la página web (lagrancarniceria.com): empuja el
// catálogo público (productos visibles, comunas, opciones de corte) y trae
// los pedidos armados ahí para el panel "Pedidos web".
//
// La web es la única pieza que toca la base de datos en la nube
// directamente — este módulo nunca guarda ni lee esa base de datos, solo le
// habla por HTTPS a las rutas /api/sync/* de la web, autenticado con
// SYNC_API_KEY (una llave acotada solo para sincronizar catálogo/pedidos,
// no la contraseña completa de esa base de datos).
//
// Es "best effort" a propósito: si el local está sin internet o la web no
// responde, se reintenta solo en el próximo ciclo — nunca bloquea ni afecta
// ninguna operación normal del POS (venta, cambio de precio, etc.). Por eso
// cada llamador la invoca sin esperarla ("void sincronizarCatalogoConWeb()")
// en vez de hacer que el cajero espere una respuesta de internet para poder
// seguir trabajando.
import { prisma } from "../db";

const WEB_SYNC_URL = process.env.WEB_SYNC_URL;
const SYNC_API_KEY = process.env.SYNC_API_KEY;
const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos — respaldo por si un push puntual falló sin internet
const TIMEOUT_MS = 15_000;

function configurado(): boolean {
  return Boolean(WEB_SYNC_URL && SYNC_API_KEY);
}

interface ProductoSync {
  idPos: number;
  plu: string;
  descripcion: string;
  nombreCorto: string | null;
  categoriaNombre: string;
  precio: number;
  unidad: "kg" | "unidad";
  familiaCorte: string | null;
  agotado: boolean;
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
      precio: p.precio,
      // Mismo criterio que ya usa el resto del sistema (ver comentario en
      // Producto.precio): NORMAL se vende por unidad, PESABLE/IMPORTE por kg.
      unidad: p.flagBalanza === "NORMAL" ? "unidad" : "kg",
      familiaCorte: p.familiaCorte,
      agotado: p.agotadoWeb,
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
  if (!configurado() || sincronizandoCatalogo) return;
  sincronizandoCatalogo = true;
  try {
    const snapshot = await construirSnapshotCatalogo();
    const respuesta = await fetch(`${WEB_SYNC_URL}/api/sync/catalogo`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": SYNC_API_KEY! },
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
  clienteDireccion: string;
  comunaNombre: string;
  costoEnvio: number;
  items: unknown;
  comentario?: string | null;
}

// Trae los pedidos que la web tiene pendientes de entregar al POS, los
// guarda en PedidoWeb (para el panel "Pedidos web") y le confirma a la web
// cuáles quedaron guardados, para que no los vuelva a mandar la próxima vez.
// "idWeb" es la clave para no duplicar un pedido si la confirmación se
// pierde y la web lo reenvía.
export async function traerPedidosWebPendientes(): Promise<void> {
  if (!configurado()) return;
  try {
    const respuesta = await fetch(`${WEB_SYNC_URL}/api/sync/pedidos-pendientes`, {
      headers: { "x-sync-key": SYNC_API_KEY! },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!respuesta.ok) {
      console.warn(`[sync-web] la web respondió ${respuesta.status} al pedir pedidos pendientes`);
      return;
    }
    const { pedidos } = (await respuesta.json()) as { pedidos: PedidoWebRemoto[] };
    if (pedidos.length === 0) return;

    const idsGuardados: string[] = [];
    for (const pedido of pedidos) {
      const yaExiste = await prisma.pedidoWeb.findUnique({ where: { idWeb: pedido.idWeb } });
      if (!yaExiste) {
        await prisma.pedidoWeb.create({
          data: {
            idWeb: pedido.idWeb,
            fecha: new Date(pedido.fecha),
            clienteNombre: pedido.clienteNombre,
            clienteTelefono: pedido.clienteTelefono,
            clienteDireccion: pedido.clienteDireccion,
            comunaNombre: pedido.comunaNombre,
            costoEnvio: pedido.costoEnvio,
            itemsJson: JSON.stringify(pedido.items),
            comentario: pedido.comentario ?? null,
          },
        });
      }
      idsGuardados.push(pedido.idWeb);
    }

    await fetch(`${WEB_SYNC_URL}/api/sync/pedidos-confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": SYNC_API_KEY! },
      body: JSON.stringify({ idsWeb: idsGuardados }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("[sync-web] no se pudo traer pedidos pendientes (¿sin internet?):", (err as Error).message);
  }
}

let intervalo: NodeJS.Timeout | undefined;

// Se llama una vez al levantar el servidor (ver server/index.ts). Si no hay
// WEB_SYNC_URL/SYNC_API_KEY configurados (ej. instalación que todavía no se
// conectó a la web), queda desactivado sin romper nada más del POS.
export function iniciarSyncWeb(): void {
  if (!configurado()) {
    console.log("[sync-web] WEB_SYNC_URL / SYNC_API_KEY no configurados — sync con la web desactivado");
    return;
  }
  if (intervalo) return;
  const ciclo = () => {
    void sincronizarCatalogoConWeb();
    void traerPedidosWebPendientes();
  };
  ciclo();
  intervalo = setInterval(ciclo, INTERVALO_MS);
}

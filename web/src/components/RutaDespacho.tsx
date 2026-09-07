import { formatoCLP, formatoPeso, type Comuna, type PedidoWeb } from "../api";
import { etiquetaPedido, subtotalItem, totalPedido } from "./ValePedidoWeb";

export type DireccionRuta = "cercana" | "lejana";

// Casilla vacía para tildar a mano en la calle mientras se reparte — no es
// un <input type="checkbox"> real porque esto es solo para imprimir en
// papel, no interactivo en pantalla.
function CasillaEntregado() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        border: "1.5px solid #000",
        marginRight: "0.5rem",
        verticalAlign: "middle",
      }}
    />
  );
}

// Agrupa por comuna y ordena los grupos según "ordenDespacho" (calibrado a
// mano en Comunas de despacho, por cercanía real desde el local) — no
// alfabético, para que la ruta salga en un orden que de verdad sirva para
// manejar. Las comunas sin ordenDespacho quedan al final, en cualquier
// dirección. "direccion" invierte el sentido: empezar por la más cercana
// (orden ascendente) o por la más lejana (descendente) — a criterio de
// quien reparte, según convenga ese día.
export function agruparPorComuna(
  pedidos: PedidoWeb[],
  comunas: Comuna[],
  direccion: DireccionRuta = "cercana"
): [string, PedidoWeb[]][] {
  const grupos = new Map<string, PedidoWeb[]>();
  for (const p of pedidos) {
    const comuna = p.comunaNombre ?? "Sin comuna";
    const lista = grupos.get(comuna) ?? [];
    lista.push(p);
    grupos.set(comuna, lista);
  }
  const ordenPorNombre = new Map(comunas.map((c) => [c.nombre, c.ordenDespacho]));
  const signo = direccion === "cercana" ? 1 : -1;
  return Array.from(grupos.entries()).sort(([a], [b]) => {
    const ordenA = ordenPorNombre.get(a);
    const ordenB = ordenPorNombre.get(b);
    if (ordenA == null && ordenB == null) return a.localeCompare(b);
    if (ordenA == null) return 1;
    if (ordenB == null) return -1;
    return (ordenA - ordenB) * signo;
  });
}

// Mensaje de texto plano con la ruta, para enviar por WhatsApp (ver botón
// "Enviar por WhatsApp" en PedidosWeb.tsx) — sin destinatario fijo, el
// equipo lo reenvía a quien reparte ese día. Incluye lo mínimo para
// despachar: número de pedido, nombre, teléfono y dirección — no el
// detalle de productos (eso va en el vale que se le entrega al cliente).
export function construirMensajeRutaWhatsapp(pedidos: PedidoWeb[], comunas: Comuna[], direccion: DireccionRuta): string {
  const grupos = agruparPorComuna(
    pedidos.filter((p) => p.tipoEntrega === "despacho"),
    comunas,
    direccion
  );
  const lineas: string[] = ["Ruta de despacho"];
  for (const [comuna, pedidosComuna] of grupos) {
    lineas.push("", `*${comuna}*`);
    for (const p of pedidosComuna) {
      lineas.push(
        `${etiquetaPedido(p)} — ${p.clienteNombre}`,
        `Tel: ${p.clienteTelefono}`,
        `Dirección: ${p.clienteDireccion ?? "—"}`
      );
    }
  }
  return lineas.join("\n");
}

interface Props {
  pedidos: PedidoWeb[];
  comunas: Comuna[];
  direccion: DireccionRuta;
}

// Hoja de ruta para salir a despachar: agrupada por comuna (para no cruzar
// la ciudad de un lado a otro), con lo necesario en la puerta de cada
// cliente — nombre, dirección, teléfono, cuánto cobrar y qué lleva — más
// una casilla para tildar a mano. Se imprime en hoja normal (A4), no en el
// rollo térmico del ticket individual — ver imprimirRutaDespacho().
export function RutaDespacho({ pedidos, comunas, direccion }: Props) {
  const grupos = agruparPorComuna(
    pedidos.filter((p) => p.tipoEntrega === "despacho"),
    comunas,
    direccion
  );
  const hoy = new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="vale ruta-despacho">
      <h1>Ruta de despacho</h1>
      <p>
        {hoy} — {pedidos.length} parada{pedidos.length === 1 ? "" : "s"}
      </p>

      {grupos.map(([comuna, pedidosComuna]) => (
        <section key={comuna} className="ruta-comuna">
          <h2>{comuna}</h2>
          {pedidosComuna.map((p) => {
            const total = totalPedido(p);
            return (
              <div key={p.id} className="ruta-parada">
                <p>
                  <CasillaEntregado />
                  <strong>
                    {etiquetaPedido(p)} — {p.clienteNombre}
                  </strong>
                </p>
                <p>{p.clienteDireccion}</p>
                <p>Teléfono: {p.clienteTelefono}</p>
                <p>
                  A cobrar: <strong>{total != null ? formatoCLP(total) : "por calcular en Caja"}</strong>
                  {p.medioPago ? ` (${p.medioPago})` : ""}
                </p>
                {p.comentario && <p>Comentario: {p.comentario}</p>}
                <table className="tabla tabla-vale">
                  <tbody>
                    {p.items.map((item, i) => (
                      <tr key={i}>
                        <td>
                          {item.descripcion}
                          {item.corte ? ` — ${item.corte}` : ""}
                          {item.envasado ? ` (${item.envasado})` : ""}
                          {item.instrucciones && <div className="ayuda">{item.instrucciones}</div>}
                        </td>
                        <td>{item.unidad === "kg" ? formatoPeso(item.cantidad) : `${item.cantidad} un.`}</td>
                        <td>{subtotalItem(item) != null ? formatoCLP(subtotalItem(item)!) : "—"}</td>
                      </tr>
                    ))}
                    {p.regalos.length > 0 &&
                      p.regalos.map((r) => (
                        <tr key={`regalo-${r.id}`}>
                          <td>{r.producto.descripcion} (regalo)</td>
                          <td>{r.cantidad}</td>
                          <td>—</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

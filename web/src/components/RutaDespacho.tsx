import { formatoCLP, formatoPeso, type PedidoWeb } from "../api";
import { etiquetaPedido, subtotalItem, totalPedido } from "./ValePedidoWeb";

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

function agruparPorComuna(pedidos: PedidoWeb[]): [string, PedidoWeb[]][] {
  const grupos = new Map<string, PedidoWeb[]>();
  for (const p of pedidos) {
    const comuna = p.comunaNombre ?? "Sin comuna";
    const lista = grupos.get(comuna) ?? [];
    lista.push(p);
    grupos.set(comuna, lista);
  }
  return Array.from(grupos.entries()).sort(([a], [b]) => a.localeCompare(b));
}

interface Props {
  pedidos: PedidoWeb[];
}

// Hoja de ruta para salir a despachar: agrupada por comuna (para no cruzar
// la ciudad de un lado a otro), con lo necesario en la puerta de cada
// cliente — nombre, dirección, teléfono, cuánto cobrar y qué lleva — más
// una casilla para tildar a mano. Se imprime en hoja normal (A4), no en el
// rollo térmico del ticket individual — ver imprimirRutaDespacho().
export function RutaDespacho({ pedidos }: Props) {
  const grupos = agruparPorComuna(pedidos.filter((p) => p.tipoEntrega === "despacho"));
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

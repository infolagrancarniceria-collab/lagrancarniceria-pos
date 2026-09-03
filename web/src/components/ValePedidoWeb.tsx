import { formatoCLP, formatoPeso, type PedidoWeb, type PedidoWebItem } from "../api";

// Mismo cálculo que usa el carrito de la web (ver src/lib/pricing.ts allá):
// precioUnitario es CLP/kg con cantidad en gramos, o CLP/unidad. Pedidos de
// antes de que el pedido web empezara a guardar precio no traen
// precioUnitario — en ese caso no hay forma de saber cuánto valía, así que
// se omite en vez de mostrar un número inventado.
export function subtotalItem(item: PedidoWebItem): number | null {
  if (item.precioUnitario == null) return null;
  return item.unidad === "kg" ? Math.round((item.precioUnitario * item.cantidad) / 1000) : item.precioUnitario * item.cantidad;
}

// Suma solo si TODOS los items tienen precio — un total parcial (que
// ignorara en silencio los items sin precio) sería más engañoso que no
// mostrar ningún total.
export function totalPedido(pedido: PedidoWeb): number | null {
  const subtotales = pedido.items.map(subtotalItem);
  if (subtotales.some((s) => s == null)) return null;
  const subtotalItems = subtotales.reduce((s, v) => s! + v!, 0)!;
  const descuento =
    pedido.descuentoTipo === "porcentaje"
      ? Math.round((subtotalItems * (pedido.descuentoValor ?? 0)) / 100)
      : pedido.descuentoTipo === "monto"
        ? (pedido.descuentoValor ?? 0)
        : 0;
  return subtotalItems - descuento + (pedido.costoEnvio ?? 0);
}

// "PEDIDO #N" — N es el correlativo del día (ver PedidoWeb.numeroDelDia),
// para poder identificar el pedido de un vistazo entre varios tickets sin
// tener que leer el nombre del cliente. Se usa tanto en el ticket impreso
// como en la tarjeta de pantalla, para que sea el mismo número en los dos
// lados.
export function etiquetaPedido(pedido: PedidoWeb): string {
  return pedido.numeroDelDia != null ? `Pedido #${pedido.numeroDelDia}` : "Pedido";
}

interface Props {
  pedido: PedidoWeb;
  onImprimir?: () => void;
}

// Detalle imprimible de un pedido web — mismo patrón que ValeVenta.tsx: se
// usa tanto oculto en pantalla (solo para capturar la impresión, ver
// PedidosWeb.tsx) como, potencialmente, visible con su botón Imprimir.
export function ValePedidoWeb({ pedido, onImprimir }: Props) {
  const total = totalPedido(pedido);

  return (
    <div className="vale vale-pedido-web">
      {onImprimir && (
        <div className="no-imprimir fila-inline">
          <button type="button" onClick={onImprimir}>
            Imprimir
          </button>
        </div>
      )}
      {pedido.estado === "anulado" && (
        <p className="error no-imprimir">
          Pedido anulado — {pedido.motivoAnulacion ?? "sin motivo especificado"}
          {pedido.anuladoEn ? `, ${new Date(pedido.anuladoEn).toLocaleString("es-CL")}` : ""}
        </p>
      )}
      <h1>{etiquetaPedido(pedido)}</h1>
      <h2>La Gran Carnicería</h2>
      <p>Pedido web — {new Date(pedido.fecha).toLocaleString("es-CL")}</p>
      <p>Cliente: {pedido.clienteNombre}</p>
      <p>Teléfono: {pedido.clienteTelefono}</p>
      <p>
        {pedido.tipoEntrega === "despacho" ? "Despacho a domicilio" : "Retiro en tienda"}
        {pedido.fechaEntrega ? ` — ${pedido.fechaEntrega}` : ""}
      </p>
      {pedido.tipoEntrega === "despacho" && (
        <p>
          {pedido.clienteDireccion} ({pedido.comunaNombre}) — Envío: {pedido.costoEnvio != null ? formatoCLP(pedido.costoEnvio) : "—"}
        </p>
      )}
      {pedido.medioPago && <p>Medio de pago: {pedido.medioPago}</p>}
      {pedido.comentario && <p>Comentario: {pedido.comentario}</p>}

      <table className="tabla tabla-vale">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Corte</th>
            <th>Cant.</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {pedido.items.map((item, i) => {
            const subtotal = subtotalItem(item);
            return (
              <tr key={i}>
                <td>
                  {item.descripcion}
                  {item.envasado && <div className="ayuda">{item.envasado}</div>}
                  {item.instrucciones && <div className="ayuda">{item.instrucciones}</div>}
                </td>
                <td>{item.corte ?? "—"}</td>
                <td>{item.unidad === "kg" ? formatoPeso(item.cantidad) : `${item.cantidad} un.`}</td>
                <td>{subtotal != null ? formatoCLP(subtotal) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pedido.descuentoTipo && (
        <p>
          Descuento: {pedido.descuentoTipo === "porcentaje" ? `${pedido.descuentoValor}%` : formatoCLP(pedido.descuentoValor ?? 0)}
          {pedido.descuentoMotivo ? ` — ${pedido.descuentoMotivo}` : ""}
        </p>
      )}
      <h2>Total: {total != null ? formatoCLP(total) : "por calcular en Caja"}</h2>
    </div>
  );
}

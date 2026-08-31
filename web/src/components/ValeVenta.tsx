import { formatoCLP, type Venta } from "../api";

// Un pago en efectivo se cobra redondeado a la decena más cercana (Ley del
// Redondeo) — puede dejar unos pocos pesos de diferencia entre el Total
// (exacto, según los productos) y la suma de los pagos. Se muestra aparte
// en vez de dejarlo sin explicar, igual que hacen las boletas reales.
function calcularRedondeo(venta: Venta): number {
  const totalPagado = venta.pagos.reduce((s, p) => s + p.monto, 0);
  return Math.round(totalPagado - venta.total);
}

const etiquetaMedio: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  credito: "Crédito",
};

interface Props {
  venta: Venta;
  onImprimir?: () => void;
  onAnular?: () => void;
}

// Detalle imprimible de una venta confirmada — usado tanto en "Buscar
// venta" (con los botones Imprimir/Anular) como en Punto de Venta (sin
// botones, oculto en pantalla, solo para la impresión automática al
// confirmar). Extraído a un componente aparte para no duplicar el mismo
// markup del vale en los dos lugares.
export function ValeVenta({ venta, onImprimir, onAnular }: Props) {
  const itemsActivos = venta.items.filter((i) => !i.anulado);
  const itemsAnulados = venta.items.filter((i) => i.anulado);

  return (
    <div className="vale">
      {(onImprimir || onAnular) && (
        <div className="no-imprimir fila-inline">
          {onImprimir && (
            <button type="button" onClick={onImprimir}>
              Imprimir
            </button>
          )}
          {onAnular && venta.estado === "pagada" && (
            <button type="button" onClick={onAnular}>
              Anular venta
            </button>
          )}
        </div>
      )}
      {venta.estado === "anulada" && (
        <p className="error no-imprimir">
          Venta anulada — {venta.motivoAnulacion ?? "sin motivo especificado"}
          {venta.usuarioAnulacion ? ` (autorizó: ${venta.usuarioAnulacion.nombre})` : ""}
          {venta.fechaAnulacion ? `, ${new Date(venta.fechaAnulacion).toLocaleString("es-CL")}` : ""}
        </p>
      )}
      <h2>La Gran Carnicería</h2>
      <p>
        Venta #{venta.id} — {new Date(venta.fecha).toLocaleString("es-CL")}
      </p>
      <p>Vendedor: {venta.usuario?.nombre ?? "—"}</p>
      {venta.comentario && <p>Comentario: {venta.comentario}</p>}
      {venta.esDespacho && (
        <p>
          Despacho a {venta.comuna?.nombre ?? "—"} ({formatoCLP(venta.costoEnvio ?? 0)})
        </p>
      )}
      <table className="tabla tabla-vale">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {itemsActivos.map((item) => (
            <tr key={item.id}>
              <td>{item.producto.descripcion}</td>
              <td>{item.cantidad}</td>
              <td>{formatoCLP(item.precioUnitario)}</td>
              <td>
                {formatoCLP(item.subtotal)}
                {item.descuentoTipo && (
                  <div className="ayuda">
                    desc. {item.descuentoTipo === "porcentaje" ? `${item.descuentoValor}%` : formatoCLP(item.descuentoValor ?? 0)}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {itemsAnulados.length > 0 && (
        <div className="no-imprimir">
          <h3>Productos anulados</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Motivo</th>
                <th>Anulado por</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {itemsAnulados.map((item) => (
                <tr key={item.id}>
                  <td>{item.producto.descripcion}</td>
                  <td>{item.cantidad}</td>
                  <td>{item.motivoAnulacion ?? "—"}</td>
                  <td>{item.usuarioAnulacion?.nombre ?? "—"}</td>
                  <td>{item.fechaAnulacion ? new Date(item.fechaAnulacion).toLocaleString("es-CL") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {venta.descuentoTipo && (
        <p>
          Subtotal: {formatoCLP(itemsActivos.reduce((s, i) => s + i.subtotal, 0))} · Descuento:{" "}
          {venta.descuentoTipo === "porcentaje" ? `${venta.descuentoValor}%` : formatoCLP(venta.descuentoValor ?? 0)}
        </p>
      )}
      <h2>Total: {formatoCLP(venta.total)}</h2>
      <h3>Pagos</h3>
      <ul>
        {venta.pagos.map((p) => (
          <li key={p.id}>
            {etiquetaMedio[p.medio] ?? p.medio}
            {p.medio === "credito" ? ` (${p.clienteNombre})` : ""}: {formatoCLP(p.monto)}
            {p.medio === "efectivo" && p.montoEntregado != null && p.montoEntregado > p.monto && (
              <>
                {" "}
                — pagó con {formatoCLP(p.montoEntregado)}, vuelto {formatoCLP(p.montoEntregado - p.monto)}
              </>
            )}
          </li>
        ))}
        {calcularRedondeo(venta) !== 0 && (
          <li>
            Redondeo (Ley N° 21.131): {calcularRedondeo(venta) > 0 ? "+" : "-"}
            {formatoCLP(Math.abs(calcularRedondeo(venta)))}
          </li>
        )}
      </ul>
    </div>
  );
}

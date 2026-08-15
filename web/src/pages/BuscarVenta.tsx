import { useState } from "react";
import { api, formatoCLP, type Venta } from "../api";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const etiquetaMedio: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  credito: "Crédito",
};

export default function BuscarVenta() {
  const [desde, setDesde] = useState(fechaHace(7));
  const [hasta, setHasta] = useState(hoy());
  const [numeroVenta, setNumeroVenta] = useState("");
  const [resultados, setResultados] = useState<Venta[]>([]);
  const [ventaDetalle, setVentaDetalle] = useState<Venta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVentaDetalle(null);
    setCargando(true);
    try {
      const datos = await api.caja.buscarVentas({
        desde,
        hasta,
        ventaId: numeroVenta ? Number(numeroVenta) : undefined,
      });
      setResultados(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function verDetalle(ventaId: number) {
    setError(null);
    try {
      const venta = await api.caja.obtenerVenta(ventaId);
      setVentaDetalle(venta);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const itemsActivos = ventaDetalle?.items.filter((i) => !i.anulado) ?? [];
  const itemsAnulados = ventaDetalle?.items.filter((i) => i.anulado) ?? [];

  return (
    <div>
      <div className="no-imprimir">
        <h1>Buscar venta</h1>
        {error && <p className="error">{error}</p>}

        <form onSubmit={buscar} className="fila-inline">
          <label>
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <input
            type="number"
            placeholder="N° de venta (opcional)"
            value={numeroVenta}
            onChange={(e) => setNumeroVenta(e.target.value)}
          />
          <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
        </form>

        <table className="tabla">
          <thead>
            <tr>
              <th>N° venta</th>
              <th>Fecha</th>
              <th>Vendedor</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resultados.map((v) => (
              <tr key={v.id}>
                <td>#{v.id}</td>
                <td>{new Date(v.fecha).toLocaleString("es-CL")}</td>
                <td>{v.usuario?.nombre ?? "—"}</td>
                <td>{formatoCLP(v.total)}</td>
                <td>
                  <button type="button" onClick={() => verDetalle(v.id)}>
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
            {resultados.length === 0 && (
              <tr>
                <td colSpan={5}>Sin resultados — prueba buscar por otra fecha o N° de venta.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ventaDetalle && (
        <div className="vale">
          <button type="button" className="no-imprimir" onClick={() => window.print()}>
            Imprimir
          </button>
          <h2>La Gran Carnicería</h2>
          <p>
            Venta #{ventaDetalle.id} — {new Date(ventaDetalle.fecha).toLocaleString("es-CL")}
          </p>
          <p>Vendedor: {ventaDetalle.usuario?.nombre ?? "—"}</p>
          {ventaDetalle.esDespacho && (
            <p>
              Despacho a {ventaDetalle.comuna?.nombre ?? "—"} ({formatoCLP(ventaDetalle.costoEnvio ?? 0)})
            </p>
          )}
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {itemsActivos.map((item) => (
                <tr key={item.id}>
                  <td>{item.producto.descripcion}</td>
                  <td>{item.cantidad}</td>
                  <td>{formatoCLP(item.precioUnitario)}</td>
                  <td>{formatoCLP(item.subtotal)}</td>
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
                    <th>Anulado por</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsAnulados.map((item) => (
                    <tr key={item.id}>
                      <td>{item.producto.descripcion}</td>
                      <td>{item.cantidad}</td>
                      <td>{item.usuarioAnulacion?.nombre ?? "—"}</td>
                      <td>{item.fechaAnulacion ? new Date(item.fechaAnulacion).toLocaleString("es-CL") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ventaDetalle.descuentoTipo && (
            <p>
              Subtotal: {formatoCLP(itemsActivos.reduce((s, i) => s + i.subtotal, 0))} · Descuento:{" "}
              {ventaDetalle.descuentoTipo === "porcentaje"
                ? `${ventaDetalle.descuentoValor}%`
                : formatoCLP(ventaDetalle.descuentoValor ?? 0)}
            </p>
          )}
          <h2>Total: {formatoCLP(ventaDetalle.total)}</h2>
          <h3>Pagos</h3>
          <ul>
            {ventaDetalle.pagos.map((p) => (
              <li key={p.id}>
                {etiquetaMedio[p.medio] ?? p.medio}
                {p.medio === "credito" ? ` (${p.clienteNombre})` : ""}: {formatoCLP(p.monto)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

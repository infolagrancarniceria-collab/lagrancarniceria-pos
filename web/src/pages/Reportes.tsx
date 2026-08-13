import { useEffect, useState } from "react";
import { api, formatoCLP, type ReporteInventario, type ReportePrecios, type ReporteVentas } from "../api";

const etiquetasMotivo: Record<string, string> = {
  venta: "Venta",
  descarte: "Descarte / merma",
  ajuste: "Ajuste",
};

const etiquetasTipoCambio: Record<string, string> = {
  individual: "Individual",
  masivo_categoria: "Masivo (categoría)",
  masivo_csv: "Masivo (planilla)",
};

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Reportes() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [reporteInventario, setReporteInventario] = useState<ReporteInventario | null>(null);
  const [reportePrecios, setReportePrecios] = useState<ReportePrecios | null>(null);
  const [reporteVentas, setReporteVentas] = useState<ReporteVentas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function cargar() {
    setError(null);
    setCargando(true);
    Promise.all([
      api.reportes.inventario(desde, hasta),
      api.reportes.precios(desde, hasta),
      api.reportes.ventas(desde, hasta),
    ])
      .then(([inv, prec, ventas]) => {
        setReporteInventario(inv);
        setReportePrecios(prec);
        setReporteVentas(ventas);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  return (
    <div>
      <h1>Reportes</h1>
      {error && <p className="error">{error}</p>}

      <div className="fila-inline">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button type="button" onClick={cargar} disabled={cargando}>
          {cargando ? "Cargando..." : "Actualizar reportes"}
        </button>
      </div>

      {reporteVentas && (
        <section className="tarjeta">
          <h2>Ventas</h2>
          <div className="fila-inline">
            <div>
              <strong>Cantidad de ventas:</strong> {reporteVentas.cantidadVentas}
            </div>
            <div>
              <strong>Total vendido:</strong> {formatoCLP(reporteVentas.totalVentas)}
            </div>
          </div>

          <h3>Más vendidos por cantidad</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Cantidad vendida</th>
                <th>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {reporteVentas.masVendidosPorCantidad.map((p) => (
                <tr key={p.productoId}>
                  <td>{p.plu}</td>
                  <td>{p.descripcion}</td>
                  <td>{p.cantidad}</td>
                  <td>{formatoCLP(p.ingreso)}</td>
                </tr>
              ))}
              {reporteVentas.masVendidosPorCantidad.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>Más vendidos por ingreso</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Ingreso</th>
                <th>Cantidad vendida</th>
              </tr>
            </thead>
            <tbody>
              {reporteVentas.masVendidosPorIngreso.map((p) => (
                <tr key={p.productoId}>
                  <td>{p.plu}</td>
                  <td>{p.descripcion}</td>
                  <td>{formatoCLP(p.ingreso)}</td>
                  <td>{p.cantidad}</td>
                </tr>
              ))}
              {reporteVentas.masVendidosPorIngreso.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {reporteInventario && (
        <section className="tarjeta">
          <h2>Inventario</h2>
          <div className="fila-inline">
            <div>
              <strong>Entradas totales:</strong> {reporteInventario.entradasTotal}
            </div>
            <div>
              <strong>Ventas:</strong> {reporteInventario.salidasPorMotivo.venta ?? 0}
            </div>
            <div>
              <strong>Descarte/merma:</strong> {reporteInventario.salidasPorMotivo.descarte ?? 0}
            </div>
            <div>
              <strong>Ajustes:</strong> {reporteInventario.salidasPorMotivo.ajuste ?? 0}
            </div>
          </div>

          <h3>Productos con más merma en el período</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Cantidad descartada</th>
              </tr>
            </thead>
            <tbody>
              {reporteInventario.topMerma.map((m) => (
                <tr key={m.productoId}>
                  <td>{m.plu}</td>
                  <td>{m.descripcion}</td>
                  <td>{m.cantidad}</td>
                </tr>
              ))}
              {reporteInventario.topMerma.length === 0 && (
                <tr>
                  <td colSpan={3}>No hubo descarte/merma registrado en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {reportePrecios && (
        <section className="tarjeta">
          <h2>Precios</h2>
          <div className="fila-inline">
            <div>
              <strong>Total de cambios:</strong> {reportePrecios.totalCambios}
            </div>
            {Object.entries(reportePrecios.porTipo).map(([tipo, cantidad]) => (
              <div key={tipo}>
                <strong>{etiquetasTipoCambio[tipo] ?? tipo}:</strong> {cantidad}
              </div>
            ))}
          </div>

          <h3>Mayores variaciones de precio en el período</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Precio anterior</th>
                <th>Precio nuevo</th>
                <th>Variación</th>
              </tr>
            </thead>
            <tbody>
              {reportePrecios.mayoresCambios.map((c, i) => (
                <tr key={i}>
                  <td>{c.plu}</td>
                  <td>{c.descripcion}</td>
                  <td>{formatoCLP(c.precioAnterior)}</td>
                  <td>{formatoCLP(c.precioNuevo)}</td>
                  <td className={c.variacionPorcentual < 0 ? "exito" : ""}>
                    {c.variacionPorcentual > 0 ? "+" : ""}
                    {c.variacionPorcentual.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {reportePrecios.mayoresCambios.length === 0 && (
                <tr>
                  <td colSpan={5}>No hubo cambios de precio en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

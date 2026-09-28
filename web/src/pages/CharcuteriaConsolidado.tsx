import { useEffect, useState } from "react";
import { api, formatoCLP, type ReporteConsolidado } from "../api";
import ModalAlerta from "../components/ModalAlerta";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CharcuteriaConsolidado() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [reporte, setReporte] = useState<ReporteConsolidado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.charcuteria.reportes
      .consolidado(desde, hasta)
      .then(setReporte)
      .catch((e) => setError(e.message));
  }, [desde, hasta]);

  return (
    <div>
      <h1>Consolidado carnicería / charcutería</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {reporte && (
        <table className="tabla">
          <thead>
            <tr>
              <th>Unidad de negocio</th>
              <th>Cantidad de ventas</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {reporte.porUnidad.map((u) => (
              <tr key={u.codigo}>
                <td>{u.nombre}</td>
                <td>{u.cantidadVentas}</td>
                <td>{formatoCLP(u.total)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Consolidado</strong>
              </td>
              <td>
                <strong>{reporte.consolidado.cantidadVentas}</strong>
              </td>
              <td>
                <strong>{formatoCLP(reporte.consolidado.total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

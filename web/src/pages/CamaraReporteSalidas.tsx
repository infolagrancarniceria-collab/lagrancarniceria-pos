import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type ReporteSalidasCamara } from "../api";
import { useFiltroUrl } from "../hooks/useFiltroUrl";
import ModalAlerta from "../components/ModalAlerta";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Pantalla nueva a pedido del usuario, para calzar con el "Reporte de
// salidas" del sistema que ya usaba su papá: kilos y valor neto egresado
// por destino, más los últimos movimientos, en un rango de fechas.
export default function CamaraReporteSalidas() {
  // En la URL, no en useState suelto — así "← Volver" recupera el mismo
  // rango de fechas al regresar a esta pantalla (ver hooks/useFiltroUrl.ts).
  const [desde, setDesde] = useFiltroUrl("desde", fechaHace(30));
  const [hasta, setHasta] = useFiltroUrl("hasta", hoy());
  const [reporte, setReporte] = useState<ReporteSalidasCamara | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function cargar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const datos = await api.camara.reporteSalidas({ desde, hasta });
      setReporte(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Reporte de salidas</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      <p className="ayuda">
        Los kilos son el control principal. "Cajas distintas" indica cuántas cajas aportaron mercadería a cada
        destino.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={cargar} className="fila-inline">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button type="submit">{cargando ? "Cargando..." : "Actualizar"}</button>
      </form>

      {reporte && (
        <>
          <section className="tarjeta">
            <div className="fila-inline">
              <div>
                <strong>Total egresado:</strong> {reporte.totalKilos.toFixed(3)} kg
              </div>
              <div>
                <strong>Cajas con egresos:</strong> {reporte.cajasDistintas}
              </div>
              <div>
                <strong>Valor neto egresado:</strong> {formatoCLP(reporte.totalValor)}
              </div>
            </div>
          </section>

          <table className="tabla">
            <thead>
              <tr>
                <th>Destino o motivo</th>
                <th>Cajas distintas</th>
                <th>Kilos</th>
                <th>Valor neto</th>
              </tr>
            </thead>
            <tbody>
              {reporte.porDestino.map((d) => (
                <tr key={d.destino}>
                  <td>
                    <b>{d.etiqueta}</b>
                  </td>
                  <td>{d.cajasDistintas}</td>
                  <td>{d.kilos.toFixed(3)}</td>
                  <td>{formatoCLP(d.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ marginTop: "1.5rem" }}>Últimos movimientos</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Caja</th>
                <th>Producto</th>
                <th>Destino</th>
                <th>Kilos</th>
              </tr>
            </thead>
            <tbody>
              {reporte.ultimosMovimientos.length === 0 && (
                <tr>
                  <td colSpan={5}>Todavía no hay egresos registrados en este rango.</td>
                </tr>
              )}
              {reporte.ultimosMovimientos.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.fecha).toLocaleString("es-CL")}</td>
                  <td>
                    <b>{m.numero}</b>
                  </td>
                  <td>{m.producto}</td>
                  <td>{m.etiquetaDestino}</td>
                  <td>{m.kilos.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

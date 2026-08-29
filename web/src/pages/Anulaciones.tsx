import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type ReporteAnulaciones } from "../api";
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

// Pantalla aparte (fuera de "Buscar venta") para ver de un vistazo todos los
// productos anulados y ventas canceladas de un rango de fechas, sin tener
// que abrir venta por venta.
export default function Anulaciones() {
  // En la URL, no en useState suelto — así "← Volver" recupera el mismo
  // rango de fechas al regresar a esta pantalla (ver hooks/useFiltroUrl.ts).
  const [desde, setDesde] = useFiltroUrl("desde", fechaHace(30));
  const [hasta, setHasta] = useFiltroUrl("hasta", hoy());
  const [datos, setDatos] = useState<ReporteAnulaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await api.caja.anulaciones({ desde, hasta });
      setDatos(resultado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Anulaciones</h1>
        <Link to="/caja">Volver a Caja</Link>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={buscar} className="fila-inline">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
      </form>

      <section className="tarjeta">
        <h2>Productos anulados ({datos?.items.length ?? 0})</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Venta</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Motivo</th>
              <th>Anulado por</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.items ?? []).map((item) => (
              <tr key={item.id}>
                <td>{item.fechaAnulacion ? new Date(item.fechaAnulacion).toLocaleString("es-CL") : "—"}</td>
                <td>#{item.venta.id}</td>
                <td>{item.producto.descripcion}</td>
                <td>{item.cantidad}</td>
                <td>{item.motivoAnulacion ?? "—"}</td>
                <td>{item.usuarioAnulacion?.nombre ?? "—"}</td>
              </tr>
            ))}
            {datos && datos.items.length === 0 && (
              <tr>
                <td colSpan={6}>No hay productos anulados en este rango de fechas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="tarjeta">
        <h2>Ventas canceladas ({datos?.ventas.length ?? 0})</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Venta</th>
              <th>Total (antes de cancelar)</th>
              <th>Motivo</th>
              <th>Anulada por</th>
            </tr>
          </thead>
          <tbody>
            {(datos?.ventas ?? []).map((v) => (
              <tr key={v.id}>
                <td>{v.fechaAnulacion ? new Date(v.fechaAnulacion).toLocaleString("es-CL") : "—"}</td>
                <td>#{v.id}</td>
                <td>{formatoCLP(v.total)}</td>
                <td>{v.motivoAnulacion ?? "—"}</td>
                <td>{v.usuarioAnulacion?.nombre ?? "—"}</td>
              </tr>
            ))}
            {datos && datos.ventas.length === 0 && (
              <tr>
                <td colSpan={5}>No hay ventas canceladas en este rango de fechas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type SalidaMayorista } from "../api";
import { useUsuario } from "../context/UsuarioContext";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Pantalla para ver las ventas por mayor registradas desde "Salida de
// cámara" (destino "Venta por mayor") y marcar rápido cuál ya se cobró —
// mismo patrón que "Créditos pendientes" en Caja, pero para este tipo de
// venta aparte (no pasa por el punto de venta normal).
export default function Mayoristas() {
  const { usuario } = useUsuario();

  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [salidas, setSalidas] = useState<SalidaMayorista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [actualizandoId, setActualizandoId] = useState<number | null>(null);

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await api.camara.mayoristas({
        desde,
        hasta,
        estadoPago: soloPendientes ? "pendiente" : undefined,
      });
      setSalidas(resultado);
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

  async function marcar(id: number, estadoPago: "pagado" | "pendiente") {
    if (!usuario) return;
    setActualizandoId(id);
    setError(null);
    try {
      const actualizada = await api.camara.marcarEstadoPagoMayorista(id, estadoPago, usuario.id);
      setSalidas((prev) => prev.map((s) => (s.id === id ? actualizada : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActualizandoId(null);
    }
  }

  const totalPendiente = salidas.filter((s) => s.estadoPago === "pendiente").reduce((acc, s) => acc + s.precioTotal, 0);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Ventas por mayor</h1>
        <Link to="/camara">Volver a Cámara</Link>
      </div>
      {error && <p className="error">{error}</p>}

      <form onSubmit={buscar} className="fila-inline">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label className="fila-inline">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes de pago
        </label>
        <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
      </form>

      {totalPendiente > 0 && (
        <p className="error">Total pendiente de cobro en el rango: {formatoCLP(totalPendiente)}</p>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Cliente</th>
            <th>Cantidad (kg)</th>
            <th>Total</th>
            <th>Estado</th>
            <th>Registró</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {salidas.length === 0 && (
            <tr>
              <td colSpan={8} className="ayuda">
                Sin ventas por mayor en este rango.
              </td>
            </tr>
          )}
          {salidas.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.fecha).toLocaleString("es-CL")}</td>
              <td>{s.producto.descripcion}</td>
              <td>{s.clienteNombre || "—"}</td>
              <td>{s.cantidadKg.toFixed(3)}</td>
              <td>{formatoCLP(s.precioTotal)}</td>
              <td className={s.estadoPago === "pagado" ? "exito" : "error"}>
                {s.estadoPago === "pagado" ? "Pagado" : "Pendiente"}
              </td>
              <td>{s.usuario.nombre}</td>
              <td>
                <button
                  type="button"
                  className="boton"
                  disabled={actualizandoId === s.id}
                  onClick={() => marcar(s.id, s.estadoPago === "pagado" ? "pendiente" : "pagado")}
                >
                  {s.estadoPago === "pagado" ? "Marcar pendiente" : "Marcar pagado"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

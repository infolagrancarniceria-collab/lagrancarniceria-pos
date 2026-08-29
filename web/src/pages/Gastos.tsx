import { useEffect, useState } from "react";
import { api, formatoCLP, type Gasto, type ReporteGastos } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { useFiltroUrl } from "../hooks/useFiltroUrl";
import { TecladoNumerico } from "../components/TecladoNumerico";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const CATEGORIAS_SUGERIDAS = ["Sueldos", "Luz", "Agua", "Arriendo", "Gas", "Insumos de aseo", "Otros"];

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Gastos() {
  const { usuario } = useUsuario();
  // En la URL, no en useState suelto — así "← Volver" recupera el mismo
  // rango de fechas al regresar a esta pantalla (ver hooks/useFiltroUrl.ts).
  const [desde, setDesde] = useFiltroUrl("desde", fechaHace(30));
  const [hasta, setHasta] = useFiltroUrl("hasta", hoy());
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [reporte, setReporte] = useState<ReporteGastos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [categoria, setCategoria] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    api.gastos.listar({ desde, hasta }).then(setGastos).catch((e) => setError(e.message));
    api.gastos.reporte(desde, hasta).then(setReporte).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!usuario) return;
    if (!categoria.trim()) {
      setError("Falta la categoría");
      return;
    }
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    setGuardando(true);
    try {
      await api.gastos.crear({
        categoria: categoria.trim(),
        descripcion: descripcion.trim() || null,
        monto: montoNum,
        usuarioId: usuario.id,
      });
      setMensaje("Gasto registrado");
      mostrarToast("Gasto registrado", `${categoria.trim()}: ${formatoCLP(montoNum)}.`);
      setCategoria("");
      setDescripcion("");
      setMonto("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id: number) {
    const confirmado = window.confirm("¿Eliminar este gasto?");
    if (!confirmado) return;
    try {
      await api.gastos.eliminar(id);
      mostrarToast("Gasto eliminado", undefined, "eliminado");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Gastos generales</h1>
      <p className="ayuda">
        Gastos del negocio que no son compra de mercadería (sueldos, luz, agua, arriendo, etc.) — la mercadería se
        sigue registrando en Inventario.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      <div className="filtros">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {reporte && (
        <div className="tarjeta">
          <h2>Resumen del período</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(reporte.totalPorCategoria).map(([cat, total]) => (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td>{formatoCLP(total)}</td>
                </tr>
              ))}
              {Object.keys(reporte.totalPorCategoria).length === 0 && (
                <tr>
                  <td colSpan={2}>Sin gastos registrados en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
          <p>
            <strong>Total del período:</strong> {formatoCLP(reporte.total)}
          </p>
        </div>
      )}

      <div className="tarjeta">
        <h2>Registrar gasto</h2>
        <form onSubmit={registrar} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <input
            type="text"
            list="categorias-gasto"
            placeholder="Categoría"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          />
          <datalist id="categorias-gasto">
            {CATEGORIAS_SUGERIDAS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            type="text"
            placeholder="Descripción (opcional)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
          <input type="number" min="1" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
          <TecladoNumerico valor={monto} onCambiar={setMonto} />
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar"}
          </button>
        </form>
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Categoría</th>
            <th>Descripción</th>
            <th>Monto</th>
            <th>Registrado por</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {gastos.map((g) => (
            <tr key={g.id}>
              <td>{new Date(g.fecha).toLocaleDateString("es-CL")}</td>
              <td>{g.categoria}</td>
              <td>{g.descripcion ?? "—"}</td>
              <td>{formatoCLP(g.monto)}</td>
              <td>{g.usuario.nombre}</td>
              <td>
                <button type="button" className="boton-quitar-item" title="Eliminar" onClick={() => eliminar(g.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {gastos.length === 0 && (
            <tr>
              <td colSpan={6}>No hay gastos registrados en este período.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

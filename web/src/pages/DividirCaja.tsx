import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion, type SesionCaja, type Venta } from "../api";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

// A un cajero se le puede pasar cerrar la caja antes de medianoche, y
// seguir vendiendo ya en el día siguiente — todo eso queda mezclado en una
// sola SesionCaja, sin forma de separar cuánto vendió cada día en el cierre
// X/Z. Esta pantalla deja elegir una hora de corte (ayudándose de la lista
// de ventas reales, con su hora) y partir la sesión abierta en dos: todo lo
// anterior al corte queda en una sesión nueva, ya cerrada, representando el
// día anterior; la sesión actual sigue abierta pero arranca justo en el
// corte, como si recién se hubiera abierto ahí.
export default function DividirCaja() {
  const navigate = useNavigate();

  const [sesion, setSesion] = useState<SesionCaja | null | undefined>(undefined);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [corte, setCorte] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pidiendoClave, setPidiendoClave] = useState(false);
  const [resultado, setResultado] = useState<{ sesionAnterior: ResumenSesion; sesionActual: ResumenSesion } | null>(null);

  useEffect(() => {
    api.caja
      .sesionActual()
      .then((s) => {
        setSesion(s);
        if (s) return api.caja.buscarVentas({ sesionCajaId: s.id }).then(setVentas);
      })
      .catch((e) => setError(e.message));
  }, []);

  const ventasOrdenadas = useMemo(
    () => [...ventas].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime()),
    [ventas]
  );

  const corteFecha = corte ? new Date(corte) : null;
  const ventasAntes = corteFecha ? ventasOrdenadas.filter((v) => new Date(v.fecha) < corteFecha) : [];
  const ventasDespues = corteFecha ? ventasOrdenadas.filter((v) => new Date(v.fecha) >= corteFecha) : [];

  async function confirmarDivision(usuarioId: number, clave: string) {
    if (!sesion || !corteFecha) return;
    const res = await api.caja.dividirSesion(sesion.id, { corte: corteFecha.toISOString(), usuarioId, clave });
    setResultado(res);
    setPidiendoClave(false);
  }

  if (sesion === undefined) {
    return (
      <div>
        <h1>Dividir caja</h1>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!sesion) {
    return (
      <div>
        <h1>Dividir caja</h1>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        <p className="ayuda">No hay una caja abierta ahora mismo — solo se puede dividir una caja que sigue abierta.</p>
      </div>
    );
  }

  if (resultado) {
    return (
      <div>
        <h1>Caja dividida</h1>
        <div className="tarjeta">
          <h2>Sesión anterior (quedó cerrada)</h2>
          <p>
            <strong>Desde:</strong> {new Date(resultado.sesionAnterior.sesion.fechaApertura).toLocaleString("es-CL")}
            {" — "}
            <strong>hasta:</strong> {new Date(resultado.sesionAnterior.sesion.fechaCierre!).toLocaleString("es-CL")}
          </p>
          <p>
            <strong>Ventas:</strong> {resultado.sesionAnterior.cantidadVentas} ·{" "}
            <strong>Total vendido:</strong> {formatoCLP(resultado.sesionAnterior.totalVentas)}
          </p>
          <p className="ayuda">
            No quedó efectivo contado para esta sesión (es un corte retroactivo, no un cierre real) — si hace falta
            el reporte Z completo de ese día, revísalo en Cuadratura de caja.
          </p>
        </div>
        <div className="tarjeta">
          <h2>Sesión actual (sigue abierta)</h2>
          <p>
            <strong>Arranca:</strong> {new Date(resultado.sesionActual.sesion.fechaApertura).toLocaleString("es-CL")}
          </p>
          <p>
            <strong>Ventas hasta ahora:</strong> {resultado.sesionActual.cantidadVentas} ·{" "}
            <strong>Total vendido:</strong> {formatoCLP(resultado.sesionActual.totalVentas)}
          </p>
        </div>
        <div className="acciones-formulario">
          <button type="button" className="boton boton-primario" onClick={() => navigate("/caja")}>
            Volver a caja
          </button>
          <button type="button" onClick={() => navigate("/caja/sesiones")}>
            Ver historial de cajas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Dividir caja</h1>
      <p className="ayuda">
        Esta caja lleva abierta desde {new Date(sesion.fechaApertura).toLocaleString("es-CL")}. Si se pasó de
        medianoche sin cerrarla, elige la hora en que terminó el día anterior — todo lo vendido antes queda en una
        sesión cerrada aparte, y esta sesión sigue abierta desde esa hora en adelante.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta">
        <label>
          Hora de corte (todo lo anterior a esto es "el día anterior")
          <input type="datetime-local" value={corte} onChange={(e) => setCorte(e.target.value)} />
        </label>

        {corteFecha && (
          <p className="ayuda">
            <strong>{ventasAntes.length}</strong> venta{ventasAntes.length === 1 ? "" : "s"} quedarían en la sesión
            anterior (cerrada) · <strong>{ventasDespues.length}</strong> venta{ventasDespues.length === 1 ? "" : "s"}{" "}
            seguirían en la sesión actual.
          </p>
        )}

        <button
          type="button"
          className="boton boton-primario"
          disabled={!corteFecha || ventasAntes.length === 0}
          onClick={() => setPidiendoClave(true)}
        >
          Dividir caja en esta hora
        </button>
      </div>

      <div className="tarjeta">
        <h2>Ventas de esta sesión, para ayudarte a elegir la hora</h2>
        {ventasOrdenadas.length === 0 ? (
          <p className="ayuda">Todavía no hay ventas confirmadas en esta sesión.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>N° venta</th>
                <th>Fecha y hora</th>
                <th>Canal</th>
                <th>Total</th>
                <th>¿Queda en?</th>
              </tr>
            </thead>
            <tbody>
              {ventasOrdenadas.map((v) => {
                const fecha = new Date(v.fecha);
                const quedaEnAnterior = corteFecha ? fecha < corteFecha : null;
                return (
                  <tr key={v.id}>
                    <td>{v.id}</td>
                    <td>{fecha.toLocaleString("es-CL")}</td>
                    <td>{v.canal}</td>
                    <td>{formatoCLP(v.total)}</td>
                    <td>
                      {quedaEnAnterior == null
                        ? "—"
                        : quedaEnAnterior
                          ? "Sesión anterior"
                          : "Sesión actual"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pidiendoClave && (
        <ModalConfirmarClave
          titulo="Dividir caja"
          descripcion="Se necesita clave de supervisor para dividir una sesión de caja — es un ajuste contable, igual que anular una venta."
          onConfirmar={confirmarDivision}
          onCancelar={() => setPidiendoClave(false)}
        />
      )}
    </div>
  );
}

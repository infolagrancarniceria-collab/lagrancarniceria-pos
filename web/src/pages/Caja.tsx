import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion, type SesionCaja } from "../api";
import ModalAlerta from "../components/ModalAlerta";
import ModalRetiroCaja from "../components/ModalRetiroCaja";
import { mostrarToast } from "../lib/toast";

export default function Caja() {
  const [claveConfigurada, setClaveConfigurada] = useState<boolean | null>(null);
  const [sesion, setSesion] = useState<SesionCaja | null | undefined>(undefined);
  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mostrarRetiro, setMostrarRetiro] = useState(false);

  useEffect(() => {
    api.caja.estadoClave().then((r) => setClaveConfigurada(r.configurada)).catch((e) => setError(e.message));
    api.caja.sesionActual().then(setSesion).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (sesion) {
      api.caja.resumenSesion(sesion.id).then(setResumen).catch((e) => setError(e.message));
    }
  }, [sesion]);

  async function confirmarRetiro(monto: number, motivo: string, usuarioId: number, clave: string) {
    if (!sesion) return;
    await api.caja.registrarRetiro(sesion.id, { monto, motivo, usuarioId, clave });
    setMostrarRetiro(false);
    mostrarToast("Retiro registrado", `${formatoCLP(monto)} — ${motivo}`);
    api.caja.resumenSesion(sesion.id).then(setResumen).catch((e) => setError(e.message));
  }

  if (claveConfigurada === null || sesion === undefined) {
    return (
      <div>
        <h1>Caja</h1>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!claveConfigurada) {
    return (
      <div>
        <h1>Caja</h1>
        <p className="ayuda">
          Antes de usar la caja, hay que configurar la clave de supervisor (se usa para anular productos
          de una venta por error).
        </p>
        <Link to="/caja/configurar-clave" className="boton boton-primario">
          Configurar clave de supervisor
        </Link>
      </div>
    );
  }

  if (!sesion) {
    return (
      <div>
        <h1>Caja</h1>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        <p className="ayuda">No hay una caja abierta ahora mismo.</p>
        <Link to="/caja/abrir" className="boton boton-primario">
          Abrir caja
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Caja abierta</h1>
        <div className="fila-inline" style={{ marginBottom: 0 }}>
          <Link to="/caja/venta" className="boton boton-primario">
            Ir a vender
          </Link>
          <Link to="/caja/cerrar" className="boton">
            Cerrar caja
          </Link>
          <Link to="/caja/sesiones" className="boton">
            Historial de cajas
          </Link>
          <Link to="/caja/creditos" className="boton">
            Créditos pendientes
          </Link>
          <Link to="/caja/buscar" className="boton">
            Buscar venta
          </Link>
          <Link to="/caja/anulaciones" className="boton">
            Anulaciones
          </Link>
          <Link to="/inventario/revisiones" className="boton">
            Revisiones
          </Link>
          <Link to="/comunas" className="boton">
            Comunas de despacho
          </Link>
          <button type="button" onClick={() => setMostrarRetiro(true)}>
            Retiro de caja
          </button>
        </div>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta">
        <p>
          Abierta por <strong>{sesion.usuarioApertura?.nombre}</strong> con fondo fijo de{" "}
          <strong>{formatoCLP(sesion.fondoFijoInicial)}</strong>.
        </p>
        {resumen && (
          <>
            <h2>Resumen del momento (reporte X)</h2>
            <div className="fila-inline">
              <div>
                <strong>Ventas:</strong> {resumen.cantidadVentas}
              </div>
              <div>
                <strong>Total vendido:</strong> {formatoCLP(resumen.totalVentas)}
              </div>
              <div>
                <strong>Efectivo:</strong> {formatoCLP(resumen.totalPorMedio.efectivo ?? 0)}
              </div>
              <div>
                <strong>Tarjeta:</strong> {formatoCLP(resumen.totalPorMedio.tarjeta ?? 0)}
              </div>
              <div>
                <strong>Crédito otorgado hoy:</strong> {formatoCLP(resumen.totalPorMedio.credito ?? 0)}
              </div>
              <div>
                <strong>Cobros de crédito recibidos hoy:</strong> {formatoCLP(resumen.totalCobrosCredito)}
              </div>
              <div>
                <strong>Retiros de caja:</strong> {formatoCLP(resumen.totalRetiros)}
              </div>
            </div>
            {resumen.retiros.length > 0 && (
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Monto</th>
                    <th>Motivo</th>
                    <th>Autorizó</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.retiros.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.fecha).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td>{formatoCLP(r.monto)}</td>
                      <td>{r.motivo}</td>
                      <td>{r.usuarioAutorizo?.nombre ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {mostrarRetiro && <ModalRetiroCaja onConfirmar={confirmarRetiro} onCancelar={() => setMostrarRetiro(false)} />}
    </div>
  );
}

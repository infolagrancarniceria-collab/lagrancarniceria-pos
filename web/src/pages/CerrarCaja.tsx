import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function CerrarCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cerrada, setCerrada] = useState<ResumenSesion | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.caja
      .sesionActual()
      .then((sesion) => {
        if (!sesion) {
          setError("No hay una caja abierta");
          return;
        }
        return api.caja.resumenSesion(sesion.id).then(setResumen);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function cerrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resumen || !usuario) return;
    const contado = Number(efectivoContado);
    if (Number.isNaN(contado) || contado < 0) {
      setError("El efectivo contado debe ser un número mayor o igual a 0");
      return;
    }
    const confirmado = window.confirm("¿Cerrar la caja? No se van a poder registrar más ventas en esta sesión.");
    if (!confirmado) return;
    setGuardando(true);
    try {
      const resultado = await api.caja.cerrarSesion(resumen.sesion.id, {
        efectivoContado: contado,
        usuarioId: usuario.id,
      });
      setCerrada(resultado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (cerrada) {
    const dif = cerrada.diferencia ?? 0;
    return (
      <div>
        <h1>Caja cerrada — reporte Z</h1>
        <div className="tarjeta">
          <p>
            <strong>Cantidad de ventas:</strong> {cerrada.cantidadVentas}
          </p>
          <p>
            <strong>Total vendido:</strong> {formatoCLP(cerrada.totalVentas)}
          </p>
          <p>
            <strong>Efectivo:</strong> {formatoCLP(cerrada.totalPorMedio.efectivo ?? 0)}
          </p>
          <p>
            <strong>Tarjeta:</strong> {formatoCLP(cerrada.totalPorMedio.tarjeta ?? 0)}
          </p>
          <p>
            <strong>Crédito otorgado hoy:</strong> {formatoCLP(cerrada.totalPorMedio.credito ?? 0)}
          </p>
          <p>
            <strong>Cobros de crédito recibidos hoy:</strong> {formatoCLP(cerrada.totalCobrosCredito)}
          </p>
          <p>
            <strong>Efectivo esperado (fondo fijo + ventas en efectivo + cobros de crédito en efectivo):</strong>{" "}
            {formatoCLP(cerrada.efectivoEsperado)}
          </p>
          <p>
            <strong>Efectivo contado:</strong> {formatoCLP(cerrada.sesion.efectivoContado ?? 0)}
          </p>
          <p className={dif === 0 ? "exito" : "error"}>
            <strong>Diferencia:</strong> {formatoCLP(dif)}
            {dif === 0 ? " (cuadra)" : dif > 0 ? " (sobra efectivo)" : " (falta efectivo)"}
          </p>
        </div>
        <button type="button" className="boton boton-primario" onClick={() => navigate("/caja")}>
          Volver a caja
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Cerrar caja</h1>
      {error && <p className="error">{error}</p>}

      {resumen && (
        <div className="tarjeta">
          <h2>Resumen antes de cerrar (reporte X)</h2>
          <p>
            <strong>Fondo fijo inicial:</strong> {formatoCLP(resumen.sesion.fondoFijoInicial)}
          </p>
          <p>
            <strong>Cantidad de ventas:</strong> {resumen.cantidadVentas}
          </p>
          <p>
            <strong>Total vendido:</strong> {formatoCLP(resumen.totalVentas)}
          </p>
          <p>
            <strong>Efectivo:</strong> {formatoCLP(resumen.totalPorMedio.efectivo ?? 0)}
          </p>
          <p>
            <strong>Tarjeta:</strong> {formatoCLP(resumen.totalPorMedio.tarjeta ?? 0)}
          </p>
          <p>
            <strong>Crédito otorgado hoy:</strong> {formatoCLP(resumen.totalPorMedio.credito ?? 0)}
          </p>
          <p>
            <strong>Cobros de crédito recibidos hoy:</strong> {formatoCLP(resumen.totalCobrosCredito)}
          </p>
          <p>
            <strong>Efectivo esperado en caja:</strong> {formatoCLP(resumen.efectivoEsperado)}
          </p>
        </div>
      )}

      <form onSubmit={cerrar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Efectivo contado al cerrar
          <input
            type="number"
            min="0"
            value={efectivoContado}
            onChange={(e) => setEfectivoContado(e.target.value)}
            required
          />
        </label>
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando || !resumen}>
            {guardando ? "Cerrando..." : "Cerrar caja"}
          </button>
        </div>
      </form>
    </div>
  );
}

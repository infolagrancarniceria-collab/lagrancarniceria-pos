import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

export default function CerrarCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [efectivoContado, setEfectivoContado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cerrada, setCerrada] = useState<ResumenSesion | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Ventas que bloquean el cierre (ej. una venta de Caja Online que nunca se
  // confirmó ni se canceló) — se muestran recién cuando "Cerrar caja" falla
  // por eso, para no pedirle la lista de más al servidor en el caso normal.
  const [ventasBloqueantes, setVentasBloqueantes] = useState<Venta[] | null>(null);
  const [cancelandoVentaId, setCancelandoVentaId] = useState<number | null>(null);

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

  function buscarVentasBloqueantes() {
    if (!resumen) return;
    api.caja
      .ventasAbiertasDeSesion(resumen.sesion.id)
      .then(setVentasBloqueantes)
      .catch(() => {
        // Si ni siquiera se pudo traer la lista, se deja el mensaje de error
        // genérico tal cual — no hay nada más que mostrar.
      });
  }

  async function cerrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVentasBloqueantes(null);
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
      buscarVentasBloqueantes();
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarCancelarVentaBloqueante(usuarioId: number, clave: string, motivo?: string) {
    if (cancelandoVentaId == null) return;
    await api.caja.cancelarVenta(cancelandoVentaId, { usuarioId, clave, motivo });
    setCancelandoVentaId(null);
    buscarVentasBloqueantes();
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
            <strong>Transferencias pendientes hoy:</strong> {formatoCLP(cerrada.totalPorMedio.transferencia ?? 0)}
          </p>
          <p>
            <strong>Transferencias confirmadas hoy:</strong> {formatoCLP(cerrada.totalCobrosTransferencia)}
          </p>
          <p>
            <strong>Pedidos web pendientes hoy:</strong> {formatoCLP(cerrada.totalPorMedio.pedido_web ?? 0)}
          </p>
          <p>
            <strong>Pedidos web cobrados hoy:</strong> {formatoCLP(cerrada.totalCobrosPedidoWeb)}
          </p>
          <p>
            <strong>Mayorista pendiente hoy:</strong> {formatoCLP(cerrada.totalPorMedio.mayorista ?? 0)}
          </p>
          <p>
            <strong>Mayorista cobrado hoy:</strong> {formatoCLP(cerrada.totalCobrosMayorista)}
          </p>
          <p>
            <strong>Retiros de caja:</strong> {formatoCLP(cerrada.totalRetiros)}
          </p>
          <p>
            <strong>Ingresos de caja:</strong> {formatoCLP(cerrada.totalIngresos)}
          </p>
          <p>
            <strong>
              Efectivo esperado (fondo fijo + ventas en efectivo + cobros de crédito en efectivo − retiros de caja +
              ingresos de caja):
            </strong>{" "}
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
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

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
            <strong>Transferencias pendientes hoy:</strong> {formatoCLP(resumen.totalPorMedio.transferencia ?? 0)}
          </p>
          <p>
            <strong>Transferencias confirmadas hoy:</strong> {formatoCLP(resumen.totalCobrosTransferencia)}
          </p>
          <p>
            <strong>Pedidos web pendientes hoy:</strong> {formatoCLP(resumen.totalPorMedio.pedido_web ?? 0)}
          </p>
          <p>
            <strong>Pedidos web cobrados hoy:</strong> {formatoCLP(resumen.totalCobrosPedidoWeb)}
          </p>
          <p>
            <strong>Mayorista pendiente hoy:</strong> {formatoCLP(resumen.totalPorMedio.mayorista ?? 0)}
          </p>
          <p>
            <strong>Mayorista cobrado hoy:</strong> {formatoCLP(resumen.totalCobrosMayorista)}
          </p>
          <p>
            <strong>Retiros de caja:</strong> {formatoCLP(resumen.totalRetiros)}
          </p>
          <p>
            <strong>Ingresos de caja:</strong> {formatoCLP(resumen.totalIngresos)}
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

      {ventasBloqueantes && ventasBloqueantes.length > 0 && (
        <div className="tarjeta">
          <h2>Ventas sin terminar que bloquean el cierre</h2>
          <p className="ayuda">
            Confírmalas o cancélalas para poder cerrar la caja. Si en realidad son de otro día (la caja se quedó
            abierta de más), puede ser más rápido{" "}
            <Link to="/caja/dividir">dividir la caja</Link> en vez de cancelar ventas reales.
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>N° venta</th>
                <th>Fecha y hora</th>
                <th>Canal</th>
                <th>Ítems</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ventasBloqueantes.map((v) => (
                <tr key={v.id}>
                  <td>{v.id}</td>
                  <td>{new Date(v.fecha).toLocaleString("es-CL")}</td>
                  <td>
                    {v.canal}
                    {v.esAuxiliar ? " (auxiliar)" : ""}
                  </td>
                  <td>{v.items.length}</td>
                  <td>
                    <button type="button" onClick={() => setCancelandoVentaId(v.id)}>
                      Cancelar esta venta
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelandoVentaId != null && (
        <ModalConfirmarClave
          titulo="Cancelar venta sin terminar"
          descripcion="No se guardará nada de esta venta. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={["Cliente canceló la compra", "Venta duplicada", "Error del cajero", "Venta antigua abandonada"]}
          onConfirmar={confirmarCancelarVentaBloqueante}
          onCancelar={() => setCancelandoVentaId(null)}
        />
      )}
    </div>
  );
}

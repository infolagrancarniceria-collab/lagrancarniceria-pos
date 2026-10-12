import { useEffect, useState } from "react";
import { api, formatoCLP, type MedioCobro, type PagoVenta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { imprimirSilencioso as imprimirVale } from "../lib/imprimir";
import ModalAlerta from "../components/ModalAlerta";
import ComprobantePagoCredito from "../components/ComprobantePagoCredito";

// Mismo mecanismo que Pedidos online pendientes de pago (ver
// PedidosOnlinePendientes.tsx): un PagoVenta con medio "mayorista" queda
// cobrado:false hasta que se registra a mano que el cliente pagó. Se lleva
// en una pantalla separada (en vez de mezclarse con Créditos ni con Pedidos
// online) para que cada canal quede identificable aparte, a pedido del
// dueño.
export default function MayoristasPendientesPago() {
  const { usuario } = useUsuario();
  const [pendientes, setPendientes] = useState<PagoVenta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [comprobante, setComprobante] = useState<PagoVenta | null>(null);

  function cargar() {
    setCargando(true);
    api.caja
      .creditosPendientes("mayorista")
      .then(setPendientes)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  async function cobrar(pago: PagoVenta, medioCobro: MedioCobro) {
    if (!usuario) return;
    setError(null);
    setMensaje(null);
    const confirmado = window.confirm(
      `¿Registrar el cobro de ${formatoCLP(pago.monto)} de la venta mayorista #${pago.ventaId} como ${
        medioCobro === "efectivo" ? "efectivo" : "tarjeta"
      }?`
    );
    if (!confirmado) return;
    try {
      const pagoActualizado = await api.caja.cobrarCredito(pago.id, { medioCobro, usuarioId: usuario.id });
      setMensaje(`Cobro registrado: venta #${pago.ventaId} — ${formatoCLP(pago.monto)}`);
      setComprobante(pagoActualizado);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalPendiente = pendientes.reduce((suma, p) => suma + p.monto, 0);

  return (
    <>
      <div className="no-imprimir">
        <h1>Mayoristas pendientes de pago</h1>
        <p className="ayuda">
          Ventas mayoristas ya confirmadas que todavía no se han cobrado porque el cliente paga después (al recibir,
          o según lo acordado). Regístralas acá apenas se cobren — esa plata se suma al efectivo o tarjeta del día en
          que se cobra, no del día en que se armó la venta.
        </p>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        {mensaje && <p className="exito">{mensaje}</p>}

        {!cargando && pendientes.length > 0 && (
          <p>
            <strong>Total pendiente:</strong> {formatoCLP(totalPendiente)}
          </p>
        )}

        {cargando && <p>Cargando...</p>}

        <table className="tabla">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Monto</th>
              <th>Venta</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.id}>
                <td>{p.clienteNombre ?? "—"}</td>
                <td>{formatoCLP(p.monto)}</td>
                <td>
                  #{p.ventaId} — {p.venta ? formatoCLP(p.venta.total) : ""}
                </td>
                <td>{p.venta ? new Date(p.venta.fecha).toLocaleString("es-CL") : ""}</td>
                <td className="fila-inline">
                  <button type="button" onClick={() => cobrar(p, "efectivo")}>
                    Cobrar en efectivo
                  </button>
                  <button type="button" onClick={() => cobrar(p, "tarjeta")}>
                    Cobrar con tarjeta
                  </button>
                </td>
              </tr>
            ))}
            {!cargando && pendientes.length === 0 && (
              <tr>
                <td colSpan={5}>No hay ventas mayoristas pendientes de pago.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {comprobante && (
        <ComprobantePagoCredito pago={comprobante} onImprimir={imprimirVale} onCerrar={() => setComprobante(null)} />
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, codigoCliente, formatoCLP, type Cliente, type MedioCobro, type PagoVenta } from "../api";
import SelectorCliente from "./SelectorCliente";
import ComprobantePagoCredito from "./ComprobantePagoCredito";
import { imprimirSilencioso } from "../lib/imprimir";

interface Props {
  usuarioId: number;
  onCerrar: () => void;
}

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / (24 * 60 * 60 * 1000));
}

// Acceso rápido desde Punto de Venta para cobrar la deuda de un cliente sin
// pasar por una venta nueva — a pedido del usuario. Antes esto solo se
// podía hacer desde "Créditos pendientes", una pantalla aparte; acá se
// busca directo el cliente y se cobra ahí mismo, con el mismo endpoint que
// ya usa esa pantalla (cobrarCredito).
export default function ModalAbonarCredito({ usuarioId, onCerrar }: Props) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);
  const [creditos, setCreditos] = useState<PagoVenta[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cobrandoId, setCobrandoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  // Pago recién cobrado, guardado solo para imprimir el boucher en
  // segundo plano — a pedido del usuario, igual que el vale de una venta
  // normal (ver ".vale-oculto-hasta-imprimir" en styles.css y el mismo
  // mecanismo en PuntoDeVenta.tsx), para que el cajero se quede en este
  // modal listo para cobrar al siguiente cliente en vez de tener que
  // apretar un botón de imprimir aparte.
  const [pagoParaImprimir, setPagoParaImprimir] = useState<PagoVenta | null>(null);

  useEffect(() => {
    if (!pagoParaImprimir) return;
    imprimirSilencioso().finally(() => setPagoParaImprimir(null));
  }, [pagoParaImprimir]);

  function cargarCreditos() {
    if (!clienteSeleccionado) return;
    setCargando(true);
    api.caja
      .creditosPendientes(undefined, clienteSeleccionado.id)
      .then(setCreditos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    setCreditos([]);
    setMensaje(null);
    cargarCreditos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSeleccionado?.id]);

  async function cobrar(pago: PagoVenta, medioCobro: MedioCobro) {
    setError(null);
    setMensaje(null);
    setCobrandoId(pago.id);
    try {
      const pagoActualizado = await api.caja.cobrarCredito(pago.id, { medioCobro, usuarioId });
      setMensaje(`Cobro registrado: ${formatoCLP(pago.monto)} — imprimiendo boucher...`);
      setPagoParaImprimir(pagoActualizado);
      cargarCreditos();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCobrandoId(null);
    }
  }

  const totalPendiente = creditos.reduce((s, c) => s + c.monto, 0);

  return (
    <div className="modal-fondo">
      <div className="modal-contenido tarjeta">
        <h2>Abonar crédito de un cliente</h2>
        <p className="ayuda">
          Para cobrar una deuda que ya tenía de antes, sin tener que armar una venta nueva — igual que en "Créditos
          pendientes", pero sin salir de Punto de Venta.
        </p>
        {error && <p className="error">{error}</p>}
        {mensaje && <p className="exito">{mensaje}</p>}

        <SelectorCliente seleccionado={clienteSeleccionado} onSeleccionar={setClienteSeleccionado} />

        {clienteSeleccionado && cargando && <p>Buscando deuda pendiente...</p>}

        {clienteSeleccionado && !cargando && creditos.length === 0 && (
          <p className="exito">{clienteSeleccionado.nombre} no tiene créditos ni transferencias pendientes.</p>
        )}

        {clienteSeleccionado && creditos.length > 0 && (
          <>
            <p>
              <strong>Total pendiente:</strong> {formatoCLP(totalPendiente)}
            </p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Medio</th>
                  <th>Monto</th>
                  <th>Venta</th>
                  <th>Días</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {creditos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.medio === "transferencia" ? "Transferencia" : "Crédito"}</td>
                    <td>{formatoCLP(c.monto)}</td>
                    <td>#{c.ventaId}</td>
                    <td>{c.venta ? diasDesde(c.venta.fecha) : "—"}</td>
                    <td className="fila-inline">
                      <button
                        type="button"
                        className="boton-chico"
                        disabled={cobrandoId === c.id}
                        onClick={() => cobrar(c, "efectivo")}
                      >
                        Efectivo
                      </button>
                      <button
                        type="button"
                        className="boton-chico"
                        disabled={cobrandoId === c.id}
                        onClick={() => cobrar(c, "tarjeta")}
                      >
                        Tarjeta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {clienteSeleccionado && (
          <p className="ayuda">
            Código del cliente: {codigoCliente(clienteSeleccionado.id)} — revisa <Link to="/clientes">Clientes</Link>{" "}
            para ver también deuda por pedidos web o venta mayorista.
          </p>
        )}

        <div className="acciones-formulario">
          <button type="button" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="vale-oculto-hasta-imprimir">
        {pagoParaImprimir && <ComprobantePagoCredito pago={pagoParaImprimir} onCerrar={() => {}} />}
      </div>
    </div>
  );
}

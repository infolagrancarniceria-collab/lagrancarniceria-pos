import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import ModalRetiroCaja from "../components/ModalRetiroCaja";
import { mostrarToast } from "../lib/toast";

// Denominaciones reales de billetes y monedas chilenas en circulación — a
// pedido del usuario, para contar la caja al cerrar billete por billete en
// vez de escribir un solo número a ojo. El campo de cada una coincide con
// ArqueoCaja en el servidor (ver server/routes/caja.ts).
const BILLETES: { campo: keyof Desglose; valor: number }[] = [
  { campo: "billetes1000", valor: 1000 },
  { campo: "billetes2000", valor: 2000 },
  { campo: "billetes5000", valor: 5000 },
  { campo: "billetes10000", valor: 10000 },
  { campo: "billetes20000", valor: 20000 },
];
const MONEDAS: { campo: keyof Desglose; valor: number }[] = [
  { campo: "monedas10", valor: 10 },
  { campo: "monedas50", valor: 50 },
  { campo: "monedas100", valor: 100 },
  { campo: "monedas500", valor: 500 },
];

type Desglose = Record<
  "billetes1000" | "billetes2000" | "billetes5000" | "billetes10000" | "billetes20000" | "monedas10" | "monedas50" | "monedas100" | "monedas500",
  string
>;

function desgloseVacio(): Desglose {
  return {
    billetes1000: "",
    billetes2000: "",
    billetes5000: "",
    billetes10000: "",
    billetes20000: "",
    monedas10: "",
    monedas50: "",
    monedas100: "",
    monedas500: "",
  };
}

function totalDesglose(d: Desglose): number {
  return [...BILLETES, ...MONEDAS].reduce((s, { campo, valor }) => s + (Number(d[campo]) || 0) * valor, 0);
}

// Resumen en el orden pedido: TOTAL GENERAL del día primero (para que
// quede clarísimo que una venta a crédito YA cuenta como venta cerrada hoy,
// aunque el dinero no haya entrado todavía), después inicio de caja, venta
// en efectivo, venta con tarjeta, crédito otorgado, ventas por
// transferencia, una sección de Créditos separada y bien visible (otorgado
// hoy vs. pagado hoy, desglosado por efectivo/tarjeta/transferencia — a
// pedido del usuario, porque antes quedaba todo mezclado y no se veía claro
// si un crédito pagado se había registrado), ingresos (detalle + suma),
// retiros (detalle + suma, restado) y "Efectivo esperado en caja" al final.
// El resto de los detalles que ya existían (transferencia de venta directa
// confirmada, pedidos web, mayorista) quedan abajo, sin estorbar lo
// principal.
function ResumenCierre({ resumen, titulo }: { resumen: ResumenSesion; titulo: string }) {
  // ventasPorMedio (no totalPorMedio) para que estas cuatro líneas sumen
  // exacto al TOTAL GENERAL de arriba — ver comentario en
  // calcularResumenSesion (server/routes/caja.ts). totalPorMedio mezcla
  // ventas nuevas con cobros de créditos de otro día, así que usarlo acá
  // hacía que un crédito ya pagado se contara dos veces.
  const ventaEfectivoHoy = resumen.ventasPorMedio.efectivo ?? 0;
  const ventaTarjetaHoy = resumen.ventasPorMedio.tarjeta ?? 0;
  const creditoOtorgado = resumen.ventasPorMedio.credito ?? 0;
  const ventaTransferenciaHoy = resumen.ventasPorMedio.transferencia ?? 0;
  const sumaCuatroLineas = ventaEfectivoHoy + ventaTarjetaHoy + creditoOtorgado + ventaTransferenciaHoy;

  const creditoPagadoEfectivo = resumen.cobrosCreditoPorMedio.efectivo ?? 0;
  const creditoPagadoTarjeta = resumen.cobrosCreditoPorMedio.tarjeta ?? 0;
  const creditoPagadoTransferencia = resumen.cobrosCreditoPorMedio.transferencia ?? 0;
  const creditoCondonado = resumen.cobrosCreditoPorMedio.condonado ?? 0;
  const creditoPagadoTotal = creditoPagadoEfectivo + creditoPagadoTarjeta + creditoPagadoTransferencia;

  return (
    <div className="tarjeta">
      <h2>{titulo}</h2>
      <p style={{ fontSize: "1.2rem" }}>
        <strong>TOTAL GENERAL del día (todas las ventas, cualquier medio de pago):</strong>{" "}
        {formatoCLP(resumen.totalVentas)}
      </p>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Incluye las ventas a crédito recién otorgadas hoy (ya cuentan como venta cerrada, aunque el cliente todavía no
        pague) — por eso puede ser distinto de lo que de verdad entró en plata hoy. Debe sumar exacto con las 4
        líneas de abajo.
      </p>
      <p>
        <strong>Inicio de caja:</strong> {formatoCLP(resumen.sesion.fondoFijoInicial)}
      </p>
      <p>
        <strong>Venta en efectivo:</strong> {formatoCLP(ventaEfectivoHoy)}
      </p>
      <p>
        <strong>Venta con tarjeta (local):</strong> {formatoCLP(ventaTarjetaHoy)}
      </p>
      <p>
        <strong>Crédito otorgado:</strong> {formatoCLP(creditoOtorgado)}
      </p>
      <p>
        <strong>Ventas por transferencia:</strong> {formatoCLP(ventaTransferenciaHoy)}
      </p>
      <p className={sumaCuatroLineas === resumen.totalVentas ? "exito" : "error"} style={{ fontSize: "0.9rem" }}>
        {sumaCuatroLineas === resumen.totalVentas
          ? "✓ Estas 4 líneas suman exacto el TOTAL GENERAL de arriba."
          : `⚠ Estas 4 líneas suman ${formatoCLP(sumaCuatroLineas)}, no calzan con el TOTAL GENERAL (${formatoCLP(resumen.totalVentas)}) — revisa si hay una venta sin medio de pago asignado.`}
      </p>

      <h3>Créditos</h3>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Separado de las ventas del día de arriba — esto es solo para seguir la plata que se fía y la que se cobra
        después, sea del día que sea. "Crédito otorgado hoy" es el mismo número que la línea de arriba (puede
        incluir créditos que ya se pagaron hoy mismo, no necesariamente está todo pendiente).
      </p>
      <p>
        <strong>Crédito otorgado hoy:</strong> {formatoCLP(creditoOtorgado)}
      </p>
      <p>
        <strong>Crédito pagado hoy:</strong> {formatoCLP(creditoPagadoTotal)}
        {creditoPagadoTotal === 0 && <span className="ayuda"> (ningún crédito se cobró hoy)</span>}
      </p>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Ojo: "pagado hoy" puede ser de un crédito otorgado hoy mismo o de otro día — no lo restes de "Crédito
        otorgado hoy" de arriba, son dos cosas distintas que no se cuadran entre sí.
      </p>
      {creditoPagadoTotal > 0 && (
        <ul style={{ marginTop: 0 }}>
          <li>Efectivo: {formatoCLP(creditoPagadoEfectivo)}</li>
          <li>Tarjeta: {formatoCLP(creditoPagadoTarjeta)}</li>
          <li>Transferencia: {formatoCLP(creditoPagadoTransferencia)}</li>
        </ul>
      )}
      {creditoCondonado > 0 && (
        <p className="ayuda">
          Además, se condonó (perdonó, sin cobrar) {formatoCLP(creditoCondonado)} en crédito hoy — no es dinero
          recibido, no suma a nada de arriba.
        </p>
      )}

      <h3>Ingresos de caja — {formatoCLP(resumen.totalIngresos)}</h3>
      {resumen.ingresos.length === 0 ? (
        <p className="ayuda">No hubo ingresos de caja en esta sesión.</p>
      ) : (
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
            {resumen.ingresos.map((i) => (
              <tr key={i.id}>
                <td>{new Date(i.fecha).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</td>
                <td>+{formatoCLP(i.monto)}</td>
                <td>{i.motivo}</td>
                <td>{i.usuarioAutorizo?.nombre ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Retiros de caja — −{formatoCLP(resumen.totalRetiros)}</h3>
      {resumen.retiros.length === 0 ? (
        <p className="ayuda">No hubo retiros de caja en esta sesión.</p>
      ) : (
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
                <td>−{formatoCLP(r.monto)}</td>
                <td>{r.motivo}</td>
                <td>{r.usuarioAutorizo?.nombre ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: "1.15rem" }}>
        <strong>Efectivo esperado en caja:</strong> {formatoCLP(resumen.efectivoEsperado)}
      </p>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Esto es solo la plata física que debería haber en el cajón ahora mismo: fondo inicial + venta en efectivo de
        hoy + crédito pagado hoy en efectivo ({formatoCLP(creditoPagadoEfectivo)}, ver "Créditos" más arriba) +
        ajustes − retiros + ingresos. No es lo mismo que el TOTAL GENERAL de arriba, que incluye tarjeta, crédito
        otorgado (todavía sin cobrar) y transferencia.
      </p>

      <details>
        <summary className="ayuda">Otros detalles (transferencia de venta directa, pedido web, mayorista)</summary>
        <p>
          <strong>Transferencias confirmadas hoy:</strong> {formatoCLP(resumen.totalCobrosTransferencia)}
        </p>
        <p>
          <strong>Pedidos web pendientes hoy:</strong> {formatoCLP(resumen.ventasPorMedio.pedido_web ?? 0)}
        </p>
        <p>
          <strong>Pedidos web cobrados hoy:</strong> {formatoCLP(resumen.totalCobrosPedidoWeb)}
        </p>
        <p>
          <strong>Mayorista pendiente hoy:</strong> {formatoCLP(resumen.ventasPorMedio.mayorista ?? 0)}
        </p>
        <p>
          <strong>Mayorista cobrado hoy:</strong> {formatoCLP(resumen.totalCobrosMayorista)}
        </p>
      </details>
    </div>
  );
}

export default function CerrarCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  const [desglose, setDesglose] = useState<Desglose>(desgloseVacio());
  const [retirandoAlCierre, setRetirandoAlCierre] = useState(false);
  const [retiroAlCierre, setRetiroAlCierre] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cerrada, setCerrada] = useState<ResumenSesion | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Ventas que bloquean el cierre (ej. una venta de Caja Online que nunca se
  // confirmó ni se canceló) — se muestran recién cuando "Cerrar caja" falla
  // por eso, para no pedirle la lista de más al servidor en el caso normal.
  const [ventasBloqueantes, setVentasBloqueantes] = useState<Venta[] | null>(null);
  const [cancelandoVentaId, setCancelandoVentaId] = useState<number | null>(null);

  function cargarResumen(sesionId: number) {
    api.caja.resumenSesion(sesionId).then(setResumen).catch((e) => setError(e.message));
  }

  useEffect(() => {
    api.caja
      .sesionActual()
      .then((sesion) => {
        if (!sesion) {
          setError("No hay una caja abierta");
          return;
        }
        cargarResumen(sesion.id);
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

  const totalContado = totalDesglose(desglose);
  const efectivoContadoFinal = Math.max(0, totalContado - retiroAlCierre);

  async function confirmarRetiroAlCierre(monto: number, motivo: string, usuarioId: number, clave: string) {
    if (!resumen) return;
    const disponible = totalContado - retiroAlCierre;
    if (monto > disponible) {
      throw new Error(`No puedes retirar más de lo contado y disponible (${formatoCLP(disponible)}).`);
    }
    await api.caja.registrarRetiro(resumen.sesion.id, { tipo: "retiro", monto, motivo, usuarioId, clave });
    setRetiroAlCierre((actual) => actual + monto);
    setRetirandoAlCierre(false);
    mostrarToast("Retiro registrado", `${formatoCLP(monto)} — ${motivo}. Queda ${formatoCLP(totalContado - retiroAlCierre - monto)} para el cierre.`);
    cargarResumen(resumen.sesion.id);
  }

  async function cerrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVentasBloqueantes(null);
    if (!resumen || !usuario) return;
    const confirmado = window.confirm("¿Cerrar la caja? No se van a poder registrar más ventas en esta sesión.");
    if (!confirmado) return;
    setGuardando(true);
    try {
      const resultado = await api.caja.cerrarSesion(resumen.sesion.id, {
        efectivoContado: efectivoContadoFinal,
        usuarioId: usuario.id,
        desgloseEfectivo: {
          billetes1000: Number(desglose.billetes1000) || 0,
          billetes2000: Number(desglose.billetes2000) || 0,
          billetes5000: Number(desglose.billetes5000) || 0,
          billetes10000: Number(desglose.billetes10000) || 0,
          billetes20000: Number(desglose.billetes20000) || 0,
          monedas10: Number(desglose.monedas10) || 0,
          monedas50: Number(desglose.monedas50) || 0,
          monedas100: Number(desglose.monedas100) || 0,
          monedas500: Number(desglose.monedas500) || 0,
        },
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
        <ResumenCierre resumen={cerrada} titulo="Resumen del cierre" />
        <div className="tarjeta">
          <p>
            <strong>Efectivo contado:</strong> {formatoCLP(cerrada.sesion.efectivoContado ?? 0)}
          </p>
          <p className={dif === 0 ? "exito" : "error"}>
            <strong>Diferencia:</strong> {formatoCLP(dif)}
            {dif === 0 ? " (cuadra)" : dif > 0 ? " (sobra efectivo)" : " (falta efectivo)"}
          </p>
          <p className="ayuda">
            Lo contado hoy ({formatoCLP(cerrada.sesion.efectivoContado ?? 0)}) queda sugerido como fondo inicial para
            mañana — se puede cambiar al abrir, pero si es distinto va a pedir motivo y clave de supervisor.
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

      {resumen && <ResumenCierre resumen={resumen} titulo="Resumen antes de cerrar (reporte X)" />}

      <form onSubmit={cerrar} onKeyDown={manejarEnterComoTab} className="formulario">
        <h2>Conteo de efectivo al cerrar</h2>
        <p className="ayuda">Marca cuántos billetes y monedas de cada tipo hay en la caja ahora mismo.</p>
        <div className="fila-inline" style={{ flexWrap: "wrap", gap: "1.5rem" }}>
          <div>
            <strong className="ayuda">Billetes</strong>
            <div className="fila-inline">
              {BILLETES.map(({ campo, valor }) => (
                <label key={campo} className="ayuda">
                  {formatoCLP(valor)}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="input-chico"
                    value={desglose[campo]}
                    onChange={(e) => setDesglose((d) => ({ ...d, [campo]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <strong className="ayuda">Monedas</strong>
            <div className="fila-inline">
              {MONEDAS.map(({ campo, valor }) => (
                <label key={campo} className="ayuda">
                  {formatoCLP(valor)}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="input-chico"
                    value={desglose[campo]}
                    onChange={(e) => setDesglose((d) => ({ ...d, [campo]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <p style={{ fontSize: "1.2rem", margin: "0.75rem 0" }}>
          <strong>Total contado:</strong> {formatoCLP(totalContado)}
        </p>

        <div className="acciones-formulario">
          <button type="button" onClick={() => setRetirandoAlCierre(true)} disabled={totalContado <= 0}>
            Hacer un retiro en efectivo antes de cerrar
          </button>
        </div>

        {retiroAlCierre > 0 && (
          <p className="ayuda">
            Se retiraron {formatoCLP(retiroAlCierre)} para dejar en caja fuerte / banco — queda{" "}
            <strong>{formatoCLP(efectivoContadoFinal)}</strong> para el cierre, que se sugiere como fondo inicial
            para mañana.
          </p>
        )}

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando || !resumen}>
            {guardando ? "Cerrando..." : `Cerrar caja con ${formatoCLP(efectivoContadoFinal)}`}
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

      {retirandoAlCierre && (
        <ModalRetiroCaja tipo="retiro" onConfirmar={confirmarRetiroAlCierre} onCancelar={() => setRetirandoAlCierre(false)} />
      )}
    </div>
  );
}

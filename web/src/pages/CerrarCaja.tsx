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
// ArqueoCaja en el servidor (ver server/routes/caja.ts). Orden descendente
// (de mayor a menor), igual que la planilla de arqueo en papel. $5 y $1 se
// agregaron porque la planilla los incluye, aunque casi no circulen.
const BILLETES: { campo: keyof Desglose; valor: number }[] = [
  { campo: "billetes20000", valor: 20000 },
  { campo: "billetes10000", valor: 10000 },
  { campo: "billetes5000", valor: 5000 },
  { campo: "billetes2000", valor: 2000 },
  { campo: "billetes1000", valor: 1000 },
];
const MONEDAS: { campo: keyof Desglose; valor: number }[] = [
  { campo: "monedas500", valor: 500 },
  { campo: "monedas100", valor: 100 },
  { campo: "monedas50", valor: 50 },
  { campo: "monedas10", valor: 10 },
  { campo: "monedas5", valor: 5 },
  { campo: "monedas1", valor: 1 },
];

type Desglose = Record<
  | "billetes1000"
  | "billetes2000"
  | "billetes5000"
  | "billetes10000"
  | "billetes20000"
  | "monedas1"
  | "monedas5"
  | "monedas10"
  | "monedas50"
  | "monedas100"
  | "monedas500",
  string
>;

function desgloseVacio(): Desglose {
  return {
    billetes1000: "",
    billetes2000: "",
    billetes5000: "",
    billetes10000: "",
    billetes20000: "",
    monedas1: "",
    monedas5: "",
    monedas10: "",
    monedas50: "",
    monedas100: "",
    monedas500: "",
  };
}

function totalDesglose(d: Desglose): number {
  return [...BILLETES, ...MONEDAS].reduce((s, { campo, valor }) => s + (Number(d[campo]) || 0) * valor, 0);
}

// Estructura calcada de la planilla de arqueo en papel que usa el local
// ("LA GRAN CARNICERÍA — Arqueo diario de caja"), a pedido del usuario:
// "Venta total del día" / "Total caja del sistema" arriba, "Movimientos en
// efectivo" en el mismo orden exacto de la planilla (fondo → + ventas
// efectivo → + abonos efectivo → − gastos efectivo → − retiros → ±
// corrección → = efectivo esperado), luego "Tarjetas y transferencias".
// "Total caja del sistema" = efectivo esperado, según aclaró el dueño: es
// "todo el resto de movimientos que hubo durante el día" (el resultado de
// sumar/restar todos los movimientos de efectivo), a diferencia de "Venta
// total del día" que es la venta bruta sin importar el medio de pago.
//
// Se agregaron dos líneas que la planilla en papel no tiene: el desglose
// venta-por-medio con su chequeo de que sume exacto al total general
// (ventasPorMedio, no totalPorMedio — ver comentario en
// calcularResumenSesion en server/routes/caja.ts, totalPorMedio mezcla
// ventas nuevas con cobros de otro día) y una sección "Créditos" aparte.
// "Ingresos de caja" tampoco está en la planilla (el sistema permite
// reforzar el cambio a mitad de turno, algo que la planilla en papel no
// contemplaba) — se deja en su lugar natural dentro de "Movimientos en
// efectivo" para que la suma siga llegando exacta a "Efectivo esperado".
function ResumenCierre({ resumen, titulo }: { resumen: ResumenSesion; titulo: string }) {
  const ventaEfectivoHoy = resumen.ventasPorMedio.efectivo ?? 0;
  const ventaTarjetaHoy = resumen.ventasPorMedio.tarjeta ?? 0;
  const creditoOtorgado = resumen.ventasPorMedio.credito ?? 0;
  const ventaTransferenciaHoy = resumen.ventasPorMedio.transferencia ?? 0;
  const sumaCuatroLineas = ventaEfectivoHoy + ventaTarjetaHoy + creditoOtorgado + ventaTransferenciaHoy;

  // "Abonos recibidos en efectivo" de la planilla: cualquier cobro de
  // crédito/transferencia/pedido web/mayorista de OTRO día que se cobró
  // hoy en efectivo — es la diferencia entre el efectivo mezclado
  // (totalPorMedio, incluye esos cobros) y la venta en efectivo pura de hoy
  // (ventasPorMedio, no los incluye).
  const abonosEfectivo = (resumen.totalPorMedio.efectivo ?? 0) - ventaEfectivoHoy;

  const creditoPagadoEfectivo = resumen.cobrosCreditoPorMedio.efectivo ?? 0;
  const creditoPagadoTarjeta = resumen.cobrosCreditoPorMedio.tarjeta ?? 0;
  const creditoPagadoTransferencia = resumen.cobrosCreditoPorMedio.transferencia ?? 0;
  const creditoCondonado = resumen.cobrosCreditoPorMedio.condonado ?? 0;
  const creditoPagadoTotal = creditoPagadoEfectivo + creditoPagadoTarjeta + creditoPagadoTransferencia;

  const gastosEfectivo = resumen.gastosPorMedio.efectivo ?? 0;

  const tarjetasSistema = resumen.totalPorMedio.tarjeta ?? 0;
  const diferenciaTerminal =
    resumen.sesion.totalTerminalTarjetas != null ? resumen.sesion.totalTerminalTarjetas - tarjetasSistema : null;

  return (
    <div className="tarjeta">
      <h2>{titulo}</h2>
      <div className="fila-inline" style={{ flexWrap: "wrap", gap: "2rem" }}>
        <div>
          <p className="ayuda" style={{ margin: 0 }}>
            Venta total del día
          </p>
          <p style={{ fontSize: "1.2rem", margin: 0 }}>
            <strong>{formatoCLP(resumen.totalVentas)}</strong>
          </p>
        </div>
        <div>
          <p className="ayuda" style={{ margin: 0 }}>
            Total caja del sistema (efectivo esperado)
          </p>
          <p style={{ fontSize: "1.2rem", margin: 0 }}>
            <strong>{formatoCLP(resumen.efectivoEsperado)}</strong>
          </p>
        </div>
      </div>
      <p className="ayuda">
        "Venta total del día" incluye las ventas a crédito recién otorgadas hoy (ya cuentan como venta cerrada,
        aunque el cliente todavía no pague) — por eso es distinto de "Total caja del sistema", que es solo el
        resultado de los movimientos de efectivo (ver detalle abajo).
      </p>

      <h3>Desglose de la venta por medio de pago</h3>
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
          ? "✓ Estas 4 líneas suman exacto la venta total del día."
          : `⚠ Estas 4 líneas suman ${formatoCLP(sumaCuatroLineas)}, no calzan con la venta total del día (${formatoCLP(resumen.totalVentas)}) — revisa si hay una venta sin medio de pago asignado.`}
      </p>

      <h3>Movimientos en efectivo</h3>
      <p>
        <strong>Fondo de apertura:</strong> {formatoCLP(resumen.sesion.fondoFijoInicial)}
      </p>
      <p>
        <strong>+ Ventas registradas en efectivo:</strong> {formatoCLP(ventaEfectivoHoy)}
      </p>
      <p>
        <strong>+ Abonos recibidos en efectivo:</strong> {formatoCLP(abonosEfectivo)}
        {abonosEfectivo === 0 && <span className="ayuda"> (ningún crédito/transferencia se cobró en efectivo hoy)</span>}
      </p>
      <p>
        <strong>− Gastos pagados en efectivo:</strong> {formatoCLP(gastosEfectivo)}
        {gastosEfectivo === 0 && <span className="ayuda"> (sin gastos en efectivo hoy)</span>}
      </p>
      <p>
        <strong>− Retiros durante el día:</strong> {formatoCLP(resumen.totalRetiros)}
      </p>
      {resumen.totalIngresos > 0 && (
        <p>
          <strong>+ Ingresos de caja:</strong> {formatoCLP(resumen.totalIngresos)}
        </p>
      )}
      <p>
        <strong>± Corrección de medio de pago:</strong> {formatoCLP(resumen.totalAjustesEfectivo)}
      </p>
      <p style={{ fontSize: "1.1rem" }}>
        <strong>= Efectivo esperado:</strong> {formatoCLP(resumen.efectivoEsperado)}
      </p>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Ej. venta anotada en efectivo y pagada con tarjeta: se corrige acá arriba ("Corrección de medio de pago"), no
        se resta de "Ventas registradas en efectivo".
      </p>

      {resumen.ingresos.length > 0 && (
        <table className="tabla">
          <caption className="ayuda" style={{ textAlign: "left" }}>
            Detalle de ingresos de caja
          </caption>
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

      {resumen.retiros.length > 0 && (
        <table className="tabla">
          <caption className="ayuda" style={{ textAlign: "left" }}>
            Detalle de retiros de caja
          </caption>
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

      <h3>Tarjetas y transferencias</h3>
      <p>
        <strong>Tarjetas en sistema + abonos:</strong> {formatoCLP(tarjetasSistema)}
      </p>
      <p>
        <strong>Total del terminal de tarjetas:</strong>{" "}
        {resumen.sesion.totalTerminalTarjetas != null ? formatoCLP(resumen.sesion.totalTerminalTarjetas) : "—"}
      </p>
      {diferenciaTerminal != null && (
        <p className={diferenciaTerminal === 0 ? "exito" : "error"}>
          <strong>Diferencia (terminal − sistema):</strong> {formatoCLP(diferenciaTerminal)}
        </p>
      )}
      <p>
        <strong>Transferencias (ventas y abonos):</strong> {formatoCLP(resumen.totalPorMedio.transferencia ?? 0)}
      </p>

      <h3>Créditos</h3>
      <p className="ayuda" style={{ marginTop: 0 }}>
        Separado de las ventas del día de arriba — esto es solo para seguir la plata que se fía y la que se cobra
        después, sea del día que sea. "Crédito otorgado hoy" es el mismo número que arriba (puede incluir créditos
        que ya se pagaron hoy mismo, no necesariamente está todo pendiente).
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

      {resumen.totalGastos > 0 && (
        <>
          <h3>Gastos pagados hoy (cualquier medio)</h3>
          <ul style={{ marginTop: 0 }}>
            <li>Efectivo: {formatoCLP(resumen.gastosPorMedio.efectivo ?? 0)}</li>
            <li>Transferencia: {formatoCLP(resumen.gastosPorMedio.transferencia ?? 0)}</li>
            <li>Tarjeta: {formatoCLP(resumen.gastosPorMedio.tarjeta ?? 0)}</li>
          </ul>
          <p className="ayuda" style={{ marginTop: 0 }}>
            Solo el de efectivo se resta del efectivo esperado — los pagados con tarjeta/transferencia no salieron
            del cajón.
          </p>
        </>
      )}

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
  // Total del terminal de tarjetas y observaciones — igual que la planilla
  // de arqueo en papel. Ambos opcionales: el terminal se escribe a mano (el
  // sistema no tiene forma de leerlo automático) y las observaciones son
  // notas libres.
  const [terminalTarjetas, setTerminalTarjetas] = useState("");
  const [observaciones, setObservaciones] = useState("");
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
          monedas1: Number(desglose.monedas1) || 0,
          monedas5: Number(desglose.monedas5) || 0,
          monedas10: Number(desglose.monedas10) || 0,
          monedas50: Number(desglose.monedas50) || 0,
          monedas100: Number(desglose.monedas100) || 0,
          monedas500: Number(desglose.monedas500) || 0,
        },
        ...(terminalTarjetas.trim() ? { totalTerminalTarjetas: Number(terminalTarjetas) } : {}),
        ...(observaciones.trim() ? { observacionesCierre: observaciones.trim() } : {}),
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
    const faltante = dif < 0 ? -dif : 0;
    const porcentajePerdida = faltante > 0 && cerrada.totalVentas > 0 ? (faltante / cerrada.totalVentas) * 100 : 0;
    return (
      <div>
        <h1>Caja cerrada — reporte Z</h1>
        <ResumenCierre resumen={cerrada} titulo="Resumen del cierre" />

        <div className="tarjeta">
          <h2>Resultado del cierre</h2>
          <p>
            <strong>Efectivo contado:</strong> {formatoCLP(cerrada.sesion.efectivoContado ?? 0)}
          </p>
          <p className={dif === 0 ? "exito" : "error"}>
            <strong>Diferencia (efectivo contado − efectivo esperado):</strong> {formatoCLP(dif)}
            {dif === 0 ? " (cuadra)" : dif > 0 ? " (sobra efectivo)" : " (falta efectivo)"}
          </p>
          {faltante > 0 && (
            <>
              <p className="error">
                <strong>Faltante de efectivo:</strong> {formatoCLP(faltante)}
              </p>
              <p>
                <strong>% de pérdida sobre ventas:</strong> {porcentajePerdida.toFixed(2)}%
              </p>
              <p className="ayuda" style={{ marginTop: 0 }}>
                Faltante ÷ venta total del día × 100.
              </p>
            </>
          )}
        </div>

        <div className="tarjeta">
          <h2>Depósito y fondo para mañana</h2>
          <p>
            <strong>Retiro para depositar en el banco:</strong> {formatoCLP(retiroAlCierre)}
          </p>
          <p>
            <strong>Fondo para mañana (efectivo contado menos retiro):</strong>{" "}
            {formatoCLP(cerrada.sesion.efectivoContado ?? 0)}
          </p>
          <p className="ayuda" style={{ marginTop: 0 }}>
            Queda sugerido como fondo inicial para mañana — se puede cambiar al abrir, pero si es distinto va a
            pedir motivo y clave de supervisor.
          </p>
        </div>

        {cerrada.sesion.observacionesCierre && (
          <div className="tarjeta">
            <h2>Observaciones</h2>
            <p>{cerrada.sesion.observacionesCierre}</p>
          </div>
        )}

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

        <h2>Tarjetas y transferencias</h2>
        <p className="ayuda">
          El sistema registró {resumen ? formatoCLP(resumen.totalPorMedio.tarjeta ?? 0) : "—"} en tarjetas (ventas +
          abonos). Escribe el total que marca el terminal físico para comparar.
        </p>
        <label>
          Total del terminal de tarjetas
          <input
            type="number"
            min="0"
            className="input-chico"
            value={terminalTarjetas}
            onChange={(e) => setTerminalTarjetas(e.target.value)}
            placeholder="Opcional"
          />
        </label>
        {terminalTarjetas.trim() && resumen && (
          <p className={Number(terminalTarjetas) === (resumen.totalPorMedio.tarjeta ?? 0) ? "exito" : "error"}>
            Diferencia (terminal − sistema): {formatoCLP(Number(terminalTarjetas) - (resumen.totalPorMedio.tarjeta ?? 0))}
          </p>
        )}

        <h2>Observaciones</h2>
        <label>
          Notas de este cierre (opcional)
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Ej. faltó anotar una venta, el terminal se trabó, etc."
            rows={3}
          />
        </label>

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

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatoCLP, type ResumenSesion, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import ModalRetiroCaja from "../components/ModalRetiroCaja";
import { mostrarToast } from "../lib/toast";
import { imprimirCierreCaja, imprimirSilencioso } from "../lib/imprimir";

// Recuadro de una sola cifra — a pedido del usuario, para poder
// identificar de un vistazo qué números importan en vez de leer un
// párrafo tras otro. "tono" decide el color: "exito"/"error" para una
// cifra que de verdad está bien o mal (ej. si algo cuadra o no), "neutro"
// (el default) para una cifra puramente informativa.
function MetricaBox({
  etiqueta,
  valor,
  tono = "neutro",
  nota,
}: {
  etiqueta: string;
  valor: string;
  tono?: "exito" | "error" | "neutro";
  nota?: string;
}) {
  return (
    <div className={`recuadro-metrica${tono !== "neutro" ? ` ${tono}` : ""}`}>
      <span className="recuadro-metrica-etiqueta">{etiqueta}</span>
      <span className="recuadro-metrica-valor">{valor}</span>
      {nota && (
        <p className="ayuda recuadro-metrica-nota" style={{ margin: 0 }}>
          {nota}
        </p>
      )}
    </div>
  );
}

// Segundo reseteo a pedido del usuario — esta vez en tres recuadros bien
// separados: "Informes Totales" (boleta inicial/final y venta total del
// período, sin importar medio de pago), "Medios de Pago" (desglose de esa
// misma venta total por efectivo/tarjeta/transferencia/crédito simple —
// el total de este recuadro es el mismo de arriba, porque acá NO entran
// fondo fijo, retiros ni ingresos) y "Resumen de movimientos del día"
// (venta total + fondo fijo + abonos − retiros reales + ingresos = Total
// esperado, el número contra el que se compara lo contado a mano). Los
// gastos siguen totalmente fuera de cualquier cálculo de caja (ver
// Gasto.esGastoNegocio): si sale plata física por cualquier motivo, debe
// quedar registrada como "Retiro", no como "Gasto".
//
// Valores derivados del resumen que se repiten entre el cálculo rápido y el
// detalle completo — se calculan una sola vez y se usan en los dos
// componentes de más abajo (ResumenCierre e InformeCierreBoleta).
function derivarCifras(resumen: ResumenSesion) {
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
  // "Abonos recibidos" — pagos de créditos pendientes de cualquier día
  // (hoy u otro) que se cobraron hoy, de cualquier medio de pago.
  const creditoPagadoTotal = creditoPagadoEfectivo + creditoPagadoTarjeta + creditoPagadoTransferencia;

  const tarjetasSistema = resumen.totalPorMedio.tarjeta ?? 0;
  const diferenciaTerminal =
    resumen.sesion.totalTerminalTarjetas != null ? resumen.sesion.totalTerminalTarjetas - tarjetasSistema : null;

  // "Total esperado" del resumen de movimientos: fondo fijo + venta total
  // (efectivo + tarjeta + transferencia + crédito otorgado) + abonos
  // recibidos − retiros REALES + ingresos. "Reales" excluye el retiro que
  // se hace justo antes de cerrar para ir al banco (RetiroCaja.esDepositoBanco)
  // — a pedido del usuario, esa plata sigue siendo de la empresa, solo
  // cambia de lugar, y recién se decide cuánto retirar DESPUÉS de ver este
  // total (ver "Hacer un retiro antes de cerrar" más abajo).
  const totalRetirosReales = resumen.totalRetirosReales;
  const totalEsperado =
    resumen.sesion.fondoFijoInicial + resumen.totalVentas + creditoPagadoTotal - totalRetirosReales + resumen.totalIngresos;

  return {
    ventaEfectivoHoy,
    ventaTarjetaHoy,
    creditoOtorgado,
    ventaTransferenciaHoy,
    sumaCuatroLineas,
    abonosEfectivo,
    creditoPagadoEfectivo,
    creditoPagadoTarjeta,
    creditoPagadoTransferencia,
    creditoCondonado,
    creditoPagadoTotal,
    tarjetasSistema,
    diferenciaTerminal,
    totalRetirosReales,
    totalEsperado,
  };
}

// Comparación "real vs esperado" al cerrar — a pedido del usuario, ya no
// se muestra un "Efectivo esperado en caja" aparte: ahora se compara lo
// que de verdad se verificó (efectivo contado a mano + lo que marca el
// terminal de tarjetas + lo que el sistema registró en transferencias,
// que no se verifica a mano porque ya queda marcado en la venta misma)
// contra el "Total esperado" del resumen de movimientos. La diferencia se
// expresa como % de utilidad o pérdida sobre la venta total del día.
// efectivoContado va SIEMPRE bruto (antes de cualquier retiro para el
// banco) — esa decisión se toma después de ver este número, no antes.
function calcularVerificacion(
  resumen: ResumenSesion,
  c: ReturnType<typeof derivarCifras>,
  efectivoContadoBruto: number,
  terminalTarjetas: number | null
) {
  const transferenciaSistema = resumen.totalPorMedio.transferencia ?? 0;
  const terminalUsado = terminalTarjetas ?? c.tarjetasSistema;
  const totalReal = efectivoContadoBruto + terminalUsado + transferenciaSistema;
  const diferencia = totalReal - c.totalEsperado;
  const porcentaje = resumen.totalVentas > 0 ? (diferencia / resumen.totalVentas) * 100 : 0;
  return { transferenciaSistema, totalReal, diferencia, porcentaje };
}

// Segundo reseteo a pedido del usuario: tres recuadros bien separados y
// nombrados — "Informes Totales" (boleta inicial/final y venta total del
// período), "Medios de Pago" (esa misma venta desglosada por
// efectivo/tarjeta/transferencia/crédito simple, mismo total que arriba
// porque acá no entran fondo fijo/retiros/ingresos) y "Resumen de
// movimientos del día" (venta total + fondo fijo + abonos − retiros
// reales + ingresos = Total esperado). Todo lo demás (tarjetas vs
// terminal, créditos) queda plegado detrás de "Ver todo el detalle". Al
// imprimir, las secciones plegadas se muestran completas sin importar si
// están abiertas en pantalla — ver ".seccion-opcional-cerrada" en
// styles.css.
function ResumenCierre({ resumen, titulo }: { resumen: ResumenSesion; titulo: string }) {
  const [verDetalle, setVerDetalle] = useState(false);
  const c = derivarCifras(resumen);
  const retiroBancario = resumen.totalRetiroBancario;

  return (
    <div className="tarjeta">
      <h2>{titulo}</h2>

      <h3 style={{ marginTop: 0 }}>Informes Totales</h3>
      <div className="grilla-metricas">
        <MetricaBox
          etiqueta="Venta inicial"
          valor={resumen.boletaInicial != null ? `N° ${resumen.boletaInicial} — ${formatoCLP(resumen.montoBoletaInicial ?? 0)}` : "—"}
        />
        <MetricaBox
          etiqueta="Venta final"
          valor={resumen.boletaFinal != null ? `N° ${resumen.boletaFinal} — ${formatoCLP(resumen.montoBoletaFinal ?? 0)}` : "—"}
        />
        <MetricaBox etiqueta="Venta total del período" valor={formatoCLP(resumen.totalVentas)} />
      </div>

      <h3>Medios de Pago</h3>
      <table className="lista-calculo">
        <tbody>
          <tr>
            <td>Efectivo</td>
            <td>{formatoCLP(c.ventaEfectivoHoy)}</td>
          </tr>
          <tr>
            <td>Tarjeta</td>
            <td>{formatoCLP(c.ventaTarjetaHoy)}</td>
          </tr>
          <tr>
            <td>Transferencia</td>
            <td>{formatoCLP(c.ventaTransferenciaHoy)}</td>
          </tr>
          <tr>
            <td>Crédito simple</td>
            <td>{formatoCLP(c.creditoOtorgado)}</td>
          </tr>
          <tr className="lista-calculo-total">
            <td>Total</td>
            <td>{formatoCLP(c.sumaCuatroLineas)}</td>
          </tr>
        </tbody>
      </table>
      {c.sumaCuatroLineas !== resumen.totalVentas && (
        <p className="error" style={{ margin: "0.3rem 0 0" }}>
          ⚠ Efectivo + tarjeta + transferencia + crédito simple suman {formatoCLP(c.sumaCuatroLineas)}, no calzan
          con la venta total del período ({formatoCLP(resumen.totalVentas)}) — revisa si hay una venta sin medio de
          pago asignado.
        </p>
      )}

      <h3>Resumen de movimientos del día</h3>
      <table className="lista-calculo">
        <tbody>
          <tr>
            <td>Venta total</td>
            <td>{formatoCLP(resumen.totalVentas)}</td>
          </tr>
          <tr>
            <td>+ Fondo fijo</td>
            <td>{formatoCLP(resumen.sesion.fondoFijoInicial)}</td>
          </tr>
          <tr>
            <td>
              + Abonos (créditos pendientes pagados)
              {c.creditoPagadoTotal === 0 && <span className="ayuda"> (ningún crédito se cobró hoy)</span>}
            </td>
            <td>{formatoCLP(c.creditoPagadoTotal)}</td>
          </tr>
          <tr>
            <td>− Retiros</td>
            <td>{formatoCLP(c.totalRetirosReales)}</td>
          </tr>
          <tr>
            <td>+ Ingresos</td>
            <td>{formatoCLP(resumen.totalIngresos)}</td>
          </tr>
          <tr className="lista-calculo-total">
            <td>= Total esperado</td>
            <td>{formatoCLP(c.totalEsperado)}</td>
          </tr>
        </tbody>
      </table>
      {retiroBancario > 0 && (
        <p className="ayuda" style={{ margin: "0.3rem 0 0" }}>
          No incluye el retiro para depositar en el banco ({formatoCLP(retiroBancario)}) — esa plata sigue siendo de
          la empresa, solo cambia de lugar. Se ve en "Depósito y fondo para mañana".
        </p>
      )}

      <button
        type="button"
        className="boton-desplegable ayuda"
        style={{ marginTop: "0.75rem" }}
        onClick={() => setVerDetalle((v) => !v)}
      >
        {verDetalle
          ? "▲ Ocultar todo el detalle"
          : "▼ Ver todo el detalle (tarjetas, créditos)"}
      </button>

      <div className={verDetalle ? "" : "seccion-opcional-cerrada"}>
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
                  <td>{r.esDepositoBanco ? "" : "−"}{formatoCLP(r.monto)}</td>
                  <td>
                    {r.motivo}
                    {r.esDepositoBanco && <span className="ayuda"> (depósito a banco, no resta del resumen)</span>}
                  </td>
                  <td>{r.usuarioAutorizo?.nombre ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Tarjetas y transferencias</h3>
        <div className="grilla-metricas">
          <MetricaBox etiqueta="Tarjetas en sistema + abonos" valor={formatoCLP(c.tarjetasSistema)} />
          <MetricaBox
            etiqueta="Total del terminal de tarjetas"
            valor={resumen.sesion.totalTerminalTarjetas != null ? formatoCLP(resumen.sesion.totalTerminalTarjetas) : "—"}
          />
          {c.diferenciaTerminal != null && (
            <MetricaBox
              etiqueta="Diferencia (terminal − sistema)"
              valor={formatoCLP(c.diferenciaTerminal)}
              tono={c.diferenciaTerminal === 0 ? "exito" : "error"}
            />
          )}
          <MetricaBox etiqueta="Transferencias (ventas y abonos)" valor={formatoCLP(resumen.totalPorMedio.transferencia ?? 0)} />
        </div>

        <h3>Créditos</h3>
        <p className="ayuda" style={{ marginTop: 0 }}>
          Separado de las ventas del día de arriba — esto es solo para seguir la plata que se fía y la que se cobra
          después, sea del día que sea. "Crédito otorgado hoy" es el mismo número que arriba (puede incluir créditos
          que ya se pagaron hoy mismo, no necesariamente está todo pendiente). Ojo: "pagado hoy" puede ser de un
          crédito otorgado hoy mismo o de otro día — no se restan entre sí.
        </p>
        <div className="grilla-metricas">
          <MetricaBox etiqueta="Crédito otorgado hoy" valor={formatoCLP(c.creditoOtorgado)} />
          <MetricaBox
            etiqueta="Crédito pagado hoy"
            valor={formatoCLP(c.creditoPagadoTotal)}
            nota={c.creditoPagadoTotal === 0 ? "Ningún crédito se cobró hoy" : undefined}
          />
        </div>
        {c.creditoPagadoTotal > 0 && (
          <table className="lista-calculo">
            <tbody>
              <tr>
                <td>Efectivo</td>
                <td>{formatoCLP(c.creditoPagadoEfectivo)}</td>
              </tr>
              <tr>
                <td>Tarjeta</td>
                <td>{formatoCLP(c.creditoPagadoTarjeta)}</td>
              </tr>
              <tr>
                <td>Transferencia</td>
                <td>{formatoCLP(c.creditoPagadoTransferencia)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {c.creditoCondonado > 0 && (
          <p className="ayuda">
            Además, se condonó (perdonó, sin cobrar) {formatoCLP(c.creditoCondonado)} en crédito hoy — no es dinero
            recibido, no suma a nada de arriba.
          </p>
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
    </div>
  );
}

// Informe de cierre en formato boleta (rollo térmico de 80mm) — a pedido
// del usuario, para poder imprimirlo igual que cualquier vale, calcado de
// un "informe de totales" de terminal de pago (ver imprimirBoleta en
// CerrarCaja). Oculto en pantalla, visible solo al imprimir (ver
// ".informe-cierre-boleta" en styles.css).
function InformeCierreBoleta({
  resumen,
  efectivoContadoBruto,
  terminalTarjetas,
}: {
  resumen: ResumenSesion;
  efectivoContadoBruto: number | null;
  terminalTarjetas: number | null;
}) {
  const c = derivarCifras(resumen);
  const v = efectivoContadoBruto != null ? calcularVerificacion(resumen, c, efectivoContadoBruto, terminalTarjetas) : null;
  return (
    <div className="vale informe-cierre-boleta">
      <h2>La Gran Carnicería</h2>
      <p>Informe de cierre de caja</p>
      <p>
        {new Date(resumen.sesion.fechaApertura).toLocaleDateString("es-CL")}
        {resumen.sesion.fechaCierre
          ? ` — cerrada ${new Date(resumen.sesion.fechaCierre).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
      </p>

      <h3>Informes Totales</h3>
      <table className="lista-calculo">
        <tbody>
          <tr>
            <td>Venta inicial</td>
            <td>
              {resumen.boletaInicial != null
                ? `N° ${resumen.boletaInicial} — ${formatoCLP(resumen.montoBoletaInicial ?? 0)}`
                : "—"}
            </td>
          </tr>
          <tr>
            <td>Venta final</td>
            <td>
              {resumen.boletaFinal != null
                ? `N° ${resumen.boletaFinal} — ${formatoCLP(resumen.montoBoletaFinal ?? 0)}`
                : "—"}
            </td>
          </tr>
          <tr className="lista-calculo-total">
            <td>Venta total del período</td>
            <td>{formatoCLP(resumen.totalVentas)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Medios de Pago</h3>
      <table className="lista-calculo">
        <tbody>
          <tr>
            <td>Efectivo</td>
            <td>{formatoCLP(c.ventaEfectivoHoy)}</td>
          </tr>
          <tr>
            <td>Tarjeta</td>
            <td>{formatoCLP(c.ventaTarjetaHoy)}</td>
          </tr>
          <tr>
            <td>Transferencia</td>
            <td>{formatoCLP(c.ventaTransferenciaHoy)}</td>
          </tr>
          <tr>
            <td>Crédito simple</td>
            <td>{formatoCLP(c.creditoOtorgado)}</td>
          </tr>
          <tr className="lista-calculo-total">
            <td>Total</td>
            <td>{formatoCLP(c.sumaCuatroLineas)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Resumen de movimientos del día</h3>
      <table className="lista-calculo">
        <tbody>
          <tr>
            <td>Venta total</td>
            <td>{formatoCLP(resumen.totalVentas)}</td>
          </tr>
          <tr>
            <td>+ Fondo fijo</td>
            <td>{formatoCLP(resumen.sesion.fondoFijoInicial)}</td>
          </tr>
          <tr>
            <td>+ Abonos</td>
            <td>+{formatoCLP(c.creditoPagadoTotal)}</td>
          </tr>
          <tr>
            <td>− Retiros</td>
            <td>−{formatoCLP(c.totalRetirosReales)}</td>
          </tr>
          <tr>
            <td>+ Ingresos</td>
            <td>+{formatoCLP(resumen.totalIngresos)}</td>
          </tr>
          <tr className="lista-calculo-total">
            <td>= Total esperado</td>
            <td>{formatoCLP(c.totalEsperado)}</td>
          </tr>
        </tbody>
      </table>

      {v && (
        <>
          <h3>Verificación de caja</h3>
          <table className="lista-calculo">
            <tbody>
              <tr>
                <td>Efectivo contado</td>
                <td>{formatoCLP(efectivoContadoBruto ?? 0)}</td>
              </tr>
              <tr>
                <td>Terminal de tarjetas</td>
                <td>{formatoCLP(terminalTarjetas ?? c.tarjetasSistema)}</td>
              </tr>
              <tr>
                <td>Transferencia (sistema)</td>
                <td>{formatoCLP(v.transferenciaSistema)}</td>
              </tr>
              <tr className="lista-calculo-total">
                <td>Total real</td>
                <td>{formatoCLP(v.totalReal)}</td>
              </tr>
              <tr>
                <td>Total esperado</td>
                <td>{formatoCLP(c.totalEsperado)}</td>
              </tr>
              <tr className="lista-calculo-total">
                <td>Diferencia</td>
                <td>{formatoCLP(v.diferencia)}</td>
              </tr>
              <tr>
                <td>% de utilidad o pérdida</td>
                <td>{v.porcentaje.toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <p>
        Cerró: {resumen.sesion.usuarioCierre?.nombre ?? resumen.sesion.usuarioApertura?.nombre ?? "—"}
      </p>
    </div>
  );
}

// Posibles explicaciones para un faltante/sobrante al cerrar — a pedido
// del usuario, para orientar en vez de dejar la diferencia sin ninguna
// pista de por dónde empezar a buscar.
function posiblesCausas(diferencia: number): string[] {
  if (diferencia < 0) {
    return [
      "Crédito simple otorgado hoy que todavía no se cobra — es normal que reste del total esperado hasta que se pague (revisa cuánto crédito simple queda pendiente).",
      "Plata que salió del cajón sin registrarse como \"Retiro\" (ej. se pagó algo en efectivo directo de la caja, incluido un gasto familiar — eso ya no se descuenta solo, hay que registrarlo como retiro).",
      "Un vuelto entregado de más, o un error al contar el efectivo.",
      "Una venta cobrada en efectivo pero registrada con otro medio de pago (revisa las correcciones de medio de pago).",
      "El terminal de tarjetas marca menos que lo que el sistema registró.",
    ];
  }
  return [
    "Un cliente pagó de más y no se le dio el vuelto correcto.",
    "Una venta registrada con otro medio de pago, pero cobrada en efectivo de verdad.",
    "Un ingreso de caja que no quedó registrado en el sistema.",
    "Error al contar el efectivo (de más), o el terminal de tarjetas marca más que lo que el sistema registró.",
  ];
}

export default function CerrarCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [resumen, setResumen] = useState<ResumenSesion | null>(null);
  // Efectivo contado — a pedido del usuario, ahora es un solo monto escrito
  // a mano (ya no billete por billete). Va SIEMPRE bruto, antes de
  // cualquier retiro para el banco: la cuadratura real se ve primero, y
  // recién después se decide cuánto retirar (ver "Hacer un retiro antes de
  // cerrar" más abajo).
  const [efectivoContado, setEfectivoContado] = useState("");
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
  // Mientras se imprime en formato boleta (80mm), el reporte en hoja
  // grande se oculta de ese trabajo de impresión puntual — ver
  // ".cierre-caja-hoja.no-imprimir-boleta" en styles.css.
  const [imprimiendoBoleta, setImprimiendoBoleta] = useState(false);
  // % de utilidad/pérdida, explicación y posibles causas del descuadre — a
  // pedido del usuario, quedan plegados detrás de "ver más" en vez de
  // siempre a la vista.
  const [verMasResultado, setVerMasResultado] = useState(false);

  async function imprimirHojaGrande() {
    try {
      await imprimirCierreCaja();
    } catch {
      setError("No se pudo imprimir — revisa la impresora configurada en Configuración → Impresoras (Pedidos web).");
    }
  }

  async function imprimirBoleta() {
    setImprimiendoBoleta(true);
    try {
      await imprimirSilencioso();
    } catch {
      setError("No se pudo imprimir — revisa la impresora configurada en Configuración → Impresoras (Boletas).");
    } finally {
      setTimeout(() => setImprimiendoBoleta(false), 500);
    }
  }

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

  const totalContado = Number(efectivoContado) || 0;
  const efectivoContadoFinal = Math.max(0, totalContado - retiroAlCierre);
  const terminalTarjetasNum = terminalTarjetas.trim() ? Number(terminalTarjetas) : null;
  const c = resumen ? derivarCifras(resumen) : null;
  const verificacion = resumen && c ? calcularVerificacion(resumen, c, totalContado, terminalTarjetasNum) : null;

  async function confirmarRetiroAlCierre(monto: number, motivo: string, usuarioId: number, clave: string) {
    if (!resumen) return;
    const disponible = totalContado - retiroAlCierre;
    if (monto > disponible) {
      throw new Error(`No puedes retirar más de lo contado y disponible (${formatoCLP(disponible)}).`);
    }
    await api.caja.registrarRetiro(resumen.sesion.id, {
      tipo: "retiro",
      monto,
      motivo,
      usuarioId,
      clave,
      esDepositoBanco: true,
    });
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
    // Efectivo contado BRUTO (antes del retiro para el banco) — se
    // reconstruye sumando de vuelta lo que se retiró marcado
    // esDepositoBanco, para que la verificación post-cierre dé el mismo
    // número que se vio en vivo antes de cerrar (ver derivarCifras y
    // calcularVerificacion más arriba).
    const cBruto = cerrada.sesion.efectivoContado != null ? cerrada.sesion.efectivoContado + cerrada.totalRetiroBancario : 0;
    const cCerrada = derivarCifras(cerrada);
    const v = calcularVerificacion(cerrada, cCerrada, cBruto, cerrada.sesion.totalTerminalTarjetas);
    const dif = v.diferencia;
    return (
      <div>
        <div className="encabezado-pantalla no-imprimir">
          <h1>Caja cerrada — reporte Z</h1>
          <div className="fila-inline" style={{ marginBottom: 0 }}>
            <button type="button" className="boton boton-primario" onClick={imprimirHojaGrande}>
              Imprimir (hoja grande)
            </button>
            <button type="button" onClick={imprimirBoleta}>
              Imprimir boleta
            </button>
          </div>
        </div>

        <div className={`cierre-caja-hoja${imprimiendoBoleta ? " no-imprimir-boleta" : ""}`}>
          <ResumenCierre resumen={cerrada} titulo="Resumen del cierre" />

          <div className="tarjeta">
            <h2>Verificación de caja</h2>
            <table className="lista-calculo">
              <tbody>
                <tr>
                  <td>Efectivo contado</td>
                  <td>{formatoCLP(cBruto)}</td>
                </tr>
                <tr>
                  <td>Terminal de tarjetas</td>
                  <td>{formatoCLP(cerrada.sesion.totalTerminalTarjetas ?? cCerrada.tarjetasSistema)}</td>
                </tr>
                <tr>
                  <td>Transferencia (sistema)</td>
                  <td>{formatoCLP(v.transferenciaSistema)}</td>
                </tr>
                <tr className="lista-calculo-total">
                  <td>= Total real</td>
                  <td>{formatoCLP(v.totalReal)}</td>
                </tr>
              </tbody>
            </table>

            <div className="grilla-metricas" style={{ marginTop: "0.75rem" }}>
              <MetricaBox
                etiqueta="Diferencia (real − esperado)"
                valor={formatoCLP(dif)}
                tono={dif === 0 ? "exito" : "error"}
                nota={dif === 0 ? "Cuadra" : dif > 0 ? "Sobra" : "Falta"}
              />
            </div>

            <button type="button" className="boton-desplegable ayuda" onClick={() => setVerMasResultado((v) => !v)}>
              {verMasResultado ? "▲ Ocultar % de utilidad/pérdida y posibles causas" : "▼ Ver % de utilidad/pérdida y posibles causas"}
            </button>

            <div className={verMasResultado ? "" : "seccion-opcional-cerrada"}>
              <div className="grilla-metricas" style={{ marginTop: "0.75rem" }}>
                <MetricaBox
                  etiqueta="% de utilidad o pérdida"
                  valor={`${v.porcentaje.toFixed(2)}%`}
                  tono={dif < 0 ? "error" : "exito"}
                  nota="Diferencia ÷ venta total del período × 100"
                />
              </div>
              <p className="ayuda">
                Es la diferencia (real menos esperado) expresada como porcentaje de la venta total del período — una
                forma de ver qué tan grave es en relación a lo que se vendió. Ojo: el crédito simple otorgado hoy que
                todavía no se cobra también resta acá, aunque no sea necesariamente un error. En{" "}
                <Link to="/caja/cuadratura">Cuadratura de caja</Link> se puede ver este mismo porcentaje día por día
                y acumulado para un período.
              </p>

              {dif !== 0 && (
                <div className="causas-descuadre no-imprimir">
                  <h3 style={{ marginTop: 0 }}>{dif < 0 ? "¿Por qué podría faltar?" : "¿Por qué podría sobrar?"}</h3>
                  <ul>
                    {posiblesCausas(dif).map((causa) => (
                      <li key={causa}>{causa}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="boton boton-primario"
                    onClick={() =>
                      navigate("/asistente", {
                        state: {
                          mensajeInicial: `Al cerrar la caja (sesión ${cerrada.sesion.id}, del ${new Date(cerrada.sesion.fechaApertura).toLocaleDateString("es-CL")}) quedó una diferencia de ${formatoCLP(dif)} (${dif < 0 ? "falta" : "sobra"}) entre el total real (efectivo contado + terminal tarjetas + transferencia) y el total esperado del resumen de movimientos. Revisa el detalle de esa sesión y dime a qué se puede deber.`,
                        },
                      })
                    }
                  >
                    Analizar con el Asistente IA
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="tarjeta">
            <h2>Depósito y fondo para mañana</h2>
            <div className="grilla-metricas">
              <MetricaBox etiqueta="Retiro para depositar en el banco" valor={formatoCLP(retiroAlCierre)} />
              <MetricaBox
                etiqueta="Fondo para mañana (contado menos retiro)"
                valor={formatoCLP(cerrada.sesion.efectivoContado ?? 0)}
              />
            </div>
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
        </div>

        <InformeCierreBoleta
          resumen={cerrada}
          efectivoContadoBruto={cBruto}
          terminalTarjetas={cerrada.sesion.totalTerminalTarjetas}
        />

        <button type="button" className="boton boton-primario no-imprimir" onClick={() => navigate("/caja")}>
          Volver a caja
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="encabezado-pantalla no-imprimir">
        <h1>Cerrar caja</h1>
        {resumen && (
          <div className="fila-inline" style={{ marginBottom: 0 }}>
            <button type="button" className="boton boton-primario" onClick={imprimirHojaGrande}>
              Imprimir (hoja grande)
            </button>
            <button type="button" onClick={imprimirBoleta}>
              Imprimir boleta
            </button>
          </div>
        )}
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      {resumen && (
        <div className={`cierre-caja-hoja${imprimiendoBoleta ? " no-imprimir-boleta" : ""}`}>
          <ResumenCierre resumen={resumen} titulo="Resumen antes de cerrar (reporte X)" />
        </div>
      )}
      {resumen && (
        <InformeCierreBoleta resumen={resumen} efectivoContadoBruto={totalContado} terminalTarjetas={terminalTarjetasNum} />
      )}

      <form onSubmit={cerrar} onKeyDown={manejarEnterComoTab} className="formulario no-imprimir">
        <h2>Conteo de efectivo al cerrar</h2>
        <p className="ayuda">
          Escribe el monto total contado en efectivo ahora mismo, ANTES de retirar nada para el banco — primero se ve
          la cuadratura real, y recién después se decide cuánto retirar.
        </p>
        <label>
          Efectivo contado (total)
          <input
            type="number"
            min="0"
            className="input-chico"
            value={efectivoContado}
            onChange={(e) => setEfectivoContado(e.target.value)}
            placeholder="0"
          />
        </label>

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
          <div className="grilla-metricas" style={{ maxWidth: "260px" }}>
            <MetricaBox
              etiqueta="Diferencia (terminal − sistema)"
              valor={formatoCLP(Number(terminalTarjetas) - (resumen.totalPorMedio.tarjeta ?? 0))}
              tono={Number(terminalTarjetas) === (resumen.totalPorMedio.tarjeta ?? 0) ? "exito" : "error"}
            />
          </div>
        )}

        {resumen && verificacion && (
          <>
            <h2>Verificación de caja (en vivo)</h2>
            <table className="lista-calculo" style={{ maxWidth: "420px" }}>
              <tbody>
                <tr>
                  <td>Efectivo contado</td>
                  <td>{formatoCLP(totalContado)}</td>
                </tr>
                <tr>
                  <td>Terminal de tarjetas</td>
                  <td>{formatoCLP(terminalTarjetasNum ?? (c?.tarjetasSistema ?? 0))}</td>
                </tr>
                <tr>
                  <td>Transferencia (sistema)</td>
                  <td>{formatoCLP(verificacion.transferenciaSistema)}</td>
                </tr>
                <tr className="lista-calculo-total">
                  <td>= Total real</td>
                  <td>{formatoCLP(verificacion.totalReal)}</td>
                </tr>
                <tr>
                  <td>Total esperado (resumen de movimientos)</td>
                  <td>{formatoCLP(c?.totalEsperado ?? 0)}</td>
                </tr>
                <tr className="lista-calculo-total">
                  <td>Diferencia</td>
                  <td>{formatoCLP(verificacion.diferencia)}</td>
                </tr>
              </tbody>
            </table>
            <div className="grilla-metricas" style={{ maxWidth: "260px" }}>
              <MetricaBox
                etiqueta="% de utilidad o pérdida"
                valor={`${verificacion.porcentaje.toFixed(2)}%`}
                tono={verificacion.diferencia === 0 ? "exito" : verificacion.diferencia > 0 ? "exito" : "error"}
              />
            </div>
          </>
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
        <div className="tarjeta no-imprimir">
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

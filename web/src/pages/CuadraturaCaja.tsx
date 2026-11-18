import { useEffect, useState } from "react";
import { api, formatoCLP, type Cuadratura } from "../api";
import ModalAlerta from "../components/ModalAlerta";
import ModalAjusteCuadratura from "../components/ModalAjusteCuadratura";
import { mostrarToast } from "../lib/toast";
import { imprimirCuadraturaCaja } from "../lib/imprimir";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatoFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// "Total esperado" del resumen de movimientos: igual que en Cerrar caja
// (CerrarCaja.tsx) — fondo fijo + venta total (todos los medios) + abonos
// recibidos − retiros REALES (sin contar el retiro para el banco, ver
// RetiroCaja.esDepositoBanco) + ingresos. Los gastos NO entran acá (a
// pedido del usuario — ver Gasto.esGastoNegocio).
function totalEsperadoDia(
  dia: { totalVentas: number; totalRetirosReales: number; totalIngresos: number; sesion: { fondoFijoInicial: number } },
  abonos: number
): number {
  return dia.sesion.fondoFijoInicial + dia.totalVentas + abonos - dia.totalRetirosReales + dia.totalIngresos;
}

// Abonos recibidos de verdad (créditos cobrados hoy, cualquier medio, sin
// contar los condonados) de UN día — mismo criterio que
// derivarCifras().creditoPagadoTotal en CerrarCaja.tsx.
function abonosDia(dia: { cobrosCreditoPorMedio: Record<string, number> }): number {
  return (
    (dia.cobrosCreditoPorMedio.efectivo ?? 0) +
    (dia.cobrosCreditoPorMedio.tarjeta ?? 0) +
    (dia.cobrosCreditoPorMedio.transferencia ?? 0)
  );
}

// Comparación "real vs esperado" de UN día — mismo criterio que
// calcularVerificacion() en CerrarCaja.tsx. efectivoContado persistido en
// la sesión queda NETO del retiro para el banco, así que se reconstruye
// el bruto (lo contado antes de ese retiro) sumándolo de vuelta — ver
// RetiroCaja.esDepositoBanco.
function calcularVerificacionDia(
  dia: {
    totalVentas: number;
    totalPorMedio: Record<string, number>;
    totalRetiroBancario: number;
    sesion: { efectivoContado: number | null; totalTerminalTarjetas: number | null };
  },
  totalEsperado: number
): { totalReal: number; diferencia: number; porcentaje: number } | null {
  if (dia.sesion.efectivoContado == null) return null;
  const efectivoContadoBruto = dia.sesion.efectivoContado + dia.totalRetiroBancario;
  const terminal = dia.sesion.totalTerminalTarjetas ?? dia.totalPorMedio.tarjeta ?? 0;
  const transferencia = dia.totalPorMedio.transferencia ?? 0;
  const totalReal = efectivoContadoBruto + terminal + transferencia;
  const diferencia = totalReal - totalEsperado;
  const porcentaje = dia.totalVentas > 0 ? (diferencia / dia.totalVentas) * 100 : 0;
  return { totalReal, diferencia, porcentaje };
}

// Pérdida acumulada de un día ya cerrado (0 si sobró, cuadró, o si el día
// todavía no se cierra) — null en vez de 0 cuando el día sigue abierto,
// para no mezclarlo con "no hubo pérdida" al acumular el % del período.
function perdidaDia(v: { diferencia: number } | null): number | null {
  if (!v) return null;
  return Math.max(0, -v.diferencia);
}

// Cuadratura de caja: desglose por medio de pago (efectivo/tarjeta/crédito)
// más retiros/ingresos y fondo fijo, para un rango de fechas — puede
// abarcar varios días (varias sesiones de caja, una por día), en cuyo caso
// se muestra cada día por separado y un total general al final (ver
// GET /api/caja/cuadratura). Se ve en pantalla mientras se revisa, y se
// imprime tal cual con "Imprimir" (hoja A4, no el rollo térmico del
// ticket).
export default function CuadraturaCaja() {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [datos, setDatos] = useState<Cuadratura | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Corregir efectivo/tarjeta de un día puntual — a pedido del usuario, ver
  // ModalAjusteCuadratura.
  const [corrigiendoSesionId, setCorrigiendoSesionId] = useState<number | null>(null);

  function cargar() {
    setCargando(true);
    api.caja
      .cuadratura(desde, hasta)
      .then(setDatos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [desde, hasta]);

  async function confirmarAjuste(
    medio: "efectivo" | "tarjeta",
    direccion: "suma" | "resta",
    monto: number,
    motivo: string,
    usuarioId: number,
    clave: string
  ) {
    if (corrigiendoSesionId == null) return;
    await api.caja.registrarAjusteCuadratura(corrigiendoSesionId, { medio, direccion, monto, motivo, usuarioId, clave });
    mostrarToast("Corrección registrada", `${medio === "efectivo" ? "Efectivo" : "Tarjeta"}: ${motivo}.`);
    setCorrigiendoSesionId(null);
    cargar();
  }

  async function imprimir() {
    try {
      await imprimirCuadraturaCaja();
    } catch {
      setError("No se pudo imprimir — revisa la impresora configurada en Configuración → Impresoras (Pedidos web).");
    }
  }

  const totalEsperadoGeneral = datos
    ? totalEsperadoDia(
        {
          totalVentas: datos.totalGeneral.totalVentas,
          totalRetirosReales: datos.totalGeneral.totalRetirosReales,
          totalIngresos: datos.totalGeneral.totalIngresos,
          sesion: { fondoFijoInicial: datos.totalGeneral.fondoFijoInicial },
        },
        datos.totalGeneral.totalAbonosCredito
      )
    : 0;
  // Verificación acumulada — suma cada día su propio efectivo
  // contado BRUTO (reconstruido, ver calcularVerificacionDia) y su propio
  // terminal de tarjetas (o el sistema si no se cargó ese día), más la
  // transferencia del sistema de todo el rango.
  const efectivoContadoBrutoGeneral =
    datos?.dias.reduce((s, d) => s + (d.sesion.efectivoContado ?? 0) + d.totalRetiroBancario, 0) ?? 0;
  const terminalGeneral =
    datos?.dias.reduce((s, d) => s + (d.sesion.totalTerminalTarjetas ?? d.totalPorMedio.tarjeta ?? 0), 0) ?? 0;
  const transferenciaGeneral = datos?.totalGeneral.totalPorMedio.transferencia ?? 0;
  const totalRealGeneral = efectivoContadoBrutoGeneral + terminalGeneral + transferenciaGeneral;
  const diferenciaGeneral = totalRealGeneral - totalEsperadoGeneral;
  const porcentajeGeneral =
    datos && datos.totalGeneral.totalVentas > 0 ? (diferenciaGeneral / datos.totalGeneral.totalVentas) * 100 : 0;
  // Acumulado del período — la pérdida solo suma los días YA cerrados (un
  // día abierto no tiene efectivo contado todavía, así que no se sabe si
  // hubo pérdida o no; contarlo como 0 inflaría el % hacia abajo de forma
  // engañosa). La venta total sí es la de todo el período, días abiertos
  // incluidos.
  const perdidaAcumulada =
    datos?.dias.reduce((s, d) => s + (perdidaDia(calcularVerificacionDia(d, totalEsperadoDia(d, abonosDia(d)))) ?? 0), 0) ?? 0;

  return (
    <div>
      <div className="encabezado-pantalla no-imprimir">
        <h1>Cuadratura de caja</h1>
        <button type="button" className="boton boton-primario" onClick={imprimir} disabled={!datos || datos.dias.length === 0}>
          Imprimir
        </button>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros no-imprimir">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {cargando && <p>Cargando...</p>}

      {datos && datos.dias.length === 0 && !cargando && <p className="ayuda">No hay ninguna caja abierta en ese rango de fechas.</p>}

      {datos && datos.dias.length > 0 && (
        <div className="vale cuadratura-caja">
          <h2>Cuadratura de caja</h2>
          <p className="ayuda">
            {desde === hasta ? desde : `${desde} al ${hasta}`}
            {datos.dias.length > 1 ? ` — ${datos.dias.length} días` : ""}
          </p>

          {datos.dias.map((dia) => (
            <section key={dia.sesion.id} className="cuadratura-dia">
              <h3>
                {formatoFechaHora(dia.sesion.fechaApertura)}
                {dia.sesion.fechaCierre ? ` — cerrada ${formatoFechaHora(dia.sesion.fechaCierre)}` : " — caja abierta"}
              </h3>
              <p className="ayuda">
                Abrió {dia.sesion.usuarioApertura?.nombre ?? "—"}
                {dia.sesion.usuarioCierre ? `, cerró ${dia.sesion.usuarioCierre.nombre}` : ""}
              </p>
              <button
                type="button"
                className="boton-chico no-imprimir"
                onClick={() => setCorrigiendoSesionId(dia.sesion.id)}
              >
                Corregir efectivo/tarjeta de este día
              </button>
              {(() => {
                const abonos = abonosDia(dia);
                const totalEsperado = totalEsperadoDia(dia, abonos);
                const sumaMediosPago =
                  (dia.ventasPorMedio.efectivo ?? 0) +
                  (dia.ventasPorMedio.tarjeta ?? 0) +
                  (dia.ventasPorMedio.transferencia ?? 0) +
                  (dia.ventasPorMedio.credito ?? 0);
                const v = calcularVerificacionDia(dia, totalEsperado);
                return (
                  <>
                    <h4>Informes Totales</h4>
                    <table className="lista-calculo">
                      <tbody>
                        <tr>
                          <td>Venta inicial</td>
                          <td>
                            {dia.boletaInicial != null
                              ? `N° ${dia.boletaInicial} — ${formatoCLP(dia.montoBoletaInicial ?? 0)}`
                              : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td>Venta final</td>
                          <td>
                            {dia.boletaFinal != null
                              ? `N° ${dia.boletaFinal} — ${formatoCLP(dia.montoBoletaFinal ?? 0)}`
                              : "—"}
                          </td>
                        </tr>
                        <tr className="lista-calculo-total">
                          <td>Venta total del período</td>
                          <td>{formatoCLP(dia.totalVentas)}</td>
                        </tr>
                      </tbody>
                    </table>

                    <h4>Medios de Pago</h4>
                    <table className="lista-calculo">
                      <tbody>
                        <tr>
                          <td>Efectivo</td>
                          <td>{formatoCLP(dia.ventasPorMedio.efectivo ?? 0)}</td>
                        </tr>
                        <tr>
                          <td>Tarjeta</td>
                          <td>{formatoCLP(dia.ventasPorMedio.tarjeta ?? 0)}</td>
                        </tr>
                        <tr>
                          <td>Transferencia</td>
                          <td>{formatoCLP(dia.ventasPorMedio.transferencia ?? 0)}</td>
                        </tr>
                        <tr>
                          <td>Crédito simple</td>
                          <td>{formatoCLP(dia.ventasPorMedio.credito ?? 0)}</td>
                        </tr>
                        <tr className="lista-calculo-total">
                          <td>Total</td>
                          <td>{formatoCLP(sumaMediosPago)}</td>
                        </tr>
                        {dia.ventasPorMedio.pedido_web > 0 && (
                          <tr>
                            <td>Pedido web (pendiente de pago, no incluido arriba)</td>
                            <td>{formatoCLP(dia.ventasPorMedio.pedido_web ?? 0)}</td>
                          </tr>
                        )}
                        {dia.ventasPorMedio.mayorista > 0 && (
                          <tr>
                            <td>Venta mayorista (pendiente de pago, no incluido arriba)</td>
                            <td>{formatoCLP(dia.ventasPorMedio.mayorista ?? 0)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    <h4>Resumen de movimientos del día</h4>
                    <table className="lista-calculo">
                      <tbody>
                        <tr>
                          <td>Venta total</td>
                          <td>{formatoCLP(dia.totalVentas)}</td>
                        </tr>
                        <tr>
                          <td>+ Fondo fijo</td>
                          <td>{formatoCLP(dia.sesion.fondoFijoInicial)}</td>
                        </tr>
                        <tr>
                          <td>+ Abonos (créditos pendientes pagados)</td>
                          <td>+{formatoCLP(abonos)}</td>
                        </tr>
                        <tr>
                          <td>− Retiros</td>
                          <td>−{formatoCLP(dia.totalRetirosReales)}</td>
                        </tr>
                        <tr>
                          <td>+ Ingresos</td>
                          <td>+{formatoCLP(dia.totalIngresos)}</td>
                        </tr>
                        {dia.ajustes.map((a) => (
                          <tr key={`ajuste-${a.id}`}>
                            <td>
                              {a.direccion === "resta" ? "−" : "+"} Corrección {a.medio === "efectivo" ? "efectivo" : "tarjeta"} —{" "}
                              {a.motivo}
                            </td>
                            <td>
                              {a.direccion === "resta" ? "−" : "+"}
                              {formatoCLP(a.monto)}
                            </td>
                          </tr>
                        ))}
                        <tr className="lista-calculo-total">
                          <td>= Total esperado</td>
                          <td>{formatoCLP(totalEsperado)}</td>
                        </tr>
                      </tbody>
                    </table>
                    {dia.totalRetiroBancario > 0 && (
                      <p className="ayuda" style={{ margin: "0.3rem 0 0" }}>
                        No incluye el retiro para depositar en el banco ({formatoCLP(dia.totalRetiroBancario)}) — esa
                        plata sigue siendo de la empresa, solo cambia de lugar.
                      </p>
                    )}

                    {v && (
                      <>
                        <h4>Verificación de caja</h4>
                        <table className="lista-calculo">
                          <tbody>
                            <tr>
                              <td>Efectivo contado</td>
                              <td>{formatoCLP((dia.sesion.efectivoContado ?? 0) + dia.totalRetiroBancario)}</td>
                            </tr>
                            <tr>
                              <td>Terminal de tarjetas</td>
                              <td>{formatoCLP(dia.sesion.totalTerminalTarjetas ?? dia.totalPorMedio.tarjeta ?? 0)}</td>
                            </tr>
                            <tr>
                              <td>Transferencia (sistema)</td>
                              <td>{formatoCLP(dia.totalPorMedio.transferencia ?? 0)}</td>
                            </tr>
                            <tr className="lista-calculo-total">
                              <td>= Total real</td>
                              <td>{formatoCLP(v.totalReal)}</td>
                            </tr>
                            <tr>
                              <td>Diferencia (real − esperado)</td>
                              <td className={v.diferencia === 0 ? "exito" : "error"}>{formatoCLP(v.diferencia)}</td>
                            </tr>
                            <tr>
                              <td>% de utilidad o pérdida</td>
                              <td className={v.diferencia < 0 ? "error" : "exito"}>{v.porcentaje.toFixed(2)}%</td>
                            </tr>
                          </tbody>
                        </table>
                      </>
                    )}

                    {(dia.retiros.length > 0 || dia.ingresos.length > 0) && (
                      <details>
                        <summary className="ayuda">Detalle de retiros e ingresos</summary>
                        <table className="lista-calculo">
                          <tbody>
                            {dia.retiros.map((r) => (
                              <tr key={`retiro-${r.id}`}>
                                <td>
                                  Retiro — {r.motivo}
                                  {r.esDepositoBanco && <span className="ayuda"> (depósito a banco)</span>}
                                </td>
                                <td>{r.esDepositoBanco ? "" : "−"}{formatoCLP(r.monto)}</td>
                              </tr>
                            ))}
                            {dia.ingresos.map((r) => (
                              <tr key={`ingreso-${r.id}`}>
                                <td>Ingreso — {r.motivo}</td>
                                <td>+{formatoCLP(r.monto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                  </>
                );
              })()}
            </section>
          ))}

          {datos.dias.length > 1 && (
            <section className="cuadratura-dia">
              <h3>Total general del rango</h3>

              <h4>Informes Totales</h4>
              <table className="lista-calculo">
                <tbody>
                  <tr className="lista-calculo-total">
                    <td>Venta total del período</td>
                    <td>{formatoCLP(datos.totalGeneral.totalVentas)}</td>
                  </tr>
                </tbody>
              </table>

              <h4>Medios de Pago</h4>
              <table className="lista-calculo">
                <tbody>
                  <tr>
                    <td>Efectivo</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.efectivo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Tarjeta</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.tarjeta ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Transferencia</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.transferencia ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Crédito simple</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.credito ?? 0)}</td>
                  </tr>
                  <tr className="lista-calculo-total">
                    <td>Total</td>
                    <td>
                      {formatoCLP(
                        (datos.totalGeneral.ventasPorMedio.efectivo ?? 0) +
                          (datos.totalGeneral.ventasPorMedio.tarjeta ?? 0) +
                          (datos.totalGeneral.ventasPorMedio.transferencia ?? 0) +
                          (datos.totalGeneral.ventasPorMedio.credito ?? 0)
                      )}
                    </td>
                  </tr>
                  {datos.totalGeneral.ventasPorMedio.pedido_web > 0 && (
                    <tr>
                      <td>Pedido web (pendiente de pago, no incluido arriba)</td>
                      <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.pedido_web ?? 0)}</td>
                    </tr>
                  )}
                  {datos.totalGeneral.ventasPorMedio.mayorista > 0 && (
                    <tr>
                      <td>Venta mayorista (pendiente de pago, no incluido arriba)</td>
                      <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.mayorista ?? 0)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h4>Resumen de movimientos del período</h4>
              <table className="lista-calculo">
                <tbody>
                  <tr>
                    <td>Venta total</td>
                    <td>{formatoCLP(datos.totalGeneral.totalVentas)}</td>
                  </tr>
                  <tr>
                    <td>+ Fondo fijo (suma de los días)</td>
                    <td>{formatoCLP(datos.totalGeneral.fondoFijoInicial)}</td>
                  </tr>
                  <tr>
                    <td>+ Abonos (créditos pendientes pagados)</td>
                    <td>+{formatoCLP(datos.totalGeneral.totalAbonosCredito)}</td>
                  </tr>
                  <tr>
                    <td>− Retiros</td>
                    <td>−{formatoCLP(datos.totalGeneral.totalRetirosReales)}</td>
                  </tr>
                  <tr>
                    <td>+ Ingresos</td>
                    <td>+{formatoCLP(datos.totalGeneral.totalIngresos)}</td>
                  </tr>
                  {datos.totalGeneral.totalAjustesEfectivo !== 0 && (
                    <tr>
                      <td>± Correcciones a efectivo</td>
                      <td>{formatoCLP(datos.totalGeneral.totalAjustesEfectivo)}</td>
                    </tr>
                  )}
                  {datos.totalGeneral.totalAjustesTarjeta !== 0 && (
                    <tr>
                      <td>± Correcciones a tarjeta</td>
                      <td>{formatoCLP(datos.totalGeneral.totalAjustesTarjeta)}</td>
                    </tr>
                  )}
                  <tr className="lista-calculo-total">
                    <td>= Total esperado</td>
                    <td>{formatoCLP(totalEsperadoGeneral)}</td>
                  </tr>
                </tbody>
              </table>
              {datos.totalGeneral.totalRetiroBancario > 0 && (
                <p className="ayuda" style={{ margin: "0.3rem 0 0" }}>
                  No incluye los retiros para depositar en el banco ({formatoCLP(datos.totalGeneral.totalRetiroBancario)}) —
                  esa plata sigue siendo de la empresa, solo cambia de lugar.
                </p>
              )}

              <h4>Verificación de caja</h4>
              <table className="lista-calculo">
                <tbody>
                  <tr>
                    <td>Efectivo contado</td>
                    <td>{formatoCLP(efectivoContadoBrutoGeneral)}</td>
                  </tr>
                  <tr>
                    <td>Terminal de tarjetas</td>
                    <td>{formatoCLP(terminalGeneral)}</td>
                  </tr>
                  <tr>
                    <td>Transferencia (sistema)</td>
                    <td>{formatoCLP(transferenciaGeneral)}</td>
                  </tr>
                  <tr className="lista-calculo-total">
                    <td>= Total real</td>
                    <td>{formatoCLP(totalRealGeneral)}</td>
                  </tr>
                  <tr>
                    <td>Diferencia (real − esperado)</td>
                    <td className={diferenciaGeneral === 0 ? "exito" : "error"}>{formatoCLP(diferenciaGeneral)}</td>
                  </tr>
                  <tr>
                    <td>% de utilidad o pérdida acumulado del período</td>
                    <td className={perdidaAcumulada === 0 ? "exito" : "error"}>{porcentajeGeneral.toFixed(2)}%</td>
                  </tr>
                </tbody>
              </table>
              <p className="ayuda" style={{ marginTop: "0.5rem" }}>
                El % de pérdida acumulado solo considera los días ya cerrados del período (un día todavía abierto no
                tiene efectivo contado, así que no se sabe si hubo pérdida) — se divide por la venta total de todo el
                período, incluidos los días abiertos.
              </p>
            </section>
          )}
        </div>
      )}

      {corrigiendoSesionId != null && (
        <ModalAjusteCuadratura
          fechaSesion={formatoFechaHora(
            datos?.dias.find((d) => d.sesion.id === corrigiendoSesionId)?.sesion.fechaApertura ?? new Date().toISOString()
          )}
          onConfirmar={confirmarAjuste}
          onCancelar={() => setCorrigiendoSesionId(null)}
        />
      )}
    </div>
  );
}

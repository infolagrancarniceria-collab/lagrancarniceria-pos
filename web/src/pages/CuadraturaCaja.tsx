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

// "Saldo final": igual que en Cerrar caja (CerrarCaja.tsx), TODOS los
// movimientos del día sin importar el medio de pago (venta total, abonos
// recibidos, retiros, ingresos) — a diferencia de "Efectivo esperado",
// que es solo el cajón físico en efectivo. Los gastos NO entran acá (a
// pedido del usuario — ver Gasto.esGastoNegocio). En dos versiones: sin
// sumar el fondo fijo con que se abrió, y con ese fondo sumado.
function saldoFinal(
  dia: { totalVentas: number; totalRetiros: number; totalIngresos: number; sesion: { fondoFijoInicial: number } },
  abonos: number
) {
  const sinFondo = dia.totalVentas + abonos - dia.totalRetiros + dia.totalIngresos;
  return { sinFondo, conFondo: sinFondo + dia.sesion.fondoFijoInicial };
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

// Faltante de efectivo de un día ya cerrado (0 si sobró, cuadró, o si el
// día todavía no se cierra) — null en vez de 0 cuando el día sigue
// abierto, para no mezclarlo con "no hubo faltante" al acumular el % de
// pérdida del período.
function faltanteDia(dia: { sesion: { efectivoContado: number | null }; diferencia: number | null }): number | null {
  if (dia.sesion.efectivoContado == null) return null;
  return Math.max(0, -(dia.diferencia ?? 0));
}

function porcentajePerdida(faltante: number, totalVentas: number): number {
  return totalVentas > 0 ? (faltante / totalVentas) * 100 : 0;
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

  // Acumulado del período — el faltante solo suma los días YA cerrados
  // (un día abierto no tiene efectivo contado todavía, así que no se sabe
  // si hubo faltante o no; contarlo como 0 inflaría el % hacia abajo de
  // forma engañosa). La venta total sí es la de todo el período, días
  // abiertos incluidos.
  const faltanteAcumulado =
    datos?.dias.reduce((s, d) => s + (faltanteDia(d) ?? 0), 0) ?? 0;
  const pctPerdidaAcumulado = datos ? porcentajePerdida(faltanteAcumulado, datos.totalGeneral.totalVentas) : 0;
  const saldoFinalGeneral = datos
    ? saldoFinal(
        {
          totalVentas: datos.totalGeneral.totalVentas,
          totalRetiros: datos.totalGeneral.totalRetiros,
          totalIngresos: datos.totalGeneral.totalIngresos,
          sesion: { fondoFijoInicial: datos.totalGeneral.fondoFijoInicial },
        },
        datos.totalGeneral.totalAbonosCredito
      )
    : { sinFondo: 0, conFondo: 0 };

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
              <table className="tabla">
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
                  <tr>
                    <td>Fondo fijo inicial</td>
                    <td>{formatoCLP(dia.sesion.fondoFijoInicial)}</td>
                  </tr>
                  <tr>
                    <td>Venta en efectivo</td>
                    <td>{formatoCLP(dia.ventasPorMedio.efectivo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta con tarjeta</td>
                    <td>{formatoCLP(dia.ventasPorMedio.tarjeta ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta a crédito</td>
                    <td>{formatoCLP(dia.ventasPorMedio.credito ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta por transferencia</td>
                    <td>{formatoCLP(dia.ventasPorMedio.transferencia ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Pedido web (pendiente de pago)</td>
                    <td>{formatoCLP(dia.ventasPorMedio.pedido_web ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta mayorista (pendiente de pago)</td>
                    <td>{formatoCLP(dia.ventasPorMedio.mayorista ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Total ventas</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(dia.totalVentas)}</strong>
                    </td>
                  </tr>
                  {dia.retiros.map((r) => (
                    <tr key={`retiro-${r.id}`}>
                      <td>Retiro — {r.motivo}</td>
                      <td>−{formatoCLP(r.monto)}</td>
                    </tr>
                  ))}
                  {dia.ingresos.map((r) => (
                    <tr key={`ingreso-${r.id}`}>
                      <td>Ingreso — {r.motivo}</td>
                      <td>+{formatoCLP(r.monto)}</td>
                    </tr>
                  ))}
                  {dia.ajustes.map((a) => (
                    <tr key={`ajuste-${a.id}`}>
                      <td>
                        Corrección {a.medio === "efectivo" ? "efectivo" : "tarjeta"} — {a.motivo}
                      </td>
                      <td>
                        {a.direccion === "resta" ? "−" : "+"}
                        {formatoCLP(a.monto)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Abonos recibidos</td>
                    <td>+{formatoCLP(abonosDia(dia))}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Efectivo esperado (solo efectivo)</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(dia.efectivoEsperado)}</strong>
                    </td>
                  </tr>
                  {dia.sesion.efectivoContado != null && (
                    <>
                      <tr>
                        <td>Efectivo contado</td>
                        <td>{formatoCLP(dia.sesion.efectivoContado)}</td>
                      </tr>
                      <tr>
                        <td>Diferencia</td>
                        <td className={dia.diferencia === 0 ? "exito" : "error"}>
                          {formatoCLP(dia.diferencia ?? 0)}
                        </td>
                      </tr>
                      <tr>
                        <td>% de pérdida sobre ventas</td>
                        <td className={faltanteDia(dia) === 0 ? "exito" : "error"}>
                          {porcentajePerdida(faltanteDia(dia) ?? 0, dia.totalVentas).toFixed(2)}%
                        </td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td>Saldo final (todos los medios, sin fondo fijo)</td>
                    <td>{formatoCLP(saldoFinal(dia, abonosDia(dia)).sinFondo)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Saldo final (todos los medios, con fondo fijo)</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(saldoFinal(dia, abonosDia(dia)).conFondo)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          ))}

          {datos.dias.length > 1 && (
            <section className="cuadratura-dia">
              <h3>Total general del rango</h3>
              <table className="tabla">
                <tbody>
                  <tr>
                    <td>Fondo fijo inicial (suma de los días)</td>
                    <td>{formatoCLP(datos.totalGeneral.fondoFijoInicial)}</td>
                  </tr>
                  <tr>
                    <td>Venta en efectivo</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.efectivo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta con tarjeta</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.tarjeta ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta a crédito</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.credito ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta por transferencia</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.transferencia ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Pedido web (pendiente de pago)</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.pedido_web ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta mayorista (pendiente de pago)</td>
                    <td>{formatoCLP(datos.totalGeneral.ventasPorMedio.mayorista ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Total ventas</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(datos.totalGeneral.totalVentas)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Abonos recibidos</td>
                    <td>+{formatoCLP(datos.totalGeneral.totalAbonosCredito)}</td>
                  </tr>
                  <tr>
                    <td>Retiros</td>
                    <td>−{formatoCLP(datos.totalGeneral.totalRetiros)}</td>
                  </tr>
                  <tr>
                    <td>Ingresos</td>
                    <td>+{formatoCLP(datos.totalGeneral.totalIngresos)}</td>
                  </tr>
                  {datos.totalGeneral.totalAjustesEfectivo !== 0 && (
                    <tr>
                      <td>Correcciones a efectivo</td>
                      <td>{formatoCLP(datos.totalGeneral.totalAjustesEfectivo)}</td>
                    </tr>
                  )}
                  {datos.totalGeneral.totalAjustesTarjeta !== 0 && (
                    <tr>
                      <td>Correcciones a tarjeta</td>
                      <td>{formatoCLP(datos.totalGeneral.totalAjustesTarjeta)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>
                      <strong>Efectivo esperado (solo efectivo)</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(datos.totalGeneral.efectivoEsperado)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Efectivo contado</td>
                    <td>{formatoCLP(datos.totalGeneral.efectivoContado)}</td>
                  </tr>
                  <tr>
                    <td>% de pérdida acumulado del período</td>
                    <td className={faltanteAcumulado === 0 ? "exito" : "error"}>{pctPerdidaAcumulado.toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td>Saldo final (todos los medios, sin fondo fijo)</td>
                    <td>{formatoCLP(saldoFinalGeneral.sinFondo)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Saldo final (todos los medios, con fondo fijo)</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(saldoFinalGeneral.conFondo)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="ayuda" style={{ marginTop: "0.5rem" }}>
                El % de pérdida acumulado solo considera los días ya cerrados del período (un día todavía abierto no
                tiene efectivo contado, así que no se sabe si hubo faltante) — se divide por la venta total de todo
                el período, incluidos los días abiertos.
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

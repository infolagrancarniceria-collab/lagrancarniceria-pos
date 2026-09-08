import { useEffect, useState } from "react";
import { api, formatoCLP, type Cuadratura } from "../api";
import ModalAlerta from "../components/ModalAlerta";
import { imprimirCuadraturaCaja } from "../lib/imprimir";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatoFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

  useEffect(() => {
    setCargando(true);
    api.caja
      .cuadratura(desde, hasta)
      .then(setDatos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [desde, hasta]);

  async function imprimir() {
    try {
      await imprimirCuadraturaCaja();
    } catch {
      setError("No se pudo imprimir — revisa la impresora configurada en Configuración → Impresoras (Pedidos web).");
    }
  }

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
              <table className="tabla">
                <tbody>
                  <tr>
                    <td>Fondo fijo inicial</td>
                    <td>{formatoCLP(dia.sesion.fondoFijoInicial)}</td>
                  </tr>
                  <tr>
                    <td>Venta en efectivo</td>
                    <td>{formatoCLP(dia.totalPorMedio.efectivo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta con tarjeta</td>
                    <td>{formatoCLP(dia.totalPorMedio.tarjeta ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta a crédito</td>
                    <td>{formatoCLP(dia.totalPorMedio.credito ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta por transferencia</td>
                    <td>{formatoCLP(dia.totalPorMedio.transferencia ?? 0)}</td>
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
                  <tr>
                    <td>
                      <strong>Efectivo esperado</strong>
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
                    </>
                  )}
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
                    <td>{formatoCLP(datos.totalGeneral.totalPorMedio.efectivo ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta con tarjeta</td>
                    <td>{formatoCLP(datos.totalGeneral.totalPorMedio.tarjeta ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta a crédito</td>
                    <td>{formatoCLP(datos.totalGeneral.totalPorMedio.credito ?? 0)}</td>
                  </tr>
                  <tr>
                    <td>Venta por transferencia</td>
                    <td>{formatoCLP(datos.totalGeneral.totalPorMedio.transferencia ?? 0)}</td>
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
                    <td>Retiros</td>
                    <td>−{formatoCLP(datos.totalGeneral.totalRetiros)}</td>
                  </tr>
                  <tr>
                    <td>Ingresos</td>
                    <td>+{formatoCLP(datos.totalGeneral.totalIngresos)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Efectivo esperado</strong>
                    </td>
                    <td>
                      <strong>{formatoCLP(datos.totalGeneral.efectivoEsperado)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Efectivo contado</td>
                    <td>{formatoCLP(datos.totalGeneral.efectivoContado)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

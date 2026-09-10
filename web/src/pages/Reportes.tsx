import { useEffect, useState } from "react";
import { api, formatoCLP, type ReporteDespachos, type ReporteInventario, type ReportePrecios, type ReporteVentas } from "../api";
import { GraficoBarras, GraficoLinea, GraficoTorta } from "../components/Graficos";
import ModalAlerta from "../components/ModalAlerta";

const etiquetasMotivo: Record<string, string> = {
  venta: "Venta",
  descarte: "Descarte / merma",
  ajuste: "Ajuste",
};

const etiquetasTipoCambio: Record<string, string> = {
  individual: "Individual",
  masivo_categoria: "Masivo (categoría)",
  masivo_csv: "Masivo (planilla)",
};

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// "YYYY-MM-DD" -> "DD/MM", más corto para el eje del gráfico de línea.
function fechaCorta(fecha: string): string {
  const [, mes, dia] = fecha.split("-");
  return `${dia}/${mes}`;
}

// El mismo largo de días, inmediatamente antes del rango elegido — para
// poder comparar "¿vendimos más o menos que el período anterior?" sin que
// la persona tenga que ir a buscar las fechas a mano.
function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const msPorDia = 24 * 60 * 60 * 1000;
  const d1 = new Date(`${desde}T00:00:00`);
  const d2 = new Date(`${hasta}T00:00:00`);
  const duracionDias = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / msPorDia) + 1);
  const nuevoHasta = new Date(d1.getTime() - msPorDia);
  const nuevoDesde = new Date(nuevoHasta.getTime() - (duracionDias - 1) * msPorDia);
  return { desde: nuevoDesde.toISOString().slice(0, 10), hasta: nuevoHasta.toISOString().slice(0, 10) };
}

// Flecha ▲/▼ con el % de variación contra el período anterior — para no
// tener que comparar los dos números a mano cada vez.
function Comparacion({ actual, anterior }: { actual: number; anterior: number }) {
  if (anterior <= 0) {
    return actual > 0 ? <span className="ayuda">(sin datos en el período anterior para comparar)</span> : null;
  }
  const variacion = ((actual - anterior) / anterior) * 100;
  const positivo = variacion >= 0;
  return (
    <span className={positivo ? "exito" : "error"}>
      {positivo ? "▲" : "▼"} {Math.abs(variacion).toFixed(1)}% vs período anterior
    </span>
  );
}

type Pestana = "resumen" | "ventas" | "despachos" | "inventario" | "precios";

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "ventas", etiqueta: "Ventas" },
  { id: "despachos", etiqueta: "Despachos" },
  { id: "inventario", etiqueta: "Inventario" },
  { id: "precios", etiqueta: "Precios" },
];

export default function Reportes() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [reporteInventario, setReporteInventario] = useState<ReporteInventario | null>(null);
  const [reportePrecios, setReportePrecios] = useState<ReportePrecios | null>(null);
  const [reporteVentas, setReporteVentas] = useState<ReporteVentas | null>(null);
  const [reporteVentasAnterior, setReporteVentasAnterior] = useState<ReporteVentas | null>(null);
  const [reporteDespachos, setReporteDespachos] = useState<ReporteDespachos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function cargar() {
    setError(null);
    setCargando(true);
    const anterior = periodoAnterior(desde, hasta);
    Promise.all([
      api.reportes.inventario(desde, hasta),
      api.reportes.precios(desde, hasta),
      api.reportes.ventas(desde, hasta),
      api.reportes.ventas(anterior.desde, anterior.hasta),
      api.reportes.despachos(desde, hasta),
    ])
      .then(([inv, prec, ventas, ventasAnterior, despachos]) => {
        setReporteInventario(inv);
        setReportePrecios(prec);
        setReporteVentas(ventas);
        setReporteVentasAnterior(ventasAnterior);
        setReporteDespachos(despachos);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  return (
    <div>
      <h1>Reportes</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="fila-inline">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button type="button" onClick={cargar} disabled={cargando}>
          {cargando ? "Cargando..." : "Actualizar reportes"}
        </button>
      </div>

      <div className="chips-categoria">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip-categoria ${pestana === p.id ? "activo" : ""}`}
            onClick={() => setPestana(p.id)}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {cargando && !reporteVentas && <p>Cargando...</p>}

      {pestana === "resumen" && (
        <section className="tarjeta">
          <h2>Lo más importante del período</h2>
          <p className="ayuda">
            {desde} a {hasta} — comparado contra el mismo largo de días justo antes.
          </p>
          <div className="fila-inline" style={{ alignItems: "stretch" }}>
            {reporteVentas && reporteVentasAnterior && (
              <div className="tarjeta tarjeta-mini">
                <strong>Ventas</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>{formatoCLP(reporteVentas.totalVentas)}</p>
                <p className="ayuda">{reporteVentas.cantidadVentas} venta{reporteVentas.cantidadVentas === 1 ? "" : "s"}</p>
                <Comparacion actual={reporteVentas.totalVentas} anterior={reporteVentasAnterior.totalVentas} />
              </div>
            )}
            {reporteDespachos && (
              <div className="tarjeta tarjeta-mini">
                <strong>Despachos</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>{reporteDespachos.cantidadDespachos}</p>
                <p className="ayuda">{formatoCLP(reporteDespachos.totalCostoEnvio)} cobrado por envío</p>
              </div>
            )}
            {reporteInventario && (
              <div className="tarjeta tarjeta-mini">
                <strong>Merma</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>
                  {reporteInventario.salidasPorMotivo.descarte ?? 0}
                </p>
                <p className="ayuda">unidades/kg descartados en el período</p>
              </div>
            )}
            {reportePrecios && (
              <div className="tarjeta tarjeta-mini">
                <strong>Cambios de precio</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>{reportePrecios.totalCambios}</p>
                <p className="ayuda">en el período — ver pestaña Precios para el detalle</p>
              </div>
            )}
          </div>

          {reporteVentas && reporteVentas.porCategoria.length > 0 && (
            <>
              <h3>Ventas por categoría</h3>
              <GraficoBarras
                datos={reporteVentas.porCategoria.map((c) => ({ etiqueta: c.categoria, valor: c.ingreso }))}
                formatoValor={formatoCLP}
              />
            </>
          )}

          <p className="ayuda">
            Usa las pestañas de arriba para el detalle completo de cada área, con sus propias tablas y gráficos.
          </p>
        </section>
      )}

      {pestana === "ventas" && reporteVentas && (
        <section className="tarjeta">
          <h2>Ventas</h2>
          <div className="fila-inline">
            <div>
              <strong>Cantidad de ventas:</strong> {reporteVentas.cantidadVentas}
            </div>
            <div>
              <strong>Total vendido:</strong> {formatoCLP(reporteVentas.totalVentas)}
            </div>
            {reporteVentasAnterior && (
              <Comparacion actual={reporteVentas.totalVentas} anterior={reporteVentasAnterior.totalVentas} />
            )}
          </div>
          <p className="ayuda">
            De eso, <strong>{reporteVentas.cantidadVentasOnline}</strong> venta
            {reporteVentas.cantidadVentasOnline === 1 ? "" : "s"} vinieron de Pedidos web (
            {formatoCLP(reporteVentas.totalVentasOnline)}).
          </p>

          <h3>Ventas por día</h3>
          <GraficoLinea
            datos={reporteVentas.porDia.map((d) => ({ etiqueta: fechaCorta(d.fecha), valor: d.totalVentas }))}
            formatoValor={formatoCLP}
          />

          <h3>Ventas por categoría</h3>
          <GraficoBarras
            datos={reporteVentas.porCategoria.map((c) => ({ etiqueta: c.categoria, valor: c.ingreso }))}
            formatoValor={formatoCLP}
          />
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Cantidad vendida</th>
                <th>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {reporteVentas.porCategoria.map((c) => (
                <tr key={c.categoria}>
                  <td>{c.categoria}</td>
                  <td>{c.cantidad}</td>
                  <td>{formatoCLP(c.ingreso)}</td>
                </tr>
              ))}
              {reporteVentas.porCategoria.length === 0 && (
                <tr>
                  <td colSpan={3}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>Más vendidos por cantidad</h3>
          <GraficoBarras
            datos={reporteVentas.masVendidosPorCantidad.map((p) => ({ etiqueta: p.descripcion, valor: p.cantidad }))}
          />

          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Cantidad vendida</th>
                <th>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {reporteVentas.masVendidosPorCantidad.map((p) => (
                <tr key={p.productoId}>
                  <td>{p.plu}</td>
                  <td>{p.descripcion}</td>
                  <td>{p.cantidad}</td>
                  <td>{formatoCLP(p.ingreso)}</td>
                </tr>
              ))}
              {reporteVentas.masVendidosPorCantidad.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h3>Más vendidos por ingreso</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Ingreso</th>
                <th>Cantidad vendida</th>
              </tr>
            </thead>
            <tbody>
              {reporteVentas.masVendidosPorIngreso.map((p) => (
                <tr key={p.productoId}>
                  <td>{p.plu}</td>
                  <td>{p.descripcion}</td>
                  <td>{formatoCLP(p.ingreso)}</td>
                  <td>{p.cantidad}</td>
                </tr>
              ))}
              {reporteVentas.masVendidosPorIngreso.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {pestana === "despachos" && reporteDespachos && (
        <section className="tarjeta">
          <h2>Despachos</h2>
          <div className="fila-inline">
            <div>
              <strong>Cantidad de despachos:</strong> {reporteDespachos.cantidadDespachos}
            </div>
            <div>
              <strong>Total cobrado por envío:</strong> {formatoCLP(reporteDespachos.totalCostoEnvio)}
            </div>
          </div>

          <h3>Por comuna</h3>
          <GraficoBarras
            datos={reporteDespachos.porComuna.map((c) => ({ etiqueta: c.comuna, valor: c.cantidadDespachos }))}
          />
          <table className="tabla">
            <thead>
              <tr>
                <th>Comuna</th>
                <th>Cantidad de despachos</th>
                <th>Total cobrado por envío</th>
                <th>Total vendido (incluye envío)</th>
              </tr>
            </thead>
            <tbody>
              {reporteDespachos.porComuna.map((c) => (
                <tr key={c.comuna}>
                  <td>{c.comuna}</td>
                  <td>{c.cantidadDespachos}</td>
                  <td>{formatoCLP(c.totalCostoEnvio)}</td>
                  <td>{formatoCLP(c.totalVentas)}</td>
                </tr>
              ))}
              {reporteDespachos.porComuna.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo despachos en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {pestana === "inventario" && reporteInventario && (
        <section className="tarjeta">
          <h2>Inventario</h2>
          <div className="fila-inline">
            <div>
              <strong>Entradas totales:</strong> {reporteInventario.entradasTotal}
            </div>
            <div>
              <strong>Ventas:</strong> {reporteInventario.salidasPorMotivo.venta ?? 0}
            </div>
            <div>
              <strong>Descarte/merma:</strong> {reporteInventario.salidasPorMotivo.descarte ?? 0}
            </div>
            <div>
              <strong>Ajustes:</strong> {reporteInventario.salidasPorMotivo.ajuste ?? 0}
            </div>
          </div>

          <h3>Salidas por motivo</h3>
          <GraficoTorta
            datos={Object.entries(reporteInventario.salidasPorMotivo)
              .filter(([, cantidad]) => cantidad > 0)
              .map(([motivo, cantidad]) => ({ etiqueta: etiquetasMotivo[motivo] ?? motivo, valor: cantidad }))}
          />

          <h3>Productos con más merma en el período</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Cantidad descartada</th>
              </tr>
            </thead>
            <tbody>
              {reporteInventario.topMerma.map((m) => (
                <tr key={m.productoId}>
                  <td>{m.plu}</td>
                  <td>{m.descripcion}</td>
                  <td>{m.cantidad}</td>
                </tr>
              ))}
              {reporteInventario.topMerma.length === 0 && (
                <tr>
                  <td colSpan={3}>No hubo descarte/merma registrado en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {pestana === "precios" && reportePrecios && (
        <section className="tarjeta">
          <h2>Precios</h2>
          <div className="fila-inline">
            <div>
              <strong>Total de cambios:</strong> {reportePrecios.totalCambios}
            </div>
            {Object.entries(reportePrecios.porTipo).map(([tipo, cantidad]) => (
              <div key={tipo}>
                <strong>{etiquetasTipoCambio[tipo] ?? tipo}:</strong> {cantidad}
              </div>
            ))}
          </div>

          <GraficoTorta
            datos={Object.entries(reportePrecios.porTipo).map(([tipo, cantidad]) => ({
              etiqueta: etiquetasTipoCambio[tipo] ?? tipo,
              valor: cantidad,
            }))}
          />

          <h3>Mayores variaciones de precio en el período</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Precio anterior</th>
                <th>Precio nuevo</th>
                <th>Variación</th>
              </tr>
            </thead>
            <tbody>
              {reportePrecios.mayoresCambios.map((c, i) => (
                <tr key={i}>
                  <td>{c.plu}</td>
                  <td>{c.descripcion}</td>
                  <td>{formatoCLP(c.precioAnterior)}</td>
                  <td>{formatoCLP(c.precioNuevo)}</td>
                  <td className={c.variacionPorcentual < 0 ? "exito" : ""}>
                    {c.variacionPorcentual > 0 ? "+" : ""}
                    {c.variacionPorcentual.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {reportePrecios.mayoresCambios.length === 0 && (
                <tr>
                  <td colSpan={5}>No hubo cambios de precio en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

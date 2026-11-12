import { useEffect, useState } from "react";
import {
  api,
  formatoCLP,
  type ReporteDespachos,
  type ReporteInventario,
  type ReportePrecios,
  type ReporteUtilidad,
  type ReporteVentas,
} from "../api";
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

type Pestana = "resumen" | "ventas" | "comparar" | "despachos" | "inventario" | "precios";

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "ventas", etiqueta: "Ventas" },
  { id: "comparar", etiqueta: "Comparar fechas" },
  { id: "despachos", etiqueta: "Despachos" },
  { id: "inventario", etiqueta: "Inventario" },
  { id: "precios", etiqueta: "Precios" },
];

// Datos de un período para la pestaña "Comparar fechas" — los mismos tres
// reportes que ya se usan en el resto de la pantalla, pero para un rango
// elegido a mano (no necesariamente el de arriba ni "el período anterior").
interface DatosPeriodo {
  ventas: ReporteVentas;
  inventario: ReporteInventario;
  utilidad: ReporteUtilidad;
}

function ticketPromedio(d: DatosPeriodo): number {
  return d.ventas.cantidadVentas > 0 ? d.ventas.totalVentas / d.ventas.cantidadVentas : 0;
}

export default function Reportes() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [pestana, setPestana] = useState<Pestana>("resumen");
  const [reporteInventario, setReporteInventario] = useState<ReporteInventario | null>(null);
  const [reportePrecios, setReportePrecios] = useState<ReportePrecios | null>(null);
  const [reporteVentas, setReporteVentas] = useState<ReporteVentas | null>(null);
  const [reporteVentasAnterior, setReporteVentasAnterior] = useState<ReporteVentas | null>(null);
  const [reporteDespachos, setReporteDespachos] = useState<ReporteDespachos | null>(null);
  const [reporteUtilidad, setReporteUtilidad] = useState<ReporteUtilidad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // "Comparar fechas" (ítem 5 del pedido del usuario) — dos rangos elegidos
  // a mano, independientes del filtro de arriba (que compara contra "el
  // mismo largo de días justo antes" nomás). Arrancan en el mes pasado (A)
  // vs el mes en curso (B) — un punto de partida razonable, se puede
  // cambiar antes de comparar.
  const [compDesdeA, setCompDesdeA] = useState(() => {
    const inicio = inicioMes();
    const mesAnterior = new Date(inicio);
    mesAnterior.setMonth(mesAnterior.getMonth() - 1);
    return mesAnterior.toISOString().slice(0, 10);
  });
  const [compHastaA, setCompHastaA] = useState(() => {
    const finMesAnterior = new Date(inicioMes());
    finMesAnterior.setDate(finMesAnterior.getDate() - 1);
    return finMesAnterior.toISOString().slice(0, 10);
  });
  const [compDesdeB, setCompDesdeB] = useState(inicioMes);
  const [compHastaB, setCompHastaB] = useState(hoy);
  const [compA, setCompA] = useState<DatosPeriodo | null>(null);
  const [compB, setCompB] = useState<DatosPeriodo | null>(null);
  const [comparando, setComparando] = useState(false);
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);

  function cargarDatosPeriodo(d: string, h: string): Promise<DatosPeriodo> {
    return Promise.all([api.reportes.ventas(d, h), api.reportes.inventario(d, h), api.reportes.utilidad(d, h)]).then(
      ([ventas, inventario, utilidad]) => ({ ventas, inventario, utilidad })
    );
  }

  function cargarComparacion() {
    setComparando(true);
    setError(null);
    Promise.all([cargarDatosPeriodo(compDesdeA, compHastaA), cargarDatosPeriodo(compDesdeB, compHastaB)])
      .then(([a, b]) => {
        setCompA(a);
        setCompB(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setComparando(false));
  }

  useEffect(() => {
    if (pestana === "comparar" && !compA && !compB) cargarComparacion();
    // Solo la primera vez que se abre la pestaña — después, solo con el botón "Comparar".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pestana]);

  function cargarRango(d: string, h: string) {
    setError(null);
    setCargando(true);
    const anterior = periodoAnterior(d, h);
    Promise.all([
      api.reportes.inventario(d, h),
      api.reportes.precios(d, h),
      api.reportes.ventas(d, h),
      api.reportes.ventas(anterior.desde, anterior.hasta),
      api.reportes.despachos(d, h),
      api.reportes.utilidad(d, h),
    ])
      .then(([inv, prec, ventas, ventasAnterior, despachos, utilidad]) => {
        setReporteInventario(inv);
        setReportePrecios(prec);
        setReporteVentas(ventas);
        setReporteVentasAnterior(ventasAnterior);
        setReporteDespachos(despachos);
        setReporteUtilidad(utilidad);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  function cargar() {
    cargarRango(desde, hasta);
  }

  // Presets rápidos — a pedido del usuario, para no tener que ir a tipear
  // la fecha de hoy (o calcular a mano el lunes de esta semana) cada vez que
  // solo quiere ver "cómo vamos hoy" o comparar unos días entre sí.
  function aplicarPreset(d: string, h: string) {
    setDesde(d);
    setHasta(h);
    cargarRango(d, h);
  }

  function inicioSemana(): string {
    const ahora = new Date();
    const diaSemana = ahora.getDay(); // 0 = domingo
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(ahora);
    lunes.setDate(ahora.getDate() - diasDesdeLunes);
    return lunes.toISOString().slice(0, 10);
  }

  function inicioMes(): string {
    const ahora = new Date();
    return new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString().slice(0, 10);
  }

  const PRESETS: { etiqueta: string; rango: () => [string, string] }[] = [
    { etiqueta: "Hoy", rango: () => [hoy(), hoy()] },
    { etiqueta: "Ayer", rango: () => [fechaHace(1), fechaHace(1)] },
    { etiqueta: "Esta semana", rango: () => [inicioSemana(), hoy()] },
    { etiqueta: "Este mes", rango: () => [inicioMes(), hoy()] },
  ];

  useEffect(cargar, []);

  return (
    <div>
      <h1>Reportes</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="fila-inline">
        {PRESETS.map((p) => (
          <button key={p.etiqueta} type="button" className="boton-chico" onClick={() => aplicarPreset(...p.rango())}>
            {p.etiqueta}
          </button>
        ))}
      </div>
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
            {reporteInventario && (
              <div className="tarjeta tarjeta-mini">
                <strong>Compras</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>{formatoCLP(reporteInventario.comprasTotal)}</p>
                <p className="ayuda">
                  {reporteInventario.comprasDetalle.length} línea{reporteInventario.comprasDetalle.length === 1 ? "" : "s"} de
                  factura
                </p>
              </div>
            )}
            {reporteUtilidad && (
              <div className="tarjeta tarjeta-mini">
                <strong>Gastos</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>{formatoCLP(reporteUtilidad.totalGastos)}</p>
                <p className="ayuda">
                  {reporteUtilidad.gastosDetalle.length} gasto{reporteUtilidad.gastosDetalle.length === 1 ? "" : "s"} en el
                  período
                </p>
              </div>
            )}
            {reporteUtilidad && (
              <div className="tarjeta tarjeta-mini">
                <strong>Utilidad aproximada</strong>
                <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>
                  <span className={reporteUtilidad.utilidadReal < 0 ? "error" : "exito"}>
                    {formatoCLP(reporteUtilidad.utilidadReal)}
                  </span>
                </p>
                <p className="ayuda">
                  real (ventas − costo mercadería − gastos) · simple (sin costo):{" "}
                  {formatoCLP(reporteUtilidad.utilidadSimple)}
                </p>
              </div>
            )}
          </div>

          {reporteUtilidad && (
            <>
              <h3>Utilidad aproximada — no es contabilidad real</h3>
              <p className="ayuda">
                "Simple" solo resta los gastos generales. "Real" además resta el costo de la mercadería vendida —
                más cercana a la ganancia real, pero depende de que el costo de cada producto esté bien cargado (ver
                "Costo" en la ficha de cada producto). Se muestran las dos para comparar, a pedido tuyo.
              </p>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Ventas</th>
                    <th>Costo mercadería</th>
                    <th>Gastos</th>
                    <th>Utilidad simple</th>
                    <th>Utilidad real</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatoCLP(reporteUtilidad.totalVentas)}</td>
                    <td>{formatoCLP(reporteUtilidad.costoMercaderia)}</td>
                    <td>{formatoCLP(reporteUtilidad.totalGastos)}</td>
                    <td className={reporteUtilidad.utilidadSimple < 0 ? "error" : "exito"}>
                      <strong>{formatoCLP(reporteUtilidad.utilidadSimple)}</strong>
                    </td>
                    <td className={reporteUtilidad.utilidadReal < 0 ? "error" : "exito"}>
                      <strong>{formatoCLP(reporteUtilidad.utilidadReal)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              {reporteUtilidad.ventasSinCostoConocido > 0 && (
                <p className="ayuda">
                  {formatoCLP(reporteUtilidad.ventasSinCostoConocido)} en ventas de productos sin ningún costo
                  cargado (ni compra real ni costo de referencia) — no restan nada de "Costo mercadería", así que la
                  utilidad real de este período es, en realidad, algo menor a la que se muestra.
                </p>
              )}

              <h3>Detalle de gastos del período</h3>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Categoría</th>
                    <th>Nombre del gasto</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {reporteUtilidad.gastosDetalle.map((g) => (
                    <tr key={g.id}>
                      <td>{new Date(g.fecha).toLocaleDateString("es-CL")}</td>
                      <td>{g.categoria}</td>
                      <td>{g.descripcion ?? "—"}</td>
                      <td>{formatoCLP(g.monto)}</td>
                    </tr>
                  ))}
                  {reporteUtilidad.gastosDetalle.length === 0 && (
                    <tr>
                      <td colSpan={4}>No hubo gastos en este período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}

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
            Mesón: <strong>{reporteVentas.cantidadVentasLocal}</strong> venta
            {reporteVentas.cantidadVentasLocal === 1 ? "" : "s"} ({formatoCLP(reporteVentas.totalVentasLocal)}) · Online:{" "}
            <strong>{reporteVentas.cantidadVentasOnline}</strong> venta{reporteVentas.cantidadVentasOnline === 1 ? "" : "s"} (
            {formatoCLP(reporteVentas.totalVentasOnline)}) · Mayorista:{" "}
            <strong>{reporteVentas.cantidadVentasMayorista}</strong> venta
            {reporteVentas.cantidadVentasMayorista === 1 ? "" : "s"} ({formatoCLP(reporteVentas.totalVentasMayorista)}).
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

          {reporteVentas.ventasOnlineDetalle.length > 0 && (
            <>
              <h3>Detalle de ventas por internet</h3>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>N° venta</th>
                    <th>Fecha</th>
                    <th>Productos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reporteVentas.ventasOnlineDetalle.map((v) => (
                    <tr key={v.id}>
                      <td>{v.id}</td>
                      <td>{new Date(v.fecha).toLocaleString("es-CL")}</td>
                      <td>{v.cantidadItems}</td>
                      <td>{formatoCLP(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

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

          <h3>Menos vendidos</h3>
          <p className="ayuda">Entre los que sí tuvieron alguna venta en el período — no incluye los que no se vendieron nada.</p>
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
              {reporteVentas.menosVendidosPorCantidad.map((p) => (
                <tr key={p.productoId}>
                  <td>{p.plu}</td>
                  <td>{p.descripcion}</td>
                  <td>{p.cantidad}</td>
                  <td>{formatoCLP(p.ingreso)}</td>
                </tr>
              ))}
              {reporteVentas.menosVendidosPorCantidad.length === 0 && (
                <tr>
                  <td colSpan={4}>No hubo ventas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {pestana === "comparar" && (
        <section className="tarjeta">
          <h2>Comparar fechas</h2>
          <p className="ayuda">
            Elige dos rangos de fecha independientes (no tienen que ser del mismo largo) para comparar ventas,
            compras, gastos y utilidad entre ellos — distinto al resto de la pantalla, que siempre compara contra "el
            período justo anterior".
          </p>

          <div className="fila-inline" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: "1.5rem" }}>
            <div>
              <strong className="ayuda">Período A</strong>
              <div className="fila-inline">
                <label>
                  Desde
                  <input type="date" value={compDesdeA} onChange={(e) => setCompDesdeA(e.target.value)} />
                </label>
                <label>
                  Hasta
                  <input type="date" value={compHastaA} onChange={(e) => setCompHastaA(e.target.value)} />
                </label>
              </div>
            </div>
            <strong style={{ fontSize: "1.3rem" }}>vs</strong>
            <div>
              <strong className="ayuda">Período B</strong>
              <div className="fila-inline">
                <label>
                  Desde
                  <input type="date" value={compDesdeB} onChange={(e) => setCompDesdeB(e.target.value)} />
                </label>
                <label>
                  Hasta
                  <input type="date" value={compHastaB} onChange={(e) => setCompHastaB(e.target.value)} />
                </label>
              </div>
            </div>
            <button type="button" className="boton boton-primario" onClick={cargarComparacion} disabled={comparando}>
              {comparando ? "Comparando..." : "Comparar"}
            </button>
          </div>

          {comparando && !compA && <p>Cargando...</p>}

          {compA && compB && (
            <>
              <h3>Resumen comparado</h3>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th>Período A</th>
                    <th>Período B</th>
                    <th>Variación</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Ventas totales</td>
                    <td>{formatoCLP(compA.ventas.totalVentas)}</td>
                    <td>{formatoCLP(compB.ventas.totalVentas)}</td>
                    <td><Comparacion actual={compB.ventas.totalVentas} anterior={compA.ventas.totalVentas} /></td>
                  </tr>
                  <tr>
                    <td>Cantidad de ventas</td>
                    <td>{compA.ventas.cantidadVentas}</td>
                    <td>{compB.ventas.cantidadVentas}</td>
                    <td><Comparacion actual={compB.ventas.cantidadVentas} anterior={compA.ventas.cantidadVentas} /></td>
                  </tr>
                  <tr>
                    <td>Ticket promedio</td>
                    <td>{formatoCLP(ticketPromedio(compA))}</td>
                    <td>{formatoCLP(ticketPromedio(compB))}</td>
                    <td><Comparacion actual={ticketPromedio(compB)} anterior={ticketPromedio(compA)} /></td>
                  </tr>
                  <tr>
                    <td>Compras</td>
                    <td>{formatoCLP(compA.inventario.comprasTotal)}</td>
                    <td>{formatoCLP(compB.inventario.comprasTotal)}</td>
                    <td><Comparacion actual={compB.inventario.comprasTotal} anterior={compA.inventario.comprasTotal} /></td>
                  </tr>
                  <tr>
                    <td>Gastos</td>
                    <td>{formatoCLP(compA.utilidad.totalGastos)}</td>
                    <td>{formatoCLP(compB.utilidad.totalGastos)}</td>
                    <td><Comparacion actual={compB.utilidad.totalGastos} anterior={compA.utilidad.totalGastos} /></td>
                  </tr>
                  <tr>
                    <td>Utilidad simple (ventas − gastos)</td>
                    <td>{formatoCLP(compA.utilidad.utilidadSimple)}</td>
                    <td>{formatoCLP(compB.utilidad.utilidadSimple)}</td>
                    <td><Comparacion actual={compB.utilidad.utilidadSimple} anterior={compA.utilidad.utilidadSimple} /></td>
                  </tr>
                  <tr>
                    <td>Utilidad real (− costo mercadería)</td>
                    <td>{formatoCLP(compA.utilidad.utilidadReal)}</td>
                    <td>{formatoCLP(compB.utilidad.utilidadReal)}</td>
                    <td><Comparacion actual={compB.utilidad.utilidadReal} anterior={compA.utilidad.utilidadReal} /></td>
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.5rem" }}>
                <div>
                  <h3>Más vendidos (Período B)</h3>
                  <table className="tabla">
                    <thead>
                      <tr><th>Producto</th><th>Cantidad</th><th>Ingreso</th></tr>
                    </thead>
                    <tbody>
                      {compB.ventas.masVendidosPorIngreso.slice(0, 5).map((p) => (
                        <tr key={p.productoId}>
                          <td>{p.descripcion}</td>
                          <td>{p.cantidad}</td>
                          <td>{formatoCLP(p.ingreso)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3>Menos vendidos (Período B)</h3>
                  <table className="tabla">
                    <thead>
                      <tr><th>Producto</th><th>Cantidad</th><th>Ingreso</th></tr>
                    </thead>
                    <tbody>
                      {compB.ventas.menosVendidosPorCantidad.slice(0, 5).map((p) => (
                        <tr key={p.productoId}>
                          <td>{p.descripcion}</td>
                          <td>{p.cantidad}</td>
                          <td>{formatoCLP(p.ingreso)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <h3>Ventas por categoría</h3>
              <p className="ayuda">Haz clic en una categoría para ver su detalle completo y comparar los dos períodos.</p>
              <div className="lista-categorias-comparar">
                {compB.ventas.porCategoria.map((catB) => {
                  const catA = compA.ventas.porCategoria.find((c) => c.categoria === catB.categoria);
                  const abierta = categoriaAbierta === catB.categoria;
                  const porcentajeDelTotal =
                    compB.ventas.totalVentas > 0 ? (catB.ingreso / compB.ventas.totalVentas) * 100 : 0;
                  return (
                    <div key={catB.categoria} className="tarjeta" style={{ marginBottom: "0.75rem" }}>
                      <button
                        type="button"
                        onClick={() => setCategoriaAbierta(abierta ? null : catB.categoria)}
                        className="fila-inline"
                        style={{ width: "100%", justifyContent: "space-between", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        <strong>{abierta ? "▼" : "▶"} {catB.categoria}</strong>
                        <span className="ayuda">
                          {formatoCLP(catB.ingreso)} (B) · {catA ? formatoCLP(catA.ingreso) : "$0"} (A)
                        </span>
                      </button>
                      {abierta && (
                        <div style={{ marginTop: "1rem" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "1rem" }}>
                            <div className="tarjeta tarjeta-mini">
                              <span className="ayuda">Ingreso</span>
                              <p style={{ fontSize: "1.2rem", margin: "0.25rem 0" }}>{formatoCLP(catB.ingreso)}</p>
                              <Comparacion actual={catB.ingreso} anterior={catA?.ingreso ?? 0} />
                            </div>
                            <div className="tarjeta tarjeta-mini">
                              <span className="ayuda">Cantidad vendida</span>
                              <p style={{ fontSize: "1.2rem", margin: "0.25rem 0" }}>{catB.cantidad.toLocaleString("es-CL")}</p>
                              <Comparacion actual={catB.cantidad} anterior={catA?.cantidad ?? 0} />
                            </div>
                            <div className="tarjeta tarjeta-mini">
                              <span className="ayuda">% del total vendido (B)</span>
                              <p style={{ fontSize: "1.2rem", margin: "0.25rem 0" }}>{porcentajeDelTotal.toFixed(1)}%</p>
                            </div>
                          </div>
                          <table className="tabla" style={{ marginTop: "1rem" }}>
                            <thead>
                              <tr><th>Producto</th><th>Cantidad</th><th>Ingreso</th></tr>
                            </thead>
                            <tbody>
                              {catB.masVendidos.map((p) => (
                                <tr key={p.productoId}>
                                  <td>{p.descripcion}</td>
                                  <td>{p.cantidad}</td>
                                  <td>{formatoCLP(p.ingreso)}</td>
                                </tr>
                              ))}
                              {catB.masVendidos.length === 0 && (
                                <tr>
                                  <td colSpan={3}>Sin ventas de esta categoría en el período B.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {compB.ventas.porCategoria.length === 0 && <p className="ayuda">No hubo ventas por categoría en el período B.</p>}
              </div>
            </>
          )}
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
            <div>
              <strong>Compras:</strong> {formatoCLP(reporteInventario.comprasTotal)}
            </div>
          </div>

          <h3>Salidas por motivo</h3>
          <GraficoTorta
            datos={Object.entries(reporteInventario.salidasPorMotivo)
              .filter(([, cantidad]) => cantidad > 0)
              .map(([motivo, cantidad]) => ({ etiqueta: etiquetasMotivo[motivo] ?? motivo, valor: cantidad }))}
          />

          <h3>Detalle de compras del período</h3>
          <p className="ayuda">
            Incluye lo cargado por "Cargar factura" (congelados y productos por unidad) y lo ingresado por
            "Ingreso a cámara" (carne fresca por peso).
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Origen</th>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Proveedor</th>
                <th>N° factura</th>
                <th>Cantidad</th>
                <th>Costo unitario</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {reporteInventario.comprasDetalle.map((c) => (
                <tr key={`${c.fuente}-${c.id}`}>
                  <td>{new Date(c.fecha).toLocaleDateString("es-CL")}</td>
                  <td>{c.fuente === "camara" ? "Cámara" : "Factura"}</td>
                  <td>{c.plu}</td>
                  <td>{c.descripcion}</td>
                  <td>{c.proveedor ?? "—"}</td>
                  <td>{c.numeroFactura ?? "—"}</td>
                  <td>
                    {c.cantidad} {c.fuente === "camara" ? "kg" : ""}
                  </td>
                  <td>{c.costoUnitario != null ? formatoCLP(c.costoUnitario) : "—"}</td>
                  <td>{formatoCLP(c.subtotal)}</td>
                </tr>
              ))}
              {reporteInventario.comprasDetalle.length === 0 && (
                <tr>
                  <td colSpan={9}>No hubo compras registradas en este período.</td>
                </tr>
              )}
            </tbody>
          </table>

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

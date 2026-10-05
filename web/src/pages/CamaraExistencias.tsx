import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  formatoCLP,
  calcularMargen,
  FAMILIAS_CAMARA,
  PROCEDENCIAS_VACUNO,
  type CajaCamara,
  type DestinoSalidaCamara,
  type ExistenciasCamara,
  type FamiliaCamara,
  type LoteCamara,
  type ProcedenciaCamara,
  type Producto,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { imprimirEtiquetaCamara, imprimirEtiquetasLoteCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";
import { DESTINOS_CAMARA } from "../lib/destinoCamara";

const MOTIVOS_ANULAR_LOTE = ["Lote de prueba", "Entrada duplicada", "Datos incorrectos"];

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FormularioCorreccion {
  familia: FamiliaCamara;
  procedencia: ProcedenciaCamara | "";
  buscarProducto: string;
  productos: Producto[];
  productoSeleccionado: Producto | null;
  pesoTotalKg: string;
  costoNetoKg: string;
}

function formularioDesdeLote(lote: LoteCamara): FormularioCorreccion {
  return {
    familia: lote.familiaNombre as FamiliaCamara,
    procedencia: (lote.procedencia as ProcedenciaCamara) ?? "",
    buscarProducto: "",
    productos: [],
    productoSeleccionado: lote.producto,
    pesoTotalKg: String(lote.pesoTotalKg),
    costoNetoKg: String(lote.costoNetoKg),
  };
}

// Pantalla nueva a pedido del usuario, para calzar con el "Existencias" del
// sistema que ya usaba su papá: stock actual agrupado por familia/producto
// (arriba) y, en una sección aparte, el detalle de lotes para corregir,
// reimprimir o anular como grupo — bloqueado si cualquier caja del lote ya
// tuvo una salida (mismo principio que "Revisar entradas").
export default function CamaraExistencias() {
  const { usuario } = useUsuario();

  const [existencias, setExistencias] = useState<ExistenciasCamara | null>(null);
  const [lotes, setLotes] = useState<LoteCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [corrigiendoId, setCorrigiendoId] = useState<number | null>(null);
  const [formCorreccion, setFormCorreccion] = useState<FormularioCorreccion | null>(null);
  const [guardandoCorreccion, setGuardandoCorreccion] = useState(false);

  const [anulandoId, setAnulandoId] = useState<number | null>(null);

  const [reimprimiendo, setReimprimiendo] = useState<CajaCamara[] | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<number | null>(null);
  const [imprimiendoLote, setImprimiendoLote] = useState(false);

  // Resolver una caja estancada directo desde esta pantalla (ver sección más
  // abajo) — registra una salida real igual que la pantalla dedicada
  // (Salida de cámara), para no dejar estas cajas acumulándose sin que
  // nadie sepa qué pasó con ellas. Un solo formulario abierto a la vez.
  const [resolviendoId, setResolviendoId] = useState<number | null>(null);
  const [formResolver, setFormResolver] = useState<{
    destino: DestinoSalidaCamara;
    pesoKg: string;
    motivo: string;
    mayoristaCliente: string;
    mayoristaPrecio: string;
    mayoristaEstadoPago: "pagado" | "pendiente";
  } | null>(null);
  const [guardandoResolver, setGuardandoResolver] = useState(false);

  async function cargar(filtro?: { desde: string; hasta: string }, e?: React.FormEvent) {
    e?.preventDefault();
    const f = filtro ?? { desde, hasta };
    setError(null);
    setCargando(true);
    try {
      const [existenciasData, lotesData] = await Promise.all([
        api.camara.existencias({ desde: f.desde || undefined, hasta: f.hasta || undefined }),
        api.camara.lotes(),
      ]);
      setExistencias(existenciasData);
      setLotes(lotesData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiarFiltroFechas() {
    setDesde("");
    setHasta("");
    cargar({ desde: "", hasta: "" });
  }

  // Agrupa por familia con subtotal, igual que ya lo mostraba el sistema
  // que usaba el papá del usuario.
  const familias = [...new Set(existencias?.porProducto.map((g) => g.familia) ?? [])];

  const buscarProductoCorreccion = formCorreccion?.buscarProducto ?? "";
  useEffect(() => {
    if (!formCorreccion || !buscarProductoCorreccion.trim()) return;
    const timeout = setTimeout(() => {
      api.productos
        .listar({ buscar: buscarProductoCorreccion })
        .then((productos) => setFormCorreccion((f) => (f ? { ...f, productos } : f)))
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarProductoCorreccion]);

  function abrirCorreccion(lote: LoteCamara) {
    setCorrigiendoId(lote.id);
    setFormCorreccion(formularioDesdeLote(lote));
    setError(null);
  }

  async function guardarCorreccion() {
    if (!formCorreccion || !formCorreccion.productoSeleccionado || !usuario || corrigiendoId == null) return;
    const pesoTotalKg = Number(formCorreccion.pesoTotalKg);
    const costoNetoKg = Number(formCorreccion.costoNetoKg);
    if (!pesoTotalKg || pesoTotalKg <= 0) {
      setError("Ingresa el peso total del lote");
      return;
    }
    if (!costoNetoKg || costoNetoKg < 0) {
      setError("Ingresa el costo neto por kilo");
      return;
    }
    if (formCorreccion.familia === "Vacuno" && !formCorreccion.procedencia) {
      setError("Elige la procedencia (Nacional, Brasil o Paraguay)");
      return;
    }
    setGuardandoCorreccion(true);
    setError(null);
    try {
      await api.camara.corregirLote(corrigiendoId, {
        productoId: formCorreccion.productoSeleccionado.id,
        familia: formCorreccion.familia,
        ...(formCorreccion.familia === "Vacuno" ? { procedencia: formCorreccion.procedencia as ProcedenciaCamara } : {}),
        pesoTotalKg,
        costoNetoKg,
        usuarioId: usuario.id,
      });
      mostrarToast("Lote corregido", formCorreccion.productoSeleccionado.descripcion);
      setCorrigiendoId(null);
      setFormCorreccion(null);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoCorreccion(false);
    }
  }

  async function reimprimirLote(loteId: number) {
    setError(null);
    try {
      const lote = await api.camara.obtenerLote(loteId);
      if (!lote.cajas || lote.cajas.length === 0) {
        setError("No se encontraron cajas asociadas a este lote.");
        return;
      }
      setReimprimiendo(lote.cajas);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function imprimirUnaReimpresa(id: number) {
    setImprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setImprimiendoId(null), 500);
    }, 0);
  }

  function imprimirTodasReimpresas() {
    if (!reimprimiendo || reimprimiendo.length < 2) return;
    const primera = String(reimprimiendo[0].id).padStart(6, "0");
    const ultima = String(reimprimiendo[reimprimiendo.length - 1].id).padStart(6, "0");
    const confirmado = window.confirm(
      `Se reimprimirán ${reimprimiendo.length} etiquetas, desde la caja ${primera} hasta la ${ultima}. Los números originales se conservan, no se crea ninguna caja nueva.\n\nAntes de continuar verifica que "Copias" esté en 1.`
    );
    if (!confirmado) return;
    setImprimiendoLote(true);
    setTimeout(() => {
      imprimirEtiquetasLoteCamara();
      setTimeout(() => setImprimiendoLote(false), 500);
    }, 0);
  }

  async function confirmarAnulacion(usuarioAutorizaId: number, clave: string, motivo?: string) {
    if (anulandoId == null) return;
    setError(null);
    await api.camara.anularLote(anulandoId, usuarioAutorizaId, clave, motivo ?? "");
    mostrarToast("Lote anulado", undefined, "eliminado");
    setAnulandoId(null);
    await cargar();
  }

  function abrirResolver(c: ExistenciasCamara["cajasEstancadas"][number]) {
    setResolviendoId(c.cajaId);
    setFormResolver({
      destino: "sala_venta",
      pesoKg: String(c.saldoKg),
      motivo: "",
      mayoristaCliente: "",
      mayoristaPrecio: "",
      mayoristaEstadoPago: "pendiente",
    });
  }

  function cerrarResolver() {
    setResolviendoId(null);
    setFormResolver(null);
  }

  async function confirmarResolver(c: ExistenciasCamara["cajasEstancadas"][number]) {
    if (!usuario || !formResolver) return;
    setError(null);
    const pesoKg = Number(formResolver.pesoKg.replace(",", "."));
    if (!formResolver.pesoKg.trim() || Number.isNaN(pesoKg) || pesoKg <= 0) {
      setError("El peso no es válido");
      return;
    }
    if (formResolver.destino === "mayorista") {
      const precio = Number(formResolver.mayoristaPrecio);
      if (!formResolver.mayoristaPrecio.trim() || Number.isNaN(precio) || precio <= 0) {
        setError("Falta el precio de la venta por mayor");
        return;
      }
    }
    setGuardandoResolver(true);
    try {
      await api.camara.salida(c.cajaId, {
        destino: formResolver.destino,
        pesoKg,
        motivo:
          formResolver.motivo.trim() ||
          `Salida atrasada — caja sin movimiento desde hace ${c.diasEnCamara} días, registrada ahora al revisarla`,
        usuarioId: usuario.id,
        version: c.version,
        ...(formResolver.destino === "mayorista"
          ? {
              mayorista: {
                clienteNombre: formResolver.mayoristaCliente.trim() || undefined,
                precioTotal: Number(formResolver.mayoristaPrecio),
                estadoPago: formResolver.mayoristaEstadoPago,
              },
            }
          : {}),
      });
      mostrarToast("Salida registrada", `Caja ${c.numero} (${c.producto}) ya no queda estancada.`);
      cerrarResolver();
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoResolver(false);
    }
  }

  if (reimprimiendo) {
    return (
      <div>
        <div className="no-imprimir">
          <div className="encabezado-pantalla">
            <h1>Reimprimir lote</h1>
            <button type="button" className="boton" onClick={() => setReimprimiendo(null)}>
              Volver a Existencias
            </button>
          </div>
          <p className="ayuda">
            Los números originales se conservan — no se crea ninguna caja nueva. Imprime cada etiqueta con el botón
            correspondiente, o todo el lote de una vez.
          </p>
          {reimprimiendo.length > 1 && (
            <button type="button" className="boton boton-peligro" onClick={imprimirTodasReimpresas}>
              ⚡ Imprimir lote completo ({reimprimiendo.length})
            </button>
          )}
        </div>
        <div className={`etiquetas-camara${imprimiendoLote ? " imprimiendo-lote" : ""}`}>
          {reimprimiendo.map((caja) => (
            <div key={caja.id} className="etiqueta-bloque">
              <EtiquetaCamara
                numero={String(caja.id).padStart(6, "0")}
                producto={caja.producto.descripcion}
                familia={caja.familiaNombre}
                procedencia={caja.procedencia}
                fechaIngreso={caja.fechaIngreso}
                pesoInicialKg={caja.pesoInicialKg}
                pesoEstimado={caja.pesoEstimado}
                imprimiendo={imprimiendoId === caja.id || imprimiendoLote}
              />
              <button type="button" className="boton no-imprimir" onClick={() => imprimirUnaReimpresa(caja.id)}>
                Imprimir caja {String(caja.id).padStart(6, "0")}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Existencias actuales</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={(e) => cargar(undefined, e)} className="fila-inline">
        <label>
          Ingresadas desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button type="submit">{cargando ? "Buscando..." : "Filtrar"}</button>
        {(desde || hasta) && (
          <button type="button" className="boton" onClick={limpiarFiltroFechas}>
            Quitar filtro
          </button>
        )}
      </form>
      <p className="ayuda">
        Sin filtro se muestra todo lo que hay guardado ahora en cámara. El filtro se aplica sobre la fecha en que cada
        caja ingresó.
      </p>
      {cargando && <p>Cargando...</p>}

      {existencias && (
        <section className="tarjeta">
          <div className="fila-inline">
            <div>
              <strong>Cajas disponibles:</strong> {existencias.totalCajas}
            </div>
            <div>
              <strong>Kilos disponibles:</strong> {existencias.totalKilos.toFixed(3)} kg
            </div>
            <div>
              <strong>Valor neto (costo):</strong> {formatoCLP(existencias.totalValor)}
            </div>
            <div>
              <strong>Valor de venta potencial:</strong> {formatoCLP(existencias.totalValorVenta)}
            </div>
          </div>
        </section>
      )}

      <h2>Cajas disponibles por producto</h2>
      <table className="tabla">
        <thead>
          <tr>
            <th>Familia</th>
            <th>Producto</th>
            <th>Cantidad de cajas</th>
            <th>Kilos</th>
            <th>Valor (costo)</th>
            <th>Valor (venta)</th>
            <th>Margen (%)</th>
            <th>Costo/kg últimas 2 compras</th>
          </tr>
        </thead>
        <tbody>
          {existencias?.porProducto.length === 0 && (
            <tr>
              <td colSpan={8}>No hay cajas disponibles en cámara.</td>
            </tr>
          )}
          {familias.map((familia) => {
            const filas = existencias?.porProducto.filter((g) => g.familia === familia) ?? [];
            const subtotalCajas = filas.reduce((s, g) => s + g.cajas, 0);
            const subtotalKilos = filas.reduce((s, g) => s + g.kilos, 0);
            const subtotalValorCosto = filas.reduce((s, g) => s + g.valorCosto, 0);
            const subtotalValorVenta = filas.reduce((s, g) => s + g.valorVenta, 0);
            const margenSubtotal = calcularMargen(subtotalValorVenta, subtotalValorCosto);
            return (
              <Fragment key={familia}>
                {filas.map((g) => {
                  // valorVenta y valorCosto ya son kilos × precio/costo por kg —
                  // al dividir uno sobre el otro los kilos se cancelan, así que
                  // calcularMargen(total venta, total costo) da el mismo margen
                  // (%) que si se calculara por kilo, sin tener que despejarlo.
                  const margen = calcularMargen(g.valorVenta, g.valorCosto);
                  return (
                    <tr key={`${g.familia}-${g.producto}`} className={g.bajoStock ? "fila-error" : ""}>
                      <td>
                        <b>{g.familia}</b>
                      </td>
                      <td>{g.producto}</td>
                      <td>
                        <b>{g.cajas}</b>
                        {g.bajoStock && " (stock bajo)"}
                      </td>
                      <td>{g.kilos.toFixed(3)} kg</td>
                      <td>{formatoCLP(g.valorCosto)}</td>
                      <td>{formatoCLP(g.valorVenta)}</td>
                      <td>
                        {margen != null ? (
                          <strong className={margen < 0 ? "error" : "exito"}>{margen.toFixed(2)}%</strong>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {g.ultimosCostos.length === 0 ? (
                          "—"
                        ) : (
                          <>
                            {formatoCLP(g.ultimosCostos[0])}
                            {g.ultimosCostos.length > 1 && (
                              <span className="ayuda"> (antes {formatoCLP(g.ultimosCostos[1])})</span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="fila-total">
                  <td colSpan={2}>Total {familia}</td>
                  <td>{subtotalCajas}</td>
                  <td>{subtotalKilos.toFixed(3)} kg</td>
                  <td>{formatoCLP(subtotalValorCosto)}</td>
                  <td>{formatoCLP(subtotalValorVenta)}</td>
                  <td>
                    {margenSubtotal != null ? (
                      <strong className={margenSubtotal < 0 ? "error" : "exito"}>{margenSubtotal.toFixed(2)}%</strong>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td></td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {existencias && existencias.cajasEstancadas.length > 0 && (
        <section className="tarjeta aviso-estancadas">
          <h3>⚠ Cajas sin movimiento hace más de una semana</h3>
          <p className="ayuda">
            Nunca tuvieron ninguna salida (ni parcial) desde que ingresaron — revísalas para no dejarlas olvidadas.
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Producto</th>
                <th>Familia</th>
                <th>Ingreso</th>
                <th>Días en cámara</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {existencias.cajasEstancadas.map((c) => (
                <Fragment key={c.cajaId}>
                  <tr>
                    <td>{c.numero}</td>
                    <td>{c.producto}</td>
                    <td>{c.familia}</td>
                    <td>{new Date(c.fechaIngreso).toLocaleDateString("es-CL")}</td>
                    <td>
                      <b>{c.diasEnCamara}</b>
                    </td>
                    <td>
                      {resolviendoId !== c.cajaId && (
                        <button type="button" className="boton-chico" onClick={() => abrirResolver(c)}>
                          Registrar salida
                        </button>
                      )}
                    </td>
                  </tr>
                  {resolviendoId === c.cajaId && formResolver && (
                    <tr>
                      <td colSpan={6}>
                        <div className="tarjeta tarjeta-mini">
                          <p className="ayuda">
                            Para esta caja ya no quede estancada — si en realidad se vendió/usó hace tiempo y nadie
                            lo registró, es esto. Si no sabes qué pasó con ella de verdad, ve a pesarla y haz un
                            conteo de inventario en vez de adivinar acá.
                          </p>
                          <div className="fila-inline">
                            <label>
                              Destino
                              <select
                                value={formResolver.destino}
                                onChange={(e) =>
                                  setFormResolver({ ...formResolver, destino: e.target.value as DestinoSalidaCamara })
                                }
                              >
                                {DESTINOS_CAMARA.map((d) => (
                                  <option key={d.valor} value={d.valor}>
                                    {d.icono} {d.etiqueta}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Peso (kg)
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                className="input-chico"
                                value={formResolver.pesoKg}
                                onChange={(e) => setFormResolver({ ...formResolver, pesoKg: e.target.value })}
                              />
                            </label>
                            <label>
                              Motivo (opcional)
                              <input
                                type="text"
                                value={formResolver.motivo}
                                onChange={(e) => setFormResolver({ ...formResolver, motivo: e.target.value })}
                                placeholder="ej. se vendió hace 2 semanas, se me olvidó registrarla"
                              />
                            </label>
                          </div>
                          {formResolver.destino === "mayorista" && (
                            <div className="fila-inline">
                              <label>
                                Cliente (opcional)
                                <input
                                  type="text"
                                  value={formResolver.mayoristaCliente}
                                  onChange={(e) =>
                                    setFormResolver({ ...formResolver, mayoristaCliente: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                Precio total
                                <input
                                  type="number"
                                  min="1"
                                  value={formResolver.mayoristaPrecio}
                                  onChange={(e) =>
                                    setFormResolver({ ...formResolver, mayoristaPrecio: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                Estado de pago
                                <select
                                  value={formResolver.mayoristaEstadoPago}
                                  onChange={(e) =>
                                    setFormResolver({
                                      ...formResolver,
                                      mayoristaEstadoPago: e.target.value as "pagado" | "pendiente",
                                    })
                                  }
                                >
                                  <option value="pendiente">Pendiente</option>
                                  <option value="pagado">Pagado</option>
                                </select>
                              </label>
                            </div>
                          )}
                          <div className="fila-inline">
                            <button
                              type="button"
                              className="boton boton-primario"
                              disabled={guardandoResolver}
                              onClick={() => confirmarResolver(c)}
                            >
                              {guardandoResolver ? "Guardando..." : "Confirmar salida"}
                            </button>
                            <button type="button" onClick={cerrarResolver} disabled={guardandoResolver}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <details className="detalle-lotes">
        <summary>Ver lotes ingresados para cuadratura y correcciones</summary>
        <p className="ayuda">Desde aquí puede corregir un lote, volver a imprimir sus etiquetas o anularlo.</p>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Cajas</th>
              <th>Kilos totales</th>
              <th>Total neto</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lotes.length === 0 && (
              <tr>
                <td colSpan={6}>Todavía no hay lotes ingresados.</td>
              </tr>
            )}
            {lotes.map((lote) => (
              <tr key={lote.id}>
                <td>{new Date(lote.fechaIngreso).toLocaleString("es-CL")}</td>
                <td>
                  <b>{lote.producto.descripcion}</b>
                  {lote.reconstruido && (
                    <>
                      <br />
                      <span className="ayuda">Lote reconstruido</span>
                    </>
                  )}
                </td>
                <td>
                  <b>{lote.cajas?.length ?? lote.cantidadCajas}</b>
                  <br />
                  <span className="ayuda">{lote.numerosCajas}</span>
                </td>
                <td>{lote.pesoTotalKg.toFixed(3)} kg</td>
                <td>
                  <b>{formatoCLP(lote.totalNeto)}</b>
                </td>
                <td>
                  <div className="fila-inline">
                    <button
                      type="button"
                      className="boton"
                      disabled={lote.bloqueado}
                      title={lote.bloqueado ? "Ya tiene salidas" : undefined}
                      onClick={() => abrirCorreccion(lote)}
                    >
                      Corregir
                    </button>
                    <button type="button" className="boton boton-primario" onClick={() => reimprimirLote(lote.id)}>
                      Reimprimir
                    </button>
                    <button
                      type="button"
                      className="boton boton-peligro"
                      disabled={lote.bloqueado}
                      title={lote.bloqueado ? "Ya tiene salidas" : undefined}
                      onClick={() => {
                        setAnulandoId(lote.id);
                        setError(null);
                      }}
                    >
                      Anular
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {corrigiendoId != null && formCorreccion && (
          <div className="tarjeta" style={{ marginTop: "1rem" }}>
            <h3>Corregir lote</h3>
            <p className="ayuda">La corrección conservará exactamente los mismos números de caja.</p>
            <div className="formulario">
              <label>
                Familia correcta
                <select
                  value={formCorreccion.familia}
                  onChange={(e) => {
                    const nueva = e.target.value as FamiliaCamara;
                    setFormCorreccion((f) => (f ? { ...f, familia: nueva, procedencia: nueva === "Vacuno" ? f.procedencia : "" } : f));
                  }}
                >
                  {FAMILIAS_CAMARA.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              {formCorreccion.familia === "Vacuno" && (
                <label>
                  Procedencia correcta
                  <select
                    value={formCorreccion.procedencia}
                    onChange={(e) =>
                      setFormCorreccion((f) => (f ? { ...f, procedencia: e.target.value as ProcedenciaCamara } : f))
                    }
                  >
                    <option value="">Seleccione...</option>
                    {PROCEDENCIAS_VACUNO.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Producto correcto
                <div className="buscador-producto">
                  <input
                    type="text"
                    placeholder="Buscar por PLU o nombre..."
                    value={formCorreccion.buscarProducto}
                    onChange={(e) =>
                      setFormCorreccion((f) => (f ? { ...f, buscarProducto: e.target.value, productoSeleccionado: null } : f))
                    }
                  />
                  {formCorreccion.buscarProducto.trim() && (
                    <div className="resultados-busqueda">
                      {formCorreccion.productos.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                      {formCorreccion.productos.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="resultado-item"
                          onClick={() =>
                            setFormCorreccion((f) =>
                              f ? { ...f, productoSeleccionado: p, buscarProducto: "", productos: [] } : f
                            )
                          }
                        >
                          {p.plu} — {p.descripcion} ({p.categoria.nombre})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {formCorreccion.productoSeleccionado && (
                  <p className="exito">Producto elegido: {formCorreccion.productoSeleccionado.descripcion}</p>
                )}
              </label>
              <label>
                Peso total del lote (kg)
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={formCorreccion.pesoTotalKg}
                  onChange={(e) => setFormCorreccion((f) => (f ? { ...f, pesoTotalKg: e.target.value } : f))}
                />
              </label>
              <label>
                Valor neto por kilo ($)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formCorreccion.costoNetoKg}
                  onChange={(e) => setFormCorreccion((f) => (f ? { ...f, costoNetoKg: e.target.value } : f))}
                />
              </label>
              {formCorreccion.pesoTotalKg && formCorreccion.costoNetoKg && (
                <p>
                  <b>TOTAL NETO CORREGIDO:</b>{" "}
                  {formatoCLP(Math.round(Number(formCorreccion.pesoTotalKg) * Number(formCorreccion.costoNetoKg)))}
                </p>
              )}
              <div className="acciones-formulario">
                <button
                  type="button"
                  className="boton boton-primario"
                  disabled={guardandoCorreccion}
                  onClick={guardarCorreccion}
                >
                  {guardandoCorreccion ? "Guardando..." : "Guardar cambios"}
                </button>
                <button
                  type="button"
                  className="boton"
                  disabled={guardandoCorreccion}
                  onClick={() => {
                    setCorrigiendoId(null);
                    setFormCorreccion(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </details>

      {anulandoId != null && (
        <ModalConfirmarClave
          titulo="Anular lote"
          descripcion="Se anulan todas las cajas del lote de una vez. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={MOTIVOS_ANULAR_LOTE}
          onConfirmar={confirmarAnulacion}
          onCancelar={() => setAnulandoId(null)}
        />
      )}
    </div>
  );
}

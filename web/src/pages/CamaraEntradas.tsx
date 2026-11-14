import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type CajaCamara } from "../api";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const MOTIVOS_ANULAR_CAJA = ["Caja de prueba", "Entrada duplicada", "Datos incorrectos"];

// Clave para "sin factura asociada" (cajas sin lote, o de un lote sin
// proveedor/N° de factura — ej. entradas de antes de que existiera este
// campo) — se agrupan todas juntas en vez de desaparecer o romper el
// agrupamiento por factura.
const SIN_FACTURA = "sin-factura";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  en_camara: "En cámara",
  parcial: "Parcial",
  salida: "Salida",
  ajuste_pendiente: "Ajuste pendiente",
  anulada: "Anulada",
};

interface GrupoFactura {
  clave: string;
  proveedor: string;
  numeroFactura: string;
  fecha: string;
  total: number;
  cantidadLineas: number;
  cajas: CajaCamara[];
}

// Agrupa las cajas por factura (proveedor + N° de factura, vía
// caja.lote) — a pedido del usuario, para poder "identificar las
// facturas ingresadas y saber si se registraron bien" de un vistazo, en
// vez de una lista plana de cajas sueltas donde una factura con varias
// líneas (cada línea es un lote, ver LoteCamara) se veía como filas
// sin ninguna relación visible entre ellas.
function agruparPorFactura(cajas: CajaCamara[]): GrupoFactura[] {
  const grupos = new Map<string, GrupoFactura>();
  for (const c of cajas) {
    const proveedorId = c.lote?.proveedorId ?? null;
    const numeroFactura = c.lote?.numeroFactura?.trim() ?? "";
    const clave = proveedorId && numeroFactura ? `${proveedorId}|${numeroFactura.toLowerCase()}` : SIN_FACTURA;
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        clave,
        proveedor: c.lote?.proveedor?.nombre ?? "Sin proveedor",
        numeroFactura: numeroFactura || "Sin N° de factura",
        fecha: c.fechaIngreso,
        total: 0,
        cantidadLineas: 0,
        cajas: [],
      };
      grupos.set(clave, grupo);
    }
    if (c.fechaIngreso < grupo.fecha) grupo.fecha = c.fechaIngreso;
    grupo.total += Math.round(c.pesoInicialKg * c.costoNetoKg);
    grupo.cajas.push(c);
  }
  for (const grupo of grupos.values()) {
    grupo.cantidadLineas = new Set(grupo.cajas.map((c) => c.loteId ?? c.id)).size;
  }
  // Más reciente primero, "Sin factura" al final (es la excepción, no lo
  // que se quiere ver primero al revisar).
  return Array.from(grupos.values()).sort((a, b) => {
    if (a.clave === SIN_FACTURA) return 1;
    if (b.clave === SIN_FACTURA) return -1;
    return b.fecha.localeCompare(a.fecha);
  });
}

// Pantalla para revisar las entradas de cámara de un rango de fechas — a
// pedido del usuario, tras hacer pruebas y no tener forma de corregir una
// entrada equivocada (ej. duplicada) sin arriesgar quedar con stock de más
// en cámara. "Anular" solo está disponible mientras la caja siga
// exactamente como se creó (sin ninguna salida registrada todavía) — si ya
// se le sacó algo, hay que corregirlo aparte (el servidor igual lo
// rechaza, esto solo evita el intento).
export default function CamaraEntradas() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [cajas, setCajas] = useState<CajaCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [anulandoId, setAnulandoId] = useState<number | null>(null);
  const [reimprimiendoId, setReimprimiendoId] = useState<number | null>(null);

  // Qué factura(s) están expandidas mostrando el detalle por caja — a
  // pedido del usuario, para ver primero un resumen por factura y recién
  // abrir la que necesite revisar en detalle.
  const [facturasAbiertas, setFacturasAbiertas] = useState<Set<string>>(new Set());

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await api.camara.cajas({ desde, hasta });
      setCajas(resultado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grupos = useMemo(() => agruparPorFactura(cajas), [cajas]);

  function alternarFactura(clave: string) {
    setFacturasAbiertas((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  }

  function puedeAnular(caja: CajaCamara): boolean {
    return caja.estado === "en_camara" && Math.abs(caja.saldoKg - caja.pesoInicialKg) < 0.0005;
  }

  async function confirmarAnulacion(usuarioAutorizaId: number, clave: string, motivo?: string) {
    if (anulandoId == null) return;
    setError(null);
    await api.camara.anularEntrada(anulandoId, usuarioAutorizaId, clave, motivo ?? "");
    mostrarToast("Entrada anulada", `Caja ${String(anulandoId).padStart(6, "0")}.`, "eliminado");
    setAnulandoId(null);
    await buscar();
  }

  // Reimprimir la etiqueta de una caja directamente desde esta pantalla —
  // antes solo se podía desde Cámara → Existencias, buscando el lote al que
  // pertenece la caja (varios pasos). Acá ya está la caja en pantalla, así
  // que basta con mostrar su etiqueta oculta (ver ".vale-oculto-hasta-
  // imprimir" en styles.css, mismo patrón que usa el vale de Punto de
  // Venta) y mandar a imprimir. El número original se conserva, no se crea
  // ninguna caja nueva.
  function reimprimir(id: number) {
    setReimprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setReimprimiendoId(null), 500);
    }, 0);
  }

  return (
    <div>
      {/* Todo lo que no sea la etiqueta oculta va acá adentro — sin esto, al
          reimprimir una caja el navegador imprimía la pantalla completa (esta
          tabla con todas las cajas del rango, no solo la etiqueta pedida). */}
      <div className="no-imprimir">
        <div className="encabezado-pantalla">
          <h1>Revisar entradas</h1>
          <Link to="/camara">Volver a Cámara</Link>
        </div>
        <p className="ayuda">
          Agrupado por factura (proveedor + N°) para confirmar de un vistazo que una factura se registró completa —
          haz clic en una para ver el detalle por caja. "Anular" solo está disponible para una caja que sigue tal
          cual se creó (sin ninguna salida registrada todavía). Para corregir una línea (producto, peso o costo
          equivocado), ve a <Link to="/camara/existencias">Existencias de cámara</Link> — pide autorización de
          supervisor.
        </p>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

        <form onSubmit={buscar} className="fila-inline">
          <label>
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
        </form>

        {!cargando && grupos.length === 0 && <p className="ayuda">Sin cajas en este rango.</p>}

        {grupos.map((g) => {
          const abierta = facturasAbiertas.has(g.clave);
          return (
            <div key={g.clave} className="tarjeta" style={{ marginBottom: "0.75rem" }}>
              <button
                type="button"
                onClick={() => alternarFactura(g.clave)}
                className="fila-inline"
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <strong>
                  {abierta ? "▼" : "▶"} {g.proveedor} — {g.numeroFactura}
                </strong>
                <span className="ayuda">
                  {new Date(g.fecha).toLocaleDateString("es-CL")} · {g.cantidadLineas} línea
                  {g.cantidadLineas === 1 ? "" : "s"} · {g.cajas.length} caja{g.cajas.length === 1 ? "" : "s"} ·{" "}
                  {formatoCLP(g.total)}
                </span>
              </button>

              {abierta && (
                <table className="tabla" style={{ marginTop: "0.75rem" }}>
                  <thead>
                    <tr>
                      <th>Caja</th>
                      <th>Producto</th>
                      <th>Familia</th>
                      <th>Procedencia</th>
                      <th>Ingreso</th>
                      <th>Salida</th>
                      <th>Peso inicial (kg)</th>
                      <th>Saldo (kg)</th>
                      <th>Costo/kg</th>
                      <th>Estado</th>
                      <th>Creó</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.cajas.map((c) => (
                      <tr key={c.id}>
                        <td>{String(c.id).padStart(6, "0")}</td>
                        <td>{c.producto.descripcion}</td>
                        <td>{c.familiaNombre}</td>
                        <td>{c.procedencia ?? "—"}</td>
                        <td>{new Date(c.fechaIngreso).toLocaleString("es-CL")}</td>
                        <td>{c.fechaSalida ? new Date(c.fechaSalida).toLocaleString("es-CL") : "—"}</td>
                        <td>{c.pesoInicialKg.toFixed(3)}</td>
                        <td>{c.saldoKg.toFixed(3)}</td>
                        <td>{formatoCLP(c.costoNetoKg)}</td>
                        <td>{ETIQUETAS_ESTADO[c.estado] ?? c.estado}</td>
                        <td>{c.creadoPor.nombre}</td>
                        <td className="fila-inline">
                          <button type="button" className="boton" onClick={() => reimprimir(c.id)}>
                            Reimprimir
                          </button>
                          {puedeAnular(c) && (
                            <button type="button" className="boton" onClick={() => setAnulandoId(c.id)}>
                              Anular entrada
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {reimprimiendoId != null && (
        <div className="vale-oculto-hasta-imprimir">
          {(() => {
            const caja = cajas.find((c) => c.id === reimprimiendoId);
            if (!caja) return null;
            return (
              <EtiquetaCamara
                numero={String(caja.id).padStart(6, "0")}
                producto={caja.producto.descripcion}
                familia={caja.familiaNombre}
                procedencia={caja.procedencia}
                fechaIngreso={caja.fechaIngreso}
                pesoInicialKg={caja.pesoInicialKg}
                pesoEstimado={caja.pesoEstimado}
                imprimiendo
              />
            );
          })()}
        </div>
      )}

      {anulandoId != null && (
        <ModalConfirmarClave
          titulo="Anular entrada"
          descripcion="La caja queda fuera de existencias. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={MOTIVOS_ANULAR_CAJA}
          onConfirmar={confirmarAnulacion}
          onCancelar={() => setAnulandoId(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type CajaCamara, type FacturaAgrupada } from "../api";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const MOTIVOS_ANULAR_CAJA = ["Caja de prueba", "Entrada duplicada", "Datos incorrectos"];

const ETIQUETAS_ESTADO: Record<string, string> = {
  en_camara: "En cámara",
  parcial: "Parcial",
  salida: "Salida",
  ajuste_pendiente: "Ajuste pendiente",
  anulada: "Anulada",
};

// Clave para "sin factura asociada" (lotes de cámara sin proveedor/N° —
// ej. entradas de antes de que existiera ese campo). El lado "por unidad"
// nunca cae acá: GET /inventario/facturas ya exige proveedor y N° de
// factura.
const SIN_FACTURA = "sin-factura";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GrupoUnificado {
  clave: string;
  proveedor: string;
  numeroFactura: string;
  fecha: string;
  totalUnidad: number;
  totalKilo: number;
  totalGeneral: number;
  lineasUnidad: FacturaAgrupada["lineas"];
  cajasKilo: CajaCamara[];
}

function claveDe(proveedorId: number | null, numeroFactura: string | null): string {
  const nf = numeroFactura?.trim();
  return proveedorId && nf ? `${proveedorId}|${nf.toLowerCase()}` : SIN_FACTURA;
}

// Junta en un solo listado, por factura (proveedor + N°), lo cargado por
// los dos modos de "Ingreso de mercadería" — a pedido del usuario: antes
// "Facturas cargadas" (por unidad) y "Revisar entradas" (por kilo, cámara)
// eran dos pantallas separadas que ya no reflejaban que el ingreso se
// unificó en una sola — el total que mostraba cada una por separado nunca
// coincidía con el total real de compras (ver Reportes → Compras), que sí
// suma los dos modos. Una factura que trajo de los dos tipos (carne +
// congelados) ahora aparece como UN solo grupo con ambas partes adentro.
function unificar(facturas: FacturaAgrupada[], cajas: CajaCamara[]): GrupoUnificado[] {
  const grupos = new Map<string, GrupoUnificado>();

  function obtener(clave: string, proveedor: string, numeroFactura: string, fecha: string): GrupoUnificado {
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave,
        proveedor,
        numeroFactura,
        fecha,
        totalUnidad: 0,
        totalKilo: 0,
        totalGeneral: 0,
        lineasUnidad: [],
        cajasKilo: [],
      };
      grupos.set(clave, g);
    }
    if (fecha < g.fecha) g.fecha = fecha;
    return g;
  }

  for (const f of facturas) {
    const g = obtener(claveDe(f.proveedorId, f.numeroFactura), f.proveedor, f.numeroFactura, f.fecha);
    g.lineasUnidad.push(...f.lineas);
    g.totalUnidad += f.totalNeto;
  }

  for (const c of cajas) {
    const proveedorId = c.lote?.proveedorId ?? null;
    const numeroFactura = c.lote?.numeroFactura?.trim() ?? "";
    const g = obtener(
      claveDe(proveedorId, numeroFactura),
      c.lote?.proveedor?.nombre ?? "Sin proveedor",
      numeroFactura || "Sin N° de factura",
      c.fechaIngreso
    );
    g.cajasKilo.push(c);
    g.totalKilo += Math.round(c.pesoInicialKg * c.costoNetoKg);
  }

  for (const g of grupos.values()) g.totalGeneral = g.totalUnidad + g.totalKilo;

  return Array.from(grupos.values()).sort((a, b) => {
    if (a.clave === SIN_FACTURA) return 1;
    if (b.clave === SIN_FACTURA) return -1;
    return b.fecha.localeCompare(a.fecha);
  });
}

// Pantalla única para revisar lo cargado por "Ingreso de mercadería",
// reemplazando "Facturas cargadas" (solo por unidad) y "Revisar entradas"
// de Cámara (solo por kilo) — ver comentario de unificar() arriba. Las
// acciones de cámara (anular, reimprimir etiqueta) se conservan tal cual
// estaban; las líneas por unidad siguen siendo de solo lectura, como
// antes.
export default function RevisarIngresos() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [facturas, setFacturas] = useState<FacturaAgrupada[]>([]);
  const [cajas, setCajas] = useState<CajaCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [gruposAbiertos, setGruposAbiertos] = useState<Set<string>>(new Set());
  const [anulandoId, setAnulandoId] = useState<number | null>(null);
  const [reimprimiendoId, setReimprimiendoId] = useState<number | null>(null);

  async function cargar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const [facturasRes, cajasRes] = await Promise.all([
        api.inventario.facturas({ desde, hasta }),
        api.camara.cajas({ desde, hasta }),
      ]);
      setFacturas(facturasRes);
      setCajas(cajasRes);
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

  const grupos = useMemo(() => unificar(facturas, cajas), [facturas, cajas]);
  const totalGeneral = grupos.reduce((s, g) => s + g.totalGeneral, 0);

  function alternarGrupo(clave: string) {
    setGruposAbiertos((actual) => {
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
    await cargar();
  }

  function reimprimir(id: number) {
    setReimprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setReimprimiendoId(null), 500);
    }, 0);
  }

  function exportarCsv() {
    const filas = [["Fecha", "Proveedor", "N° Factura", "Tipo", "PLU", "Producto", "Cantidad / Peso", "Costo", "Subtotal"]];
    for (const g of grupos) {
      for (const l of g.lineasUnidad) {
        filas.push([
          new Date(g.fecha).toLocaleDateString("es-CL"),
          g.proveedor,
          g.numeroFactura,
          "Unidad",
          l.plu,
          l.producto,
          String(l.cantidad),
          l.costoUnitario != null ? String(l.costoUnitario) : "",
          String(l.subtotal),
        ]);
      }
      for (const c of g.cajasKilo) {
        filas.push([
          new Date(c.fechaIngreso).toLocaleDateString("es-CL"),
          g.proveedor,
          g.numeroFactura,
          "Kilo",
          c.producto.plu,
          c.producto.descripcion,
          `${c.pesoInicialKg.toFixed(3)} kg`,
          String(c.costoNetoKg),
          String(Math.round(c.pesoInicialKg * c.costoNetoKg)),
        ]);
      }
    }
    const csv = filas.map((fila) => fila.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ingresos_mercaderia_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Todo lo que no sea la etiqueta oculta va acá adentro — sin esto, al
          reimprimir una caja el navegador imprimía la pantalla completa. */}
      <div className="no-imprimir">
        <div className="encabezado-pantalla">
          <h1>Revisar entradas</h1>
          <div className="fila-inline" style={{ marginBottom: 0 }}>
            <Link to="/mercaderia/ingreso" className="boton boton-primario">
              + Ingreso de mercadería
            </Link>
            <button type="button" className="boton" onClick={exportarCsv} disabled={grupos.length === 0}>
              Exportar a Excel (CSV)
            </button>
            <button type="button" className="boton" onClick={() => window.print()} disabled={grupos.length === 0}>
              Imprimir
            </button>
            <Link to="/inventario" className="boton">
              Volver a inventario
            </Link>
          </div>
        </div>
        <p className="ayuda">
          Todo lo cargado por <Link to="/mercaderia/ingreso">Ingreso de mercadería</Link>, en los dos modos — "Por
          unidad/congelados" y "Por kilo" (carne fresca) — agrupado por factura (proveedor + N°) para confirmar de un
          vistazo que se registró completa. "Anular" solo está disponible para una caja de cámara que sigue tal cual
          se creó (sin ninguna salida registrada todavía). Para corregir una línea de cámara (producto, peso o costo
          equivocado), ve a <Link to="/camara/existencias">Existencias de cámara</Link> — pide autorización de
          supervisor. Las líneas por unidad no se pueden corregir desde acá.
        </p>

        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

        <form onSubmit={cargar} className="fila-inline">
          <label>
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
        </form>

        {!cargando && grupos.length === 0 && <p className="ayuda">Sin entradas en este rango de fechas.</p>}
      </div>

      <h1 className="solo-imprimir">
        Revisar entradas — {desde} a {hasta}
      </h1>

      {grupos.map((g) => {
        const abierto = gruposAbiertos.has(g.clave);
        return (
          <div key={g.clave} className="tarjeta" style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              onClick={() => alternarGrupo(g.clave)}
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
                {abierto ? "▼" : "▶"} {g.proveedor} — {g.numeroFactura}
              </strong>
              <span className="ayuda">
                {new Date(g.fecha).toLocaleDateString("es-CL")}
                {g.lineasUnidad.length > 0 && ` · ${g.lineasUnidad.length} línea(s) por unidad`}
                {g.cajasKilo.length > 0 && ` · ${g.cajasKilo.length} caja(s) por kilo`} · {formatoCLP(g.totalGeneral)}
              </span>
            </button>

            {abierto && (
              <>
                {g.lineasUnidad.length > 0 && (
                  <table className="tabla" style={{ marginTop: "0.75rem" }}>
                    <caption className="ayuda" style={{ textAlign: "left" }}>
                      Por unidad / congelados
                    </caption>
                    <thead>
                      <tr>
                        <th>PLU</th>
                        <th>Producto</th>
                        <th>Cantidad</th>
                        <th>Costo unitario</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lineasUnidad.map((l, i) => (
                        <tr key={i}>
                          <td>{l.plu}</td>
                          <td>{l.producto}</td>
                          <td>{l.cantidad}</td>
                          <td>{l.costoUnitario != null ? formatoCLP(l.costoUnitario) : "—"}</td>
                          <td>{formatoCLP(l.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {g.cajasKilo.length > 0 && (
                  <table className="tabla" style={{ marginTop: "0.75rem" }}>
                    <caption className="ayuda" style={{ textAlign: "left" }}>
                      Por kilo (cámara)
                    </caption>
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
                        <th className="no-imprimir"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.cajasKilo.map((c) => (
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
                          <td className="fila-inline no-imprimir">
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
              </>
            )}
          </div>
        );
      })}

      {grupos.length > 0 && (
        <p style={{ fontSize: "1.1rem" }}>
          <strong>Total del período: {formatoCLP(totalGeneral)}</strong>
        </p>
      )}

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

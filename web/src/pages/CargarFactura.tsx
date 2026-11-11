import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, calcularMargen, formatoCLP, type ProductoConUltimoCosto, type Proveedor } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";
import ParMargen from "../components/ParMargen";

// "actual" (default — no tocar nada), "sugerido" (mismo % de recargo que ya
// tenía con el costo anterior, aplicado al costo nuevo) u "otro" (precio
// libre) — a pedido del usuario, para decidir el precio de venta ahí mismo
// al cargar la factura, en vez de tener que ir aparte a "Cambiar precio"
// después de ver que el costo subió.
type PrecioElegido = "actual" | "sugerido" | "otro";

interface LineaForm {
  id: number;
  producto: ProductoConUltimoCosto | null;
  buscarProducto: string;
  resultados: ProductoConUltimoCosto[];
  cantidad: string;
  costoUnitario: string;
  // Precargado con Producto.aplicaIvaCarne al elegir el producto, pero se
  // puede destildar por línea si ese producto puntual no lleva el impuesto
  // (ver ProductoForm.tsx — se marca a mano por producto, no se adivina).
  aplicaIvaCarne: boolean;
  precioElegido: PrecioElegido;
  precioOtro: string;
}

// Impuestos de la factura, para poder comparar el total contra el papel
// real del proveedor — el neto ya se usaba para armar la entrada de
// inventario, esto es solo una calculadora en pantalla, no se guarda en
// ningún lado.
const TASA_IVA = 0.19;
const TASA_IVA_CARNE = 0.05;

// Mismo % de recargo que el producto ya tenía (precio actual vs. el costo
// que tenía ANTES de esta factura — ver ProductoConUltimoCosto.costoEfectivo),
// aplicado al costo nuevo que se está cargando. Si no hay costo anterior
// conocido (producto nunca comprado, sin costo de referencia), no hay
// ningún % de qué partir, así que no se sugiere nada en vez de adivinar uno.
function calcularPrecioSugerido(producto: ProductoConUltimoCosto, costoNuevo: number | null): number | null {
  if (!costoNuevo || costoNuevo <= 0) return null;
  const margenActual = calcularMargen(producto.precio, producto.costoEfectivo);
  if (margenActual == null) return null;
  return Math.max(1, Math.round(costoNuevo * (1 + margenActual / 100) * (1 + TASA_IVA)));
}

// Mismo criterio en pantalla (tabla) y al guardar — evita que los dos
// lugares calculen el precio final cada uno por su lado y puedan quedar
// desincronizados.
function precioFinalDeLinea(l: LineaForm): number | null {
  if (!l.producto) return null;
  if (l.precioElegido === "sugerido") return calcularPrecioSugerido(l.producto, Number(l.costoUnitario) || null);
  if (l.precioElegido === "otro") return Number(l.precioOtro) || null;
  return l.producto.precio;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineaVacia(id: number): LineaForm {
  return {
    id,
    producto: null,
    buscarProducto: "",
    resultados: [],
    cantidad: "",
    costoUnitario: "",
    aplicaIvaCarne: false,
    precioElegido: "actual",
    precioOtro: "",
  };
}

// Borrador en localStorage para no perder lo tipeado si hay que salir a
// atender la caja a mitad de cargar una factura — se guarda en cada cambio y
// se borra recién al registrar la factura con éxito. Solo persiste lo que
// realmente se tipeó (no "resultados"/"buscarProducto", que son del buscador
// de productos, ni "siguienteId", que se recalcula al restaurar).
const CLAVE_BORRADOR = "granCarniceria_borradorFactura_v1";

interface BorradorFactura {
  proveedorSeleccionado: Proveedor | null;
  numeroFactura: string;
  fecha: string;
  lineas: Array<
    Pick<LineaForm, "id" | "producto" | "cantidad" | "costoUnitario" | "aplicaIvaCarne" | "precioElegido" | "precioOtro">
  >;
}

function borradorEstaVacio(b: BorradorFactura): boolean {
  return (
    !b.proveedorSeleccionado &&
    !b.numeroFactura.trim() &&
    b.lineas.every((l) => !l.producto && !l.cantidad && !l.costoUnitario)
  );
}

function cargarBorrador(): BorradorFactura | null {
  try {
    const guardado = localStorage.getItem(CLAVE_BORRADOR);
    if (!guardado) return null;
    const borrador = JSON.parse(guardado) as BorradorFactura;
    return borradorEstaVacio(borrador) ? null : borrador;
  } catch {
    return null;
  }
}

function guardarBorrador(b: BorradorFactura) {
  try {
    if (borradorEstaVacio(b)) {
      localStorage.removeItem(CLAVE_BORRADOR);
    } else {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    }
  } catch {
    // Si falla (ej. modo privado sin storage) se pierde el borrador, pero no
    // debe impedir seguir cargando la factura.
  }
}

function borrarBorrador() {
  try {
    localStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    // ver guardarBorrador
  }
}

// Formulario manual para cargar una factura completa de una sola vez — a
// pedido del usuario, como alternativa al asistente de IA cuando este no
// identifica bien los productos de una factura pegada como texto. Mismo
// resultado final: una entrada de inventario (motivo "compra") por línea,
// todas con el mismo proveedor y N° de factura, en una sola transacción.
export default function CargarFactura() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const borrador = useMemo(() => cargarBorrador(), []);
  const lineasIniciales = borrador
    ? borrador.lineas.map((l) => ({
        ...l,
        buscarProducto: "",
        resultados: [] as ProductoConUltimoCosto[],
        // Un borrador guardado antes de que existiera esta elección de
        // precio no trae estos dos campos — se completan con el valor por
        // defecto en vez de quedar undefined.
        precioElegido: l.precioElegido ?? "actual",
        precioOtro: l.precioOtro ?? "",
      }))
    : [lineaVacia(1)];

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscarProveedor, setBuscarProveedor] = useState("");
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(
    borrador?.proveedorSeleccionado ?? null
  );

  const [numeroFactura, setNumeroFactura] = useState(borrador?.numeroFactura ?? "");
  const [fecha, setFecha] = useState(borrador?.fecha ?? hoy());
  const [lineas, setLineas] = useState<LineaForm[]>(lineasIniciales);
  const [siguienteId, setSiguienteId] = useState(1 + Math.max(0, ...lineasIniciales.map((l) => l.id)));
  const [borradorRestaurado] = useState(borrador != null);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    guardarBorrador({
      proveedorSeleccionado,
      numeroFactura,
      fecha,
      lineas: lineas.map((l) => ({
        id: l.id,
        producto: l.producto,
        cantidad: l.cantidad,
        costoUnitario: l.costoUnitario,
        aplicaIvaCarne: l.aplicaIvaCarne,
        precioElegido: l.precioElegido,
        precioOtro: l.precioOtro,
      })),
    });
  }, [proveedorSeleccionado, numeroFactura, fecha, lineas]);

  function descartarBorrador() {
    borrarBorrador();
    setProveedorSeleccionado(null);
    setNumeroFactura("");
    setFecha(hoy());
    setLineas([lineaVacia(1)]);
    setSiguienteId(2);
  }

  const proveedoresFiltrados = buscarProveedor.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(buscarProveedor.trim().toLowerCase()))
    : proveedores;

  function actualizarLinea(id: number, cambios: Partial<LineaForm>) {
    setLineas((actual) => actual.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }

  function buscarProductoLinea(id: number, texto: string) {
    actualizarLinea(id, { buscarProducto: texto, producto: null });
    if (!texto.trim()) {
      actualizarLinea(id, { resultados: [] });
      return;
    }
    api.productos
      .listarConCosto({ buscar: texto })
      .then((resultados) => actualizarLinea(id, { resultados }))
      .catch((e) => setError(e.message));
  }

  function agregarLinea() {
    setLineas((actual) => [...actual, lineaVacia(siguienteId)]);
    setSiguienteId((n) => n + 1);
  }

  function quitarLinea(id: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.id !== id) : actual));
  }

  function subtotalLinea(l: LineaForm): number {
    return (Number(l.cantidad) || 0) * (Number(l.costoUnitario) || 0);
  }

  const totalNeto = lineas.reduce((s, l) => s + subtotalLinea(l), 0);
  const subtotalCarne = lineas.filter((l) => l.aplicaIvaCarne).reduce((s, l) => s + subtotalLinea(l), 0);
  const iva = Math.round(totalNeto * TASA_IVA);
  const ivaCarne = Math.round(subtotalCarne * TASA_IVA_CARNE);
  const totalFacturaConImpuestos = totalNeto + iva + ivaCarne;
  // Se mantiene por compatibilidad con el resto del archivo (toast al
  // guardar) — es el mismo total neto de siempre, sin impuestos.
  const totalFactura = totalNeto;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario || !proveedorSeleccionado) {
      setError("Falta elegir el proveedor");
      return;
    }
    if (!numeroFactura.trim()) {
      setError("Falta el N° de factura");
      return;
    }
    const lineasValidas = lineas.filter((l) => l.producto);
    if (lineasValidas.length === 0) {
      setError("Agrega al menos una línea con un producto elegido");
      return;
    }
    for (const l of lineasValidas) {
      if (!Number(l.cantidad) || Number(l.cantidad) <= 0) {
        setError(`Falta la cantidad de "${l.producto!.descripcion}"`);
        return;
      }
      if (!Number(l.costoUnitario) || Number(l.costoUnitario) <= 0) {
        setError(`Falta el costo unitario de "${l.producto!.descripcion}"`);
        return;
      }
      if (l.precioElegido === "otro" && (!Number(l.precioOtro) || Number(l.precioOtro) <= 0)) {
        setError(`Falta el precio nuevo de "${l.producto!.descripcion}"`);
        return;
      }
    }

    setGuardando(true);
    try {
      await api.inventario.entradaFactura({
        proveedorId: proveedorSeleccionado.id,
        numeroFactura: numeroFactura.trim(),
        fecha,
        usuarioId: usuario.id,
        lineas: lineasValidas.map((l) => ({
          productoId: l.producto!.id,
          cantidad: Number(l.cantidad),
          costoUnitario: Number(l.costoUnitario),
        })),
      });

      // La factura ya quedó registrada — los cambios de precio van aparte
      // (mismo endpoint que "Cambiar precio", así quedan en el historial de
      // precios) y no deben hacer parecer que la factura falló si alguno de
      // ellos no se pudo aplicar.
      const cambiosPrecio = lineasValidas.filter((l) => {
        if (l.precioElegido === "actual") return false;
        const nuevo = precioFinalDeLinea(l);
        return nuevo != null && nuevo !== l.producto!.precio;
      });
      const fallidos: string[] = [];
      for (const l of cambiosPrecio) {
        try {
          await api.precios.cambiarIndividual({
            productoId: l.producto!.id,
            precioNuevo: precioFinalDeLinea(l)!,
            usuarioId: usuario.id,
          });
        } catch (e) {
          fallidos.push(`${l.producto!.descripcion} (${(e as Error).message})`);
        }
      }

      mostrarToast(
        "Factura cargada",
        `${lineasValidas.length} línea(s) de ${proveedorSeleccionado.nombre} — ${formatoCLP(totalFactura)}.` +
          (cambiosPrecio.length > 0 ? ` ${cambiosPrecio.length - fallidos.length} precio(s) actualizados.` : "")
      );
      // window.alert en vez de setError: la factura YA quedó guardada (no
      // tiene sentido impedir seguir), pero navigate() desmonta esta
      // pantalla de inmediato y con ella cualquier error en pantalla — así
      // se alcanza a ver antes de salir, en vez de perderse en silencio.
      if (fallidos.length > 0) {
        window.alert(`La factura se cargó bien, pero no se pudo actualizar el precio de: ${fallidos.join("; ")}`);
      }
      borrarBorrador();
      navigate("/inventario/facturas");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Cargar factura</h1>
      <p className="ayuda">
        Registra todas las líneas de una factura de compra de una vez, con el mismo proveedor y N° de factura —
        alternativa al asistente de IA para cuando no identifica bien los productos.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {borradorRestaurado && (
        <p className="exito">
          Se restauró el borrador que habías dejado sin terminar.{" "}
          <button type="button" onClick={descartarBorrador}>
            Descartar y empezar de nuevo
          </button>
        </p>
      )}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Proveedor
          <div className="buscador-producto">
            <input
              type="text"
              placeholder="Buscar proveedor... (vacío = ver todos)"
              value={buscarProveedor}
              onChange={(e) => {
                setBuscarProveedor(e.target.value);
                setProveedorSeleccionado(null);
              }}
            />
            {!proveedorSeleccionado && (
              <div className="resultados-busqueda">
                {proveedoresFiltrados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {proveedoresFiltrados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProveedorSeleccionado(p);
                      setBuscarProveedor("");
                    }}
                  >
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          {proveedorSeleccionado && (
            <p className="exito">
              Proveedor elegido: {proveedorSeleccionado.nombre}{" "}
              <button type="button" onClick={() => setProveedorSeleccionado(null)}>
                Cambiar
              </button>
            </p>
          )}
        </label>
        <label>
          N° de factura
          <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} required />
        </label>
        <label>
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </label>

        <div className="acciones-formulario">
          <h2>Líneas de la factura</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Costo unitario</th>
                <th>Subtotal</th>
                <th>IVA carne (5%)</th>
                <th>Precio de venta</th>
                <th>Margen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                // El costo usado para el margen es el que se está escribiendo
                // AHORA en esta línea (no hace falta ninguna compra previa
                // registrada) — es lo que realmente importa al decidir si el
                // precio de venta sigue teniendo sentido con este costo nuevo.
                const costoTipeado = Number(l.costoUnitario) || null;
                const precioSugerido = l.producto ? calcularPrecioSugerido(l.producto, costoTipeado) : null;
                const precioFinal = precioFinalDeLinea(l);
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="buscador-producto">
                        <input
                          type="text"
                          placeholder="Buscar por PLU o nombre..."
                          value={l.producto ? l.producto.descripcion : l.buscarProducto}
                          onChange={(e) => buscarProductoLinea(l.id, e.target.value)}
                        />
                        {!l.producto && l.buscarProducto.trim() && (
                          <div className="resultados-busqueda">
                            {l.resultados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                            {l.resultados.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className="resultado-item"
                                onClick={() =>
                                  actualizarLinea(l.id, {
                                    producto: p,
                                    buscarProducto: "",
                                    resultados: [],
                                    aplicaIvaCarne: p.aplicaIvaCarne,
                                    precioElegido: "actual",
                                    precioOtro: "",
                                  })
                                }
                              >
                                {p.plu} — {p.descripcion}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="input-chico"
                        value={l.cantidad}
                        onChange={(e) => actualizarLinea(l.id, { cantidad: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        className="input-chico"
                        value={l.costoUnitario}
                        onChange={(e) => actualizarLinea(l.id, { costoUnitario: e.target.value })}
                      />
                    </td>
                    <td>{formatoCLP(subtotalLinea(l))}</td>
                    <td>
                      {l.producto && (
                        <input
                          type="checkbox"
                          checked={l.aplicaIvaCarne}
                          onChange={(e) => actualizarLinea(l.id, { aplicaIvaCarne: e.target.checked })}
                          title="Aplicar el IVA adicional a la carne (5%) a esta línea"
                        />
                      )}
                    </td>
                    <td>
                      {l.producto && (
                        <>
                          <select
                            value={l.precioElegido}
                            onChange={(e) => actualizarLinea(l.id, { precioElegido: e.target.value as PrecioElegido })}
                          >
                            <option value="actual">Mantener {formatoCLP(l.producto.precio)}</option>
                            {precioSugerido != null && (
                              <option value="sugerido">Sugerido {formatoCLP(precioSugerido)} (mismo % recargo)</option>
                            )}
                            <option value="otro">Otro precio...</option>
                          </select>
                          {l.precioElegido === "otro" && (
                            <input
                              type="number"
                              min="1"
                              className="input-chico"
                              placeholder="Nuevo precio"
                              value={l.precioOtro}
                              onChange={(e) => actualizarLinea(l.id, { precioOtro: e.target.value })}
                            />
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {l.producto ? (
                        <ParMargen precio={precioFinal ?? l.producto.precio} costo={costoTipeado} />
                      ) : (
                        <span className="ayuda">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="boton-quitar-item" title="Quitar línea" onClick={() => quitarLinea(l.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="boton" onClick={agregarLinea}>
            + Agregar línea
          </button>
        </div>

        <div className="tarjeta" style={{ maxWidth: "320px" }}>
          <p>Total neto: {formatoCLP(totalNeto)}</p>
          <p>IVA (19%): {formatoCLP(iva)}</p>
          <p>
            IVA carne (5%): {formatoCLP(ivaCarne)}
            {subtotalCarne === 0 && <span className="ayuda"> (ninguna línea marcada)</span>}
          </p>
          <p>
            <strong>TOTAL factura: {formatoCLP(totalFacturaConImpuestos)}</strong>
          </p>
          <p className="ayuda">Compara este total contra el de la factura en papel para verificar que calcen.</p>
        </div>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar factura"}
          </button>
          <button type="button" onClick={() => navigate("/inventario")}>
            Volver a inventario
          </button>
        </div>
      </form>
    </div>
  );
}

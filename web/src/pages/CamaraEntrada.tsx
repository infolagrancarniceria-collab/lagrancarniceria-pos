import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  calcularMargen,
  formatoCLP,
  FAMILIAS_CAMARA,
  PROCEDENCIAS_VACUNO,
  type CajaCamara,
  type FamiliaCamara,
  type ProcedenciaCamara,
  type Producto,
  type ProductoConCosto,
  type Proveedor,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara, imprimirEtiquetasLoteCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

interface LineaForm {
  id: number;
  familia: FamiliaCamara;
  procedencia: ProcedenciaCamara | "";
  producto: Producto | null;
  buscarProducto: string;
  resultados: Producto[];
  info: ProductoConCosto | null;
  precioNuevo: string;
  precioMayorNuevo: string;
  cantidadCajas: string;
  modoPeso: "total" | "individual";
  pesoValor: string;
  costoNetoKg: string;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineaVacia(id: number): LineaForm {
  return {
    id,
    familia: "Vacuno",
    procedencia: "",
    producto: null,
    buscarProducto: "",
    resultados: [],
    info: null,
    precioNuevo: "",
    precioMayorNuevo: "",
    cantidadCajas: "1",
    modoPeso: "individual",
    pesoValor: "",
    costoNetoKg: "",
  };
}

// Entrada de cámara directo desde la factura completa — a pedido del papá
// del usuario, para no repetir proveedor/fecha/N° de factura por cada
// producto: se cargan de una vez varias líneas (una por producto) bajo la
// misma factura, y cada línea sigue generando sus cajas reales con
// etiqueta, igual que antes. Reemplaza la pantalla de un solo producto —
// el endpoint de una sola línea (POST /api/camara/cajas) se mantiene por
// su cuenta para el asistente de IA.
export default function CamaraEntrada() {
  const { usuario } = useUsuario();

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscarProveedor, setBuscarProveedor] = useState("");
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(hoy());

  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia(1)]);
  const [siguienteId, setSiguienteId] = useState(2);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cajasCreadas, setCajasCreadas] = useState<CajaCamara[] | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<number | null>(null);
  const [imprimiendoLote, setImprimiendoLote] = useState(false);

  // Aviso de posible factura duplicada (mismo proveedor + N° de factura ya
  // cargado antes) — se revisa al elegir el proveedor y al salir del campo
  // N° de factura, para que la alerta aparezca antes de completar todas las
  // líneas, no recién al intentar guardar.
  const [avisoDuplicado, setAvisoDuplicado] = useState<{
    lotes: { id: number; producto: string; cantidadCajas: number; pesoTotalKg: number; fechaIngreso: string }[];
  } | null>(null);
  const [duplicadoConfirmado, setDuplicadoConfirmado] = useState(false);

  useEffect(() => {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }, []);

  function verificarDuplicado(proveedorId: number, numeroFacturaTexto: string) {
    if (!proveedorId || !numeroFacturaTexto.trim()) return;
    api.camara
      .verificarDuplicadoFactura(proveedorId, numeroFacturaTexto.trim())
      .then((resultado) => {
        setAvisoDuplicado(resultado.duplicado ? { lotes: resultado.lotes } : null);
        setDuplicadoConfirmado(false);
      })
      .catch(() => {
        // Un fallo acá no debe bloquear cargar la factura — el guardado
        // igual vuelve a revisar por su cuenta como respaldo.
      });
  }

  const proveedoresFiltrados = buscarProveedor.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(buscarProveedor.trim().toLowerCase()))
    : proveedores;

  function actualizarLinea(id: number, cambios: Partial<LineaForm>) {
    setLineas((actual) => actual.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }

  function buscarProductoLinea(id: number, texto: string) {
    actualizarLinea(id, { buscarProducto: texto, producto: null, info: null });
    if (!texto.trim()) {
      actualizarLinea(id, { resultados: [] });
      return;
    }
    api.productos
      .listar({ buscar: texto })
      .then((resultados) => actualizarLinea(id, { resultados }))
      .catch((e) => setError(e.message));
  }

  function elegirProducto(id: number, producto: Producto) {
    actualizarLinea(id, { producto, buscarProducto: "", resultados: [] });
    api.productos
      .obtener(producto.id)
      .then((info) => actualizarLinea(id, { info }))
      .catch((e) => setError(e.message));
  }

  async function cambiarPrecios(linea: LineaForm) {
    if (!linea.info) return;
    const nuevoVenta = linea.precioNuevo ? Number(linea.precioNuevo) : null;
    const nuevoMayor = linea.precioMayorNuevo ? Number(linea.precioMayorNuevo) : null;
    if (!nuevoVenta && !nuevoMayor) return;
    try {
      let info = linea.info;
      if (nuevoVenta) {
        const actualizado = await api.precios.cambiarIndividual({
          productoId: info.id,
          precioNuevo: nuevoVenta,
          usuarioId: usuario!.id,
        });
        info = { ...info, precio: actualizado.precio };
      }
      if (nuevoMayor) {
        const actualizado = await api.productos.cambiarPrecioMayor(info.id, nuevoMayor);
        info = { ...info, precioMayor: actualizado.precioMayor };
      }
      actualizarLinea(linea.id, { info, precioNuevo: "", precioMayorNuevo: "" });
      mostrarToast("Precio actualizado", info.descripcion);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function agregarLinea() {
    setLineas((actual) => [...actual, lineaVacia(siguienteId)]);
    setSiguienteId((n) => n + 1);
  }

  function quitarLinea(id: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.id !== id) : actual));
  }

  function subtotalLinea(l: LineaForm): number {
    const cajas = Number(l.cantidadCajas) || 0;
    const peso = Number(l.pesoValor) || 0;
    const costo = Number(l.costoNetoKg) || 0;
    const kilos = l.modoPeso === "total" ? peso : peso * cajas;
    return Math.round(kilos * costo);
  }

  const totalFactura = lineas.reduce((s, l) => s + subtotalLinea(l), 0);

  function nuevaFactura() {
    setCajasCreadas(null);
    setProveedorSeleccionado(null);
    setBuscarProveedor("");
    setNumeroFactura("");
    setFecha(hoy());
    setLineas([lineaVacia(1)]);
    setSiguienteId(2);
    setAvisoDuplicado(null);
    setDuplicadoConfirmado(false);
  }

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
    if (avisoDuplicado && !duplicadoConfirmado) {
      setError("Esta factura ya se cargó antes — revisa el aviso arriba y confirma si quieres seguir igual.");
      return;
    }
    for (const l of lineas) {
      if (!l.producto) {
        setError("Falta elegir el producto de alguna línea");
        return;
      }
      if (l.familia === "Vacuno" && !l.procedencia) {
        setError(`Falta la procedencia de "${l.producto.descripcion}"`);
        return;
      }
      const cajas = Number(l.cantidadCajas);
      if (!cajas || cajas <= 0 || !Number.isInteger(cajas)) {
        setError(`Cantidad de cajas inválida en "${l.producto.descripcion}"`);
        return;
      }
      if (!Number(l.pesoValor) || Number(l.pesoValor) <= 0) {
        setError(`Falta el peso de "${l.producto.descripcion}"`);
        return;
      }
      if (!Number(l.costoNetoKg) || Number(l.costoNetoKg) <= 0) {
        setError(`Falta el costo neto por kilo de "${l.producto.descripcion}"`);
        return;
      }
    }

    const confirmado = window.confirm(
      `¿Registrar esta factura? ${lineas.length} línea(s), total neto ${formatoCLP(totalFactura)}.`
    );
    if (!confirmado) return;

    setGuardando(true);
    try {
      const resultado = await api.camara.entradaFactura({
        proveedorId: proveedorSeleccionado.id,
        numeroFactura: numeroFactura.trim(),
        fecha,
        usuarioId: usuario.id,
        lineas: lineas.map((l) => ({
          productoId: l.producto!.id,
          familia: l.familia,
          ...(l.familia === "Vacuno" ? { procedencia: l.procedencia as ProcedenciaCamara } : {}),
          cantidadCajas: Number(l.cantidadCajas),
          ...(l.modoPeso === "total" ? { pesoTotalKg: Number(l.pesoValor) } : { pesoIndividualKg: Number(l.pesoValor) }),
          costoNetoKg: Number(l.costoNetoKg),
        })),
        confirmarDuplicado: duplicadoConfirmado,
      });
      setCajasCreadas(resultado.cajas);
      mostrarToast(
        "Factura ingresada a cámara",
        `${lineas.length} línea(s) de ${proveedorSeleccionado.nombre} — ${formatoCLP(totalFactura)}.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function imprimirEtiqueta(id: number) {
    setImprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setImprimiendoId(null), 500);
    }, 0);
  }

  function imprimirTodasLasEtiquetas() {
    if (!cajasCreadas || cajasCreadas.length < 2) return;
    const primera = String(cajasCreadas[0].id).padStart(6, "0");
    const ultima = String(cajasCreadas[cajasCreadas.length - 1].id).padStart(6, "0");
    const confirmado = window.confirm(
      `Se imprimirán ${cajasCreadas.length} etiquetas, desde la caja ${primera} hasta la ${ultima}.\n\nAntes de continuar verifica que "Copias" esté en 1.`
    );
    if (!confirmado) return;
    setImprimiendoLote(true);
    setTimeout(() => {
      imprimirEtiquetasLoteCamara();
      setTimeout(() => setImprimiendoLote(false), 500);
    }, 0);
  }

  if (cajasCreadas) {
    return (
      <div>
        <div className="no-imprimir">
          <div className="encabezado-pantalla">
            <h1>Factura ingresada — {cajasCreadas.length} caja(s) registrada(s)</h1>
            <Link to="/camara" className="boton">
              Volver a Cámara
            </Link>
          </div>
          <p className="exito">
            Listo — imprime cada etiqueta con el botón correspondiente, o todas de una vez.
          </p>
          <div className="fila-inline">
            <button type="button" className="boton boton-primario" onClick={nuevaFactura}>
              Registrar otra factura
            </button>
            {cajasCreadas.length > 1 && (
              <button type="button" className="boton boton-peligro" onClick={imprimirTodasLasEtiquetas}>
                ⚡ Imprimir todas las etiquetas ({cajasCreadas.length})
              </button>
            )}
          </div>
        </div>

        <div className={`etiquetas-camara${imprimiendoLote ? " imprimiendo-lote" : ""}`}>
          {cajasCreadas.map((caja) => (
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
              <button type="button" className="boton no-imprimir" onClick={() => imprimirEtiqueta(caja.id)}>
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
        <h1>Entrada de cámara — factura</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

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
                      verificarDuplicado(p.id, numeroFactura);
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
          Fecha de ingreso
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </label>
        <label>
          N° de factura
          <input
            value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
            onBlur={(e) => proveedorSeleccionado && verificarDuplicado(proveedorSeleccionado.id, e.target.value)}
            required
          />
        </label>

        {avisoDuplicado && (
          <div className="tarjeta tarjeta-mini aviso-advertencia">
            <p>
              ⚠ <strong>Esta factura ya se cargó antes</strong> — mismo proveedor y N° de factura, en{" "}
              {avisoDuplicado.lotes.length === 1 ? "este lote" : "estos lotes"}:
            </p>
            <ul>
              {avisoDuplicado.lotes.map((l) => (
                <li key={l.id}>
                  {l.producto} — {l.cantidadCajas} caja(s), {l.pesoTotalKg.toFixed(2)} kg — ingresado el{" "}
                  {new Date(l.fechaIngreso).toLocaleDateString("es-CL")}
                </li>
              ))}
            </ul>
            {duplicadoConfirmado ? (
              <p className="exito">Confirmado — se va a ingresar igual, como una factura nueva y distinta.</p>
            ) : (
              <div className="fila-inline">
                <button type="button" className="boton boton-peligro" onClick={() => setDuplicadoConfirmado(true)}>
                  Sí, es una factura distinta — continuar de todas formas
                </button>
              </div>
            )}
          </div>
        )}

        <div className="acciones-formulario">
          <h2>Líneas de la factura</h2>
          {lineas.map((l, i) => (
            <div key={l.id} className="tarjeta tarjeta-mini">
              <div className="fila-inline" style={{ justifyContent: "space-between" }}>
                <strong>Línea {i + 1}</strong>
                {lineas.length > 1 && (
                  <button type="button" className="boton-quitar-item" onClick={() => quitarLinea(l.id)}>
                    ✕
                  </button>
                )}
              </div>

              <label>
                Familia
                <select
                  value={l.familia}
                  onChange={(e) => {
                    const nueva = e.target.value as FamiliaCamara;
                    actualizarLinea(l.id, { familia: nueva, procedencia: nueva !== "Vacuno" ? "" : l.procedencia });
                  }}
                >
                  {FAMILIAS_CAMARA.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>

              {l.familia === "Vacuno" && (
                <label>
                  Procedencia
                  <select
                    value={l.procedencia}
                    onChange={(e) => actualizarLinea(l.id, { procedencia: e.target.value as ProcedenciaCamara })}
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
                Producto o corte
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
                          onClick={() => elegirProducto(l.id, p)}
                        >
                          {p.plu} — {p.descripcion} ({p.categoria.nombre})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              {l.info && (
                <div className="tarjeta-mini">
                  <p>
                    <strong>PLU:</strong> {l.info.plu} ·{" "}
                    <strong>Última compra en cámara:</strong>{" "}
                    {l.info.ultimoCostoCamaraKg != null ? `${formatoCLP(l.info.ultimoCostoCamaraKg)}/kg` : "sin datos"}
                  </p>
                  <p>
                    <strong>Precio venta:</strong> {formatoCLP(l.info.precio)} ·{" "}
                    <strong>Precio venta mayor:</strong>{" "}
                    {l.info.precioMayor != null ? formatoCLP(l.info.precioMayor) : "sin definir"}
                  </p>
                  {(() => {
                    // Si ya hubo una compra en cámara, el margen usa ese costo
                    // real; si no, se calcula igual con el costo que se está
                    // escribiendo ahora en "Valor neto por kilo" — no hace
                    // falta ninguna compra previa registrada para verlo.
                    const costoConHistorial = l.info!.ultimoCostoCamaraKg;
                    const costoEscrito = Number(l.costoNetoKg) || null;
                    const costoUsado = costoConHistorial ?? costoEscrito;
                    const margen = calcularMargen(l.info!.precio, costoUsado);
                    if (margen == null) return null;
                    return (
                      <p>
                        <span className={`margen-destacado ${margen < 0 ? "margen-negativo" : ""}`}>
                          <span className="margen-etiqueta">Margen</span> {margen.toFixed(2)}%
                        </span>{" "}
                        <span className="ayuda">
                          {costoConHistorial != null
                            ? `(según la última compra en cámara, ${formatoCLP(costoConHistorial)}/kg)`
                            : `(con el costo recién escrito, ${formatoCLP(costoEscrito!)}/kg — todavía no hay ninguna compra registrada)`}
                        </span>
                      </p>
                    );
                  })()}
                  {/* Estos dos campos son para cambiar el precio de venta y el de
                      venta al por mayor de este producto sin salir de la
                      pantalla — se escribe el valor nuevo en el que corresponda
                      (se pueden dejar los dos, uno solo, o ninguno) y se aplica
                      con el botón "Actualizar precio(s)". */}
                  <div className="fila-inline">
                    <label className="ayuda">
                      Nuevo precio venta
                      <input
                        type="number"
                        min="1"
                        className="input-chico"
                        value={l.precioNuevo}
                        onChange={(e) => actualizarLinea(l.id, { precioNuevo: e.target.value })}
                      />
                    </label>
                    <label className="ayuda">
                      Nuevo precio venta mayor
                      <input
                        type="number"
                        min="1"
                        className="input-chico"
                        value={l.precioMayorNuevo}
                        onChange={(e) => actualizarLinea(l.id, { precioMayorNuevo: e.target.value })}
                      />
                    </label>
                    <button type="button" onClick={() => cambiarPrecios(l)}>
                      Actualizar precio(s)
                    </button>
                  </div>
                </div>
              )}

              <label>
                Cantidad de cajas
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={l.cantidadCajas}
                  onChange={(e) => actualizarLinea(l.id, { cantidadCajas: e.target.value })}
                />
              </label>

              <label>
                ¿Cómo se sabe el peso?
                <select
                  value={l.modoPeso}
                  onChange={(e) => actualizarLinea(l.id, { modoPeso: e.target.value as "total" | "individual" })}
                >
                  <option value="individual">Se pesó cada caja (peso real)</option>
                  <option value="total">Solo se sabe el peso total (se reparte estimado)</option>
                </select>
              </label>
              <label>
                {l.modoPeso === "total" ? "Kilos (total del lote)" : "Kilos por caja"}
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={l.pesoValor}
                  onChange={(e) => actualizarLinea(l.id, { pesoValor: e.target.value })}
                  placeholder={l.modoPeso === "total" ? "ej. 225" : "ej. 22.5"}
                />
              </label>

              <label>
                Valor neto por kilo
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={l.costoNetoKg}
                  onChange={(e) => actualizarLinea(l.id, { costoNetoKg: e.target.value })}
                  placeholder="ej. 6500"
                />
              </label>

              <p>
                <strong>Subtotal línea:</strong> {formatoCLP(subtotalLinea(l))}
              </p>
            </div>
          ))}
          <button type="button" className="boton" onClick={agregarLinea}>
            + Agregar línea
          </button>
        </div>

        <p>
          <strong>Neto total de la factura: {formatoCLP(totalFactura)}</strong>
        </p>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar factura"}
          </button>
        </div>
      </form>
    </div>
  );
}

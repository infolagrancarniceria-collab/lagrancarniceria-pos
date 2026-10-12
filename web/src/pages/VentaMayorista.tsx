import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP, type CajaCamara, type Categoria, type ProductoConUltimoCosto, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import SelectorCategoria from "../components/SelectorCategoria";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { ValeVenta } from "../components/ValeVenta";
import { imprimirSilencioso } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

// Reemplaza la planilla Excel que usaba el dueño para armar pedidos al por
// mayor: se arma la lista de líneas mostrando el precio NETO negociado (sin
// el % de cobro, como la "entrega" que ve el cliente), y recién al cobrar se
// aplica el % de la categoría de cada producto (ver Categoria.
// porcentajeCobroMayorista — 19% pollo, 24% cerdo/vacuno, configurable en
// Categorías) sobre el subtotal neto de cada línea. Queda como una Venta
// real (canal "mayorista", esAuxiliar) para que el stock, Caja, Cuadratura y
// Reportes la traten igual que cualquier otra venta — ver confirmarVenta en
// el servidor para cómo se descuenta el stock según el origen de cada línea.
export default function VentaMayorista() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [venta, setVenta] = useState<Venta | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [procesandoCobro, setProcesandoCobro] = useState<"pendiente" | "efectivo" | "tarjeta" | null>(null);
  const [itemAAnular, setItemAAnular] = useState<number | null>(null);
  const [ventaParaImprimir, setVentaParaImprimir] = useState<Venta | null>(null);
  const [mostrarCobro, setMostrarCobro] = useState(false);

  // --- Formulario de nueva línea ---
  const [origenProducto, setOrigenProducto] = useState<"existente" | "nuevo">("existente");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoConUltimoCosto[]>([]);
  const [productoElegido, setProductoElegido] = useState<ProductoConUltimoCosto | null>(null);
  const [nuevoDescripcion, setNuevoDescripcion] = useState("");
  const [nuevoCategoriaId, setNuevoCategoriaId] = useState<number | "">("");
  const [nuevoFlagBalanza, setNuevoFlagBalanza] = useState<"NORMAL" | "PESABLE">("PESABLE");
  const [cantidad, setCantidad] = useState("");
  const [precioNeto, setPrecioNeto] = useState("");
  const [origenStock, setOrigenStock] = useState<"sala_venta" | "camara">("sala_venta");
  const [cajasDisponibles, setCajasDisponibles] = useState<CajaCamara[]>([]);
  const [cajaCamaraId, setCajaCamaraId] = useState<number | "">("");
  const [guardandoLinea, setGuardandoLinea] = useState(false);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ventaParaImprimir) return;
    imprimirSilencioso().finally(() => setVentaParaImprimir(null));
  }, [ventaParaImprimir]);

  useEffect(() => {
    if (origenProducto !== "existente" || !busqueda.trim()) {
      setResultados([]);
      return;
    }
    const t = setTimeout(() => {
      api.productos.listarConCosto({ buscar: busqueda }).then((r) => setResultados(r.slice(0, 8))).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [origenProducto, busqueda]);

  // Cajas de cámara activas del producto elegido — para que la línea pueda
  // salir de una caja puntual en vez del stock general de sala de venta.
  useEffect(() => {
    if (origenStock !== "camara" || !productoElegido) {
      setCajasDisponibles([]);
      setCajaCamaraId("");
      return;
    }
    Promise.all([api.camara.cajas({ estado: "en_camara" }), api.camara.cajas({ estado: "parcial" })])
      .then(([enCamara, parciales]) =>
        setCajasDisponibles([...enCamara, ...parciales].filter((c) => c.productoId === productoElegido.id))
      )
      .catch((e) => setError(e.message));
  }, [origenStock, productoElegido]);

  async function iniciarVenta() {
    if (!usuario) return;
    setIniciando(true);
    setError(null);
    try {
      const creada = await api.caja.crearVentaMayorista(usuario.id);
      setVenta(creada);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIniciando(false);
    }
  }

  function elegirProductoExistente(p: ProductoConUltimoCosto) {
    setProductoElegido(p);
    setBusqueda("");
    setResultados([]);
    if (p.precioMayor != null) setPrecioNeto(String(p.precioMayor));
  }

  function limpiarFormularioLinea() {
    setBusqueda("");
    setResultados([]);
    setProductoElegido(null);
    setNuevoDescripcion("");
    setNuevoCategoriaId("");
    setNuevoFlagBalanza("PESABLE");
    setCantidad("");
    setPrecioNeto("");
    setOrigenStock("sala_venta");
    setCajaCamaraId("");
  }

  async function agregarLinea(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !venta) return;
    setError(null);

    const cantidadNum = Number(cantidad.replace(",", "."));
    const precioNetoNum = Number(precioNeto.replace(",", "."));
    if (!cantidadNum || cantidadNum <= 0) {
      setError("Ingresa una cantidad válida");
      return;
    }
    if (!precioNetoNum || precioNetoNum <= 0) {
      setError("Ingresa un precio neto válido");
      return;
    }
    if (origenProducto === "existente" && !productoElegido) {
      setError("Elige un producto del catálogo, o cambia a \"Producto nuevo\"");
      return;
    }
    if (origenProducto === "nuevo" && (!nuevoDescripcion.trim() || !nuevoCategoriaId)) {
      setError("Falta la descripción o la categoría del producto nuevo");
      return;
    }
    if (origenStock === "camara" && !cajaCamaraId) {
      setError("Elige de qué caja de cámara sale esta línea");
      return;
    }

    setGuardandoLinea(true);
    try {
      const actualizada = await api.caja.agregarItemMayorista(venta.id, {
        usuarioId: usuario.id,
        productoId: origenProducto === "existente" ? productoElegido!.id : undefined,
        productoNuevo:
          origenProducto === "nuevo"
            ? { descripcion: nuevoDescripcion.trim(), categoriaId: Number(nuevoCategoriaId), flagBalanza: nuevoFlagBalanza }
            : undefined,
        cantidad: cantidadNum,
        precioNetoUnitario: precioNetoNum,
        origen: origenStock,
        cajaCamaraId: origenStock === "camara" ? Number(cajaCamaraId) : undefined,
      });
      setVenta(actualizada);
      mostrarToast("Línea agregada", "Se agregó a la venta mayorista.");
      limpiarFormularioLinea();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoLinea(false);
    }
  }

  async function confirmarAnularItem(usuarioIdAutoriza: number, clave: string, motivo?: string) {
    if (!venta || itemAAnular == null) return;
    const actualizada = await api.caja.anularItem(venta.id, itemAAnular, { clave, usuarioId: usuarioIdAutoriza, motivo });
    setVenta(actualizada);
    setMensaje("Línea quitada");
    setItemAAnular(null);
  }

  async function cobrar(tipo: "pendiente" | "efectivo" | "tarjeta") {
    if (!venta || !usuario) return;
    if (venta.items.filter((i) => !i.anulado).length === 0) {
      setError("Todavía no se ha agregado ningún producto");
      return;
    }
    setProcesandoCobro(tipo);
    setError(null);
    try {
      const conPago = await api.caja.agregarPago(venta.id, {
        medio: tipo === "pendiente" ? "mayorista" : tipo,
        monto: venta.total,
      });
      const confirmada = await api.caja.confirmarVenta(conPago.id, usuario.id);
      setVenta(confirmada);
      setVentaParaImprimir(confirmada);
      mostrarToast(
        "Venta mayorista confirmada",
        tipo === "pendiente" ? "Queda pendiente de pago." : "Confirmada y cobrada."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesandoCobro(null);
    }
  }

  function nuevaVenta() {
    setVenta(null);
    setMostrarCobro(false);
    limpiarFormularioLinea();
  }

  if (!venta) {
    return (
      <div className="punto-de-venta caja-online no-imprimir">
        <div className="caja-online-banda">
          <span className="caja-online-etiqueta">🧮 Venta Mayorista</span>
          <span className="ayuda">— otra caja, aparte del mesón principal</span>
        </div>
        <h1>Venta mayorista</h1>
        <p className="ayuda">
          Arma la lista de productos (cualquiera del catálogo, a precio neto negociado) y recién al cobrar se aplica
          el % de la categoría de cada uno. Queda como una venta real: descuenta stock, entra a Caja/Cuadratura y se
          ve separada en Reportes.
        </p>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        <button type="button" className="boton boton-primario" disabled={iniciando} onClick={iniciarVenta}>
          {iniciando ? "Iniciando..." : "+ Iniciar venta mayorista"}
        </button>
      </div>
    );
  }

  const itemsActivos = venta.items.filter((i) => !i.anulado);
  const totalNeto = itemsActivos.reduce((s, i) => s + (i.precioNetoUnitario ?? i.precioUnitario) * i.cantidad, 0);
  const yaConfirmada = venta.estado !== "abierta";

  return (
    <>
      <div className="punto-de-venta caja-online no-imprimir">
        <div className="caja-online-banda">
          <span className="caja-online-etiqueta">🧮 Venta Mayorista</span>
          <span className="ayuda">— otra caja, aparte del mesón principal</span>
        </div>
        <div className="encabezado-pantalla">
          <h1>Venta mayorista #{venta.id}</h1>
          <button type="button" onClick={() => navigate("/caja")}>
            Volver a Caja
          </button>
        </div>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        {mensaje && <p className="exito">{mensaje}</p>}

        <div className="tarjeta">
          <h2>Pedido (precio neto, sin el % de cobro)</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Origen</th>
                <th>Cantidad</th>
                <th>Precio neto</th>
                <th>Subtotal neto</th>
                {!yaConfirmada && <th></th>}
              </tr>
            </thead>
            <tbody>
              {itemsActivos.map((item) => (
                <tr key={item.id}>
                  <td>{item.producto.descripcion}</td>
                  <td>
                    {item.cajaCamaraId != null ? `Cámara (caja #${item.cajaCamaraId})` : "Sala de venta"}
                  </td>
                  <td>
                    {item.cantidad} {item.producto.flagBalanza === "PESABLE" ? "kg" : "un."}
                  </td>
                  <td>{formatoCLP(item.precioNetoUnitario ?? item.precioUnitario)}</td>
                  <td>{formatoCLP((item.precioNetoUnitario ?? item.precioUnitario) * item.cantidad)}</td>
                  {!yaConfirmada && (
                    <td>
                      <button type="button" className="boton-quitar-item" onClick={() => setItemAAnular(item.id)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {itemsActivos.length === 0 && (
                <tr>
                  <td colSpan={6}>Todavía no se ha agregado ningún producto.</td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Total neto: {formatoCLP(totalNeto)}</h3>
        </div>

        {!yaConfirmada && (
          <div className="tarjeta">
            <h2>Agregar línea</h2>
            <form onSubmit={agregarLinea} className="formulario">
              <div className="fila-inline">
                <label>
                  Producto
                  <select
                    value={origenProducto}
                    onChange={(e) => {
                      setOrigenProducto(e.target.value as "existente" | "nuevo");
                      setProductoElegido(null);
                    }}
                  >
                    <option value="existente">Elegir del catálogo</option>
                    <option value="nuevo">Producto nuevo (no está cargado todavía)</option>
                  </select>
                </label>
              </div>

              {origenProducto === "existente" ? (
                <div className="buscador-producto">
                  <input
                    type="text"
                    placeholder="Buscar por PLU o nombre..."
                    value={productoElegido ? productoElegido.descripcion : busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value);
                      setProductoElegido(null);
                    }}
                  />
                  {!productoElegido && busqueda.trim() && (
                    <div className="resultados-busqueda">
                      {resultados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                      {resultados.map((p) => (
                        <button key={p.id} type="button" className="resultado-item" onClick={() => elegirProductoExistente(p)}>
                          {p.plu} — {p.descripcion}
                          {p.precioMayor != null ? ` (precio mayor sugerido: ${formatoCLP(p.precioMayor)})` : ""}
                          {p.costoEfectivo != null
                            ? ` — último costo de compra: ${formatoCLP(p.costoEfectivo)}${p.costoEsEstimado ? " (estimado)" : ""}`
                            : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {productoElegido && (
                    <p className="ayuda">
                      Último costo de compra:{" "}
                      {productoElegido.costoEfectivo != null ? (
                        <>
                          {formatoCLP(productoElegido.costoEfectivo)}
                          {productoElegido.costoEsEstimado && " (estimado)"}
                        </>
                      ) : (
                        "sin compras registradas"
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <div className="fila-inline">
                  <label>
                    Descripción
                    <input value={nuevoDescripcion} onChange={(e) => setNuevoDescripcion(e.target.value)} />
                  </label>
                  <label>
                    Categoría
                    <SelectorCategoria categorias={categorias} value={nuevoCategoriaId} onChange={setNuevoCategoriaId} required />
                  </label>
                  <label>
                    Se mide en
                    <select value={nuevoFlagBalanza} onChange={(e) => setNuevoFlagBalanza(e.target.value as "NORMAL" | "PESABLE")}>
                      <option value="PESABLE">Peso (kg)</option>
                      <option value="NORMAL">Unidades</option>
                    </select>
                  </label>
                </div>
              )}

              <div className="fila-inline">
                <label>
                  Cantidad ({(origenProducto === "existente" ? productoElegido?.flagBalanza : nuevoFlagBalanza) === "NORMAL" ? "unidades" : "kg"})
                  <input type="number" step="0.01" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </label>
                <label>
                  Precio neto unitario
                  <input type="number" step="1" min="0" value={precioNeto} onChange={(e) => setPrecioNeto(e.target.value)} />
                </label>
                <label>
                  Sale de
                  <select value={origenStock} onChange={(e) => setOrigenStock(e.target.value as "sala_venta" | "camara")}>
                    <option value="sala_venta">Sala de venta (stock general)</option>
                    <option value="camara">Una caja de Cámara</option>
                  </select>
                </label>
                {origenStock === "camara" && (
                  <label>
                    Caja de cámara
                    <select value={cajaCamaraId} onChange={(e) => setCajaCamaraId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">— elegir —</option>
                      {cajasDisponibles.map((c) => (
                        <option key={c.id} value={c.id}>
                          Caja #{c.id} — {c.saldoKg.toFixed(2)} kg disponibles
                        </option>
                      ))}
                    </select>
                    {origenProducto === "existente" && productoElegido && cajasDisponibles.length === 0 && (
                      <span className="ayuda error"> — no hay cajas activas de este producto en cámara</span>
                    )}
                  </label>
                )}
              </div>

              <div className="acciones-formulario">
                <button type="submit" className="boton boton-primario" disabled={guardandoLinea}>
                  {guardandoLinea ? "Agregando..." : "+ Agregar línea"}
                </button>
              </div>
            </form>
          </div>
        )}

        {!yaConfirmada && !mostrarCobro && (
          <div className="acciones-formulario">
            <button type="button" className="boton boton-primario" onClick={() => setMostrarCobro(true)}>
              Ir a cobrar →
            </button>
          </div>
        )}

        {!yaConfirmada && mostrarCobro && (
          <div className="tarjeta">
            <h2>Cobro</h2>
            <p className="ayuda">Con el % de cobro de cada categoría ya aplicado (configurable en Categorías).</p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>% cobro</th>
                  <th>Total a cobrar</th>
                </tr>
              </thead>
              <tbody>
                {itemsActivos.map((item) => (
                  <tr key={item.id}>
                    <td>{item.producto.descripcion}</td>
                    <td>{item.porcentajeCobro != null ? `${(item.porcentajeCobro * 100).toFixed(0)}%` : "—"}</td>
                    <td>{formatoCLP(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Total a cobrar: {formatoCLP(venta.total)}</h3>
            <div className="acciones-formulario">
              <button
                type="button"
                className="boton boton-primario"
                disabled={procesandoCobro !== null}
                onClick={() => cobrar("pendiente")}
              >
                {procesandoCobro === "pendiente" ? "Confirmando..." : "Dejar pendiente de pago y confirmar"}
              </button>
              <button type="button" disabled={procesandoCobro !== null} onClick={() => cobrar("efectivo")}>
                {procesandoCobro === "efectivo" ? "Confirmando..." : "Ya pagó — efectivo"}
              </button>
              <button type="button" disabled={procesandoCobro !== null} onClick={() => cobrar("tarjeta")}>
                {procesandoCobro === "tarjeta" ? "Confirmando..." : "Ya pagó — tarjeta"}
              </button>
              <button type="button" onClick={() => setMostrarCobro(false)} disabled={procesandoCobro !== null}>
                ← Volver a editar
              </button>
            </div>
          </div>
        )}

        {yaConfirmada && (
          <div className="tarjeta">
            <p className="exito">Venta mayorista confirmada — total {formatoCLP(venta.total)}.</p>
            <div className="acciones-formulario">
              <button type="button" onClick={() => setVentaParaImprimir(venta)}>
                Reimprimir ticket
              </button>
              <button type="button" className="boton boton-primario" onClick={nuevaVenta}>
                + Nueva venta mayorista
              </button>
            </div>
          </div>
        )}

        {itemAAnular != null && (
          <ModalConfirmarClave
            titulo="Quitar línea"
            descripcion="Requiere clave de supervisor, igual que en Punto de Venta."
            onConfirmar={confirmarAnularItem}
            onCancelar={() => setItemAAnular(null)}
          />
        )}
      </div>

      <div className="vale-oculto-hasta-imprimir">{ventaParaImprimir && <ValeVenta venta={ventaParaImprimir} />}</div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP, type Comuna, type MedioPago, type Producto, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";
import { TecladoNumerico } from "../components/TecladoNumerico";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

export default function PuntoDeVenta() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [venta, setVenta] = useState<Venta | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [comunas, setComunas] = useState<Comuna[]>([]);
  const [mostrarSelectorComuna, setMostrarSelectorComuna] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [medioPago, setMedioPago] = useState<MedioPago>("efectivo");
  const [montoPago, setMontoPago] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [descuentoTipo, setDescuentoTipo] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [descuentoValor, setDescuentoValor] = useState("");
  const [mostrarFormDescuento, setMostrarFormDescuento] = useState(false);
  const [itemDescuentoEditando, setItemDescuentoEditando] = useState<number | null>(null);
  const [itemDescuentoTipo, setItemDescuentoTipo] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [itemDescuentoValor, setItemDescuentoValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [itemAAnular, setItemAAnular] = useState<number | null>(null);
  const [cancelandoVenta, setCancelandoVenta] = useState(false);
  const [mostrarBuscarProducto, setMostrarBuscarProducto] = useState(false);
  const [mostrarFormComentario, setMostrarFormComentario] = useState(false);
  const [comentarioValor, setComentarioValor] = useState("");

  const inputCantidadRef = useRef<HTMLInputElement>(null);
  const inputMontoPagoRef = useRef<HTMLInputElement>(null);
  const inputBuscarRef = useRef<HTMLInputElement>(null);
  const ventaRef = useRef<Venta | null>(null);

  const seccionBuscarRef = useRef<HTMLElement>(null);
  const seccionPagosRef = useRef<HTMLElement>(null);
  const seccionDespachoRef = useRef<HTMLElement>(null);
  const seccionDescuentoRef = useRef<HTMLElement>(null);
  const seccionComentarioRef = useRef<HTMLElement>(null);
  const mediosPagoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ventaRef.current = venta;
  }, [venta]);

  useEffect(() => {
    setMostrarSelectorComuna(venta?.esDespacho ?? false);
    setComentarioValor(venta?.comentario ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venta?.id]);

  useEffect(() => {
    iniciarVenta();
    api.comunas.listar().then(setComunas).catch((e) => setError(e.message));
  }, []);

  // Atajos de teclado para no ocupar espacio en pantalla ni depender del
  // mouse: F2 abre el buscador de productos, F3 el despacho a domicilio, F4
  // el descuento, F5 el comentario. Las flechas ↑/↓ saltan directo entre las
  // secciones completas (Buscar, Despacho, Descuento, Comentario, Pagos) —
  // pero se ignoran si el foco está en un campo de texto/select/número, para
  // no pisar el comportamiento nativo (flechas del spinner, cambiar de
  // opción). Las flechas ←/→ eligen el medio de pago (Efectivo/Tarjeta/
  // Crédito) cuando el foco está sobre esos botones — se simula un click
  // sobre el botón correspondiente para reusar exactamente la misma lógica
  // que un click con mouse (ej. autocompletar el monto en Tarjeta), leyendo
  // cuál está activo desde el DOM en vez del estado de React (evita usar un
  // valor de medioPago "viejo" capturado por este efecto, que solo se
  // registra una vez al montar la pantalla). Ninguno de estos atajos afecta
  // al lector de código de barras (ignora todo lo que no sea un solo
  // carácter, ver useEscanerCodigoBarras).
  useEffect(() => {
    const secciones = [seccionBuscarRef, seccionDespachoRef, seccionDescuentoRef, seccionComentarioRef, seccionPagosRef];

    function enfocarPrimerCampo(el: HTMLElement | null) {
      if (!el) return;
      const focoInicial = el.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
      );
      focoInicial?.focus();
    }

    function manejarAtajos(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        setMostrarBuscarProducto(true);
        setTimeout(() => inputBuscarRef.current?.focus(), 0);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        setMostrarSelectorComuna((actual) => {
          const nuevo = !actual;
          if (!nuevo) actualizarDespacho(false, null);
          return nuevo;
        });
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setMostrarFormDescuento((actual) => !actual);
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        setMostrarFormComentario(true);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const activo = document.activeElement as HTMLElement | null;
        if (!mediosPagoRef.current?.contains(activo)) return;
        e.preventDefault();
        const botones = Array.from(mediosPagoRef.current.querySelectorAll("button"));
        const indiceActivo = botones.findIndex((b) => b.classList.contains("activo"));
        const total = botones.length;
        const siguiente = e.key === "ArrowRight" ? (indiceActivo + 1) % total : (indiceActivo - 1 + total) % total;
        const boton = botones[siguiente] as HTMLButtonElement | undefined;
        boton?.click();
        // El botón de Tarjeta mueve el foco al campo Monto con su propio
        // setTimeout(0) (para que Enter cobre al toque con mouse) — se
        // registra un setTimeout(0) propio después del click para recuperar
        // el foco en el botón y que las flechas sigan funcionando en cadena
        // (mismo delay, así que corre justo después por orden de registro).
        setTimeout(() => boton?.focus(), 0);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const activo = document.activeElement as HTMLElement | null;
        if (activo && ["INPUT", "SELECT", "TEXTAREA"].includes(activo.tagName)) return;
        const indiceActual = secciones.findIndex((ref) => ref.current?.contains(activo));
        let siguiente: number;
        if (e.key === "ArrowDown") {
          siguiente = indiceActual === -1 ? 0 : Math.min(indiceActual + 1, secciones.length - 1);
        } else {
          siguiente = indiceActual === -1 ? secciones.length - 1 : Math.max(indiceActual - 1, 0);
        }
        if (siguiente === indiceActual) return;
        e.preventDefault();
        enfocarPrimerCampo(secciones[siguiente].current);
      }
    }
    window.addEventListener("keydown", manejarAtajos);
    return () => window.removeEventListener("keydown", manejarAtajos);
  }, []);

  useEffect(() => {
    if (!buscar.trim()) {
      setProductos([]);
      return;
    }
    api.productos.listar({ buscar }).then(setProductos).catch((e) => setError(e.message));
  }, [buscar]);

  async function iniciarVenta() {
    if (!usuario) return;
    try {
      let actual = await api.caja.ventaAbierta();
      if (!actual) {
        try {
          actual = await api.caja.crearVenta(usuario.id);
        } catch {
          // Otra llamada (ej. doble carga de la pantalla) ya creó la venta
          // justo antes — se recupera esa en vez de mostrar un error.
          actual = await api.caja.ventaAbierta();
        }
      }
      setVenta(actual);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const itemsActivos = venta?.items.filter((i) => !i.anulado) ?? [];
  const totalPagado = venta?.pagos.reduce((s, p) => s + p.monto, 0) ?? 0;
  const totalVenta = venta?.total ?? 0;
  const faltaPagar = Math.round((totalVenta - totalPagado) * 100) / 100;

  // Solo puede haber un tipo de descuento activo por venta: a toda la venta
  // o por producto, no los dos a la vez (más claro para el registro).
  const hayDescuentoVenta = !!venta?.descuentoTipo;
  const hayDescuentoItem = itemsActivos.some((i) => i.descuentoTipo);

  // Solo para mostrar el monto del descuento ya aplicado — el cálculo real
  // (el que define el total) lo hace el servidor.
  const subtotalItems = itemsActivos.reduce((s, i) => s + i.subtotal, 0);
  let descuentoAplicadoMonto = 0;
  if (venta?.descuentoTipo === "porcentaje" && venta.descuentoValor) {
    descuentoAplicadoMonto = Math.round(subtotalItems * (venta.descuentoValor / 100));
  } else if (venta?.descuentoTipo === "monto_fijo" && venta.descuentoValor) {
    descuentoAplicadoMonto = venta.descuentoValor;
  }
  descuentoAplicadoMonto = Math.min(descuentoAplicadoMonto, subtotalItems);

  function elegirProducto(p: Producto) {
    setProductoSeleccionado(p);
    setBuscar("");
    setProductos([]);
    setTimeout(() => inputCantidadRef.current?.focus(), 0);
  }

  async function agregarItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!venta || !productoSeleccionado) {
      setError("Elige un producto");
      return;
    }
    const cant = Number(cantidad);
    if (!cant || cant <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    try {
      const actualizada = await api.caja.agregarItem(venta.id, { productoId: productoSeleccionado.id, cantidad: cant });
      setVenta(actualizada);
      setProductoSeleccionado(null);
      setCantidad("");
      setBuscar("");
      // Se cierra solo, igual que Despacho/Descuento/Comentario cuando no se
      // están usando — el buscador manual es el respaldo del lector de
      // código de barras, no hace falta dejarlo abierto ocupando espacio
      // después de agregar el producto (F2 lo vuelve a abrir al toque).
      setMostrarBuscarProducto(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const escanearCodigo = useCallback(async (codigo: string) => {
    setError(null);
    setMensaje(null);
    const ventaActual = ventaRef.current;
    if (!ventaActual) return;
    try {
      const actualizada = await api.caja.escanearCodigo(ventaActual.id, codigo);
      const nuevo = actualizada.items[actualizada.items.length - 1];
      setMensaje(nuevo ? `Agregado: ${nuevo.producto.descripcion} (${nuevo.cantidad})` : "Producto agregado");
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEscanerCodigoBarras(escanearCodigo, !!venta);

  // Anular un ítem del carrito siempre pide clave de supervisor y el nombre
  // de quien autoriza (no necesariamente el cajero con la sesión abierta),
  // vía el modal ModalConfirmarClave — se abre marcando itemAAnular.
  async function confirmarAnularItem(usuarioId: number, clave: string, motivo?: string) {
    if (!venta || itemAAnular == null) return;
    setMensaje(null);
    const actualizada = await api.caja.anularItem(venta.id, itemAAnular, { clave, usuarioId, motivo });
    setVenta(actualizada);
    setMensaje("Ítem anulado");
    setItemAAnular(null);
  }

  // En efectivo, el cajero escribe lo que el cliente entregó en la mano — no
  // necesariamente el monto exacto de la venta. Solo se registra como pago
  // lo que realmente cubre lo que falta; el resto se muestra como vuelto,
  // sin guardarse en ningún lado (no es dinero que se queda en la caja).
  const faltaPagarPositivo = Math.max(faltaPagar, 0);
  const montoIngresado = Number(montoPago) || 0;
  const vueltoPreview =
    medioPago === "efectivo" && montoIngresado > faltaPagarPositivo ? montoIngresado - faltaPagarPositivo : 0;

  async function agregarPago(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!venta) return;
    const monto = Number(montoPago);
    if (!monto || monto <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    if (medioPago === "credito" && !clienteNombre.trim()) {
      setError("Falta el nombre del cliente para dejarlo a crédito");
      return;
    }
    const montoACobrar = medioPago === "efectivo" ? Math.min(monto, faltaPagarPositivo) : monto;
    if (montoACobrar <= 0) {
      setError("Ya no falta nada por pagar");
      return;
    }
    const vueltoAEntregar = vueltoPreview;
    try {
      const actualizada = await api.caja.agregarPago(venta.id, {
        medio: medioPago,
        monto: montoACobrar,
        clienteNombre: medioPago === "credito" ? clienteNombre.trim() : undefined,
      });
      setVenta(actualizada);
      setMontoPago("");
      setClienteNombre("");
      if (vueltoAEntregar > 0) {
        window.alert(`Vuelto: ${formatoCLP(vueltoAEntregar)}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function actualizarDespacho(esDespacho: boolean, comunaId: number | null) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDespacho(venta.id, { esDespacho, comunaId });
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarDescuento(e: React.FormEvent) {
    e.preventDefault();
    if (!venta) return;
    setError(null);
    const valor = Number(descuentoValor);
    if (!valor || valor <= 0) {
      setError("Ingresa un descuento válido");
      return;
    }
    try {
      const actualizada = await api.caja.actualizarDescuento(venta.id, { tipo: descuentoTipo, valor });
      setVenta(actualizada);
      setDescuentoValor("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarDescuento() {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDescuento(venta.id, { tipo: null, valor: null });
      setVenta(actualizada);
      setMostrarFormDescuento(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarDescuentoItem(itemId: number) {
    if (!venta) return;
    setError(null);
    const valor = Number(itemDescuentoValor);
    if (!valor || valor <= 0) {
      setError("Ingresa un descuento válido");
      return;
    }
    try {
      const actualizada = await api.caja.actualizarDescuentoItem(venta.id, itemId, { tipo: itemDescuentoTipo, valor });
      setVenta(actualizada);
      setItemDescuentoEditando(null);
      setItemDescuentoValor("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarDescuentoItem(itemId: number) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDescuentoItem(venta.id, itemId, { tipo: null, valor: null });
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarComentario(e: React.FormEvent) {
    e.preventDefault();
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarComentario(venta.id, comentarioValor.trim() || null);
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarComentario() {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarComentario(venta.id, null);
      setVenta(actualizada);
      setComentarioValor("");
      setMostrarFormComentario(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarPago(pagoId: number) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.quitarPago(venta.id, pagoId);
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmarVenta() {
    if (!venta || !usuario) return;
    setError(null);
    const confirmado = window.confirm(`¿Confirmar venta por ${formatoCLP(totalVenta)}?`);
    if (!confirmado) return;
    setProcesando(true);
    try {
      await api.caja.confirmarVenta(venta.id, usuario.id);
      navigate(`/caja/buscar?imprimir=${venta.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesando(false);
    }
  }

  // Igual que anular un ítem, cancelar toda la venta pide clave de
  // supervisor y el nombre de quien autoriza, vía ModalConfirmarClave.
  async function confirmarCancelarVenta(usuarioId: number, clave: string, motivo?: string) {
    if (!venta) return;
    await api.caja.cancelarVenta(venta.id, { usuarioId, clave, motivo });
    navigate("/caja");
  }

  if (!venta) {
    return (
      <div className="punto-de-venta">
        <h1>Punto de venta</h1>
        {error && <p className="error">{error}</p>}
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <div className="punto-de-venta">
      <div className="encabezado-venta">
        <h1>Punto de venta</h1>
        <div className="total-venta-destacado">Total: {formatoCLP(totalVenta)}</div>
      </div>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <p className="ayuda ayuda-linea">🔦 Lector de código de barras listo — escanea en cualquier momento.</p>

      <div className="punto-de-venta-layout">
        <div className="columna-izquierda">
          <section ref={seccionBuscarRef} className="tarjeta tarjeta-compacta">
            {!mostrarBuscarProducto ? (
              <button
                type="button"
                onClick={() => {
                  setMostrarBuscarProducto(true);
                  setTimeout(() => inputBuscarRef.current?.focus(), 0);
                }}
              >
                + Buscar producto (F2)
              </button>
            ) : (
              <>
                <div className="fila-inline" style={{ justifyContent: "space-between" }}>
                  <h2>Agregar producto manualmente</h2>
                  <button type="button" onClick={() => setMostrarBuscarProducto(false)}>
                    Cerrar
                  </button>
                </div>
                <form onSubmit={agregarItem} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <div className="buscador-producto">
                    <input
                      ref={inputBuscarRef}
                      type="text"
                      placeholder="Buscar por PLU o nombre..."
                      value={buscar}
                      onChange={(e) => {
                        setBuscar(e.target.value);
                        setProductoSeleccionado(null);
                      }}
                    />
                    {buscar.trim() && (
                      <div className="resultados-busqueda">
                        {productos.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                        {productos.map((p) => (
                          <button key={p.id} type="button" className="resultado-item" onClick={() => elegirProducto(p)}>
                            {p.plu} — {p.descripcion} ({formatoCLP(p.precio)}, stock: {p.stockActual})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {productoSeleccionado && (
                    <span className="exito">
                      Vendiendo: {productoSeleccionado.descripcion} ({formatoCLP(productoSeleccionado.precio)})
                    </span>
                  )}
                  <input
                    ref={inputCantidadRef}
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder="Cantidad"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                  />
                  <TecladoNumerico valor={cantidad} onCambiar={setCantidad} />
                  <button type="submit" className="boton boton-primario">
                    Agregar al carrito
                  </button>
                </form>
              </>
            )}
          </section>

          <section ref={seccionPagosRef} className="tarjeta">
            <h2>Pagos</h2>
            <div className="medios-pago" ref={mediosPagoRef}>
              <button
                type="button"
                className={`medio-pago-tile ${medioPago === "efectivo" ? "activo" : ""}`}
                onClick={() => setMedioPago("efectivo")}
              >
                <span className="medio-pago-icono">💵</span>
                Efectivo
              </button>
              <button
                type="button"
                className={`medio-pago-tile ${medioPago === "tarjeta" ? "activo" : ""}`}
                onClick={() => {
                  setMedioPago("tarjeta");
                  // En tarjeta siempre se cobra el monto exacto — se autocompleta
                  // lo que falta pagar para no tener que escribirlo a mano, y se
                  // deja el foco listo para que Enter agregue el pago al toque.
                  if (faltaPagarPositivo > 0) setMontoPago(String(faltaPagarPositivo));
                  setTimeout(() => inputMontoPagoRef.current?.focus(), 0);
                }}
              >
                <span className="medio-pago-icono">💳</span>
                Tarjeta
              </button>
              <button
                type="button"
                className={`medio-pago-tile ${medioPago === "credito" ? "activo" : ""}`}
                onClick={() => setMedioPago("credito")}
              >
                <span className="medio-pago-icono">🧾</span>
                Crédito
              </button>
            </div>
            <p className="ayuda ayuda-linea">Usa ← → sobre un medio de pago para cambiarlo.</p>
            <form onSubmit={agregarPago} onKeyDown={manejarEnterComoTab} className="fila-inline">
              {medioPago === "credito" && (
                <input
                  type="text"
                  placeholder="Nombre del cliente"
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                />
              )}
              <input
                ref={inputMontoPagoRef}
                type="number"
                min="1"
                placeholder={medioPago === "efectivo" ? "Efectivo recibido" : "Monto"}
                value={montoPago}
                onChange={(e) => setMontoPago(e.target.value)}
              />
              <TecladoNumerico valor={montoPago} onCambiar={setMontoPago} />
              <button type="submit">Agregar pago</button>
              {vueltoPreview > 0 && <span className="exito">Vuelto: {formatoCLP(vueltoPreview)}</span>}
            </form>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Medio</th>
                  <th>Monto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {venta.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.medio === "efectivo" ? "Efectivo" : p.medio === "tarjeta" ? "Tarjeta" : `Crédito (${p.clienteNombre})`}
                    </td>
                    <td>{formatoCLP(p.monto)}</td>
                    <td>
                      <button type="button" onClick={() => quitarPago(p.id)}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                {venta.pagos.length === 0 && (
                  <tr>
                    <td colSpan={3}>Todavía no hay pagos registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p>
              {faltaPagar > 0 && <span className="error">Falta pagar: {formatoCLP(faltaPagar)}</span>}
              {faltaPagar < 0 && <span className="error">Los pagos superan el total en {formatoCLP(-faltaPagar)}</span>}
              {faltaPagar === 0 && itemsActivos.length > 0 && <span className="exito">Los pagos cubren el total.</span>}
            </p>
          </section>

          <div className="acciones-formulario fila-inline">
            <button
              type="button"
              className="boton boton-primario"
              disabled={procesando || faltaPagar !== 0 || itemsActivos.length === 0}
              onClick={confirmarVenta}
            >
              {procesando ? "Confirmando..." : "Confirmar venta"}
            </button>
            <button type="button" onClick={() => setCancelandoVenta(true)}>
              Cancelar venta
            </button>
          </div>
        </div>

        <div className="columna-derecha">
          <section className="tarjeta">
            <h2>Carrito</h2>
            <div className="carrito-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio unitario</th>
                  <th>Descuento</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item) => {
                  const rawSubtotal = Math.round(item.precioUnitario * item.cantidad);
                  const descuentoMontoItem = rawSubtotal - item.subtotal;
                  return (
                    <tr key={item.id} className={item.anulado ? "fila-error" : ""}>
                      <td>{item.producto.descripcion}</td>
                      <td>{item.cantidad}</td>
                      <td>{formatoCLP(item.precioUnitario)}</td>
                      <td>
                        {item.anulado ? (
                          "—"
                        ) : item.descuentoTipo ? (
                          <span className="fila-inline">
                            -{formatoCLP(descuentoMontoItem)}
                            <button type="button" className="boton-chico" onClick={() => quitarDescuentoItem(item.id)}>
                              Quitar
                            </button>
                          </span>
                        ) : itemDescuentoEditando === item.id ? (
                          <span className="fila-inline">
                            <select
                              value={itemDescuentoTipo}
                              onChange={(e) => setItemDescuentoTipo(e.target.value as "porcentaje" | "monto_fijo")}
                            >
                              <option value="porcentaje">%</option>
                              <option value="monto_fijo">$</option>
                            </select>
                            <input
                              type="number"
                              min="1"
                              className="input-chico"
                              placeholder={itemDescuentoTipo === "porcentaje" ? "10" : "500"}
                              value={itemDescuentoValor}
                              onChange={(e) => setItemDescuentoValor(e.target.value)}
                              autoFocus
                            />
                            <button type="button" className="boton-chico" onClick={() => aplicarDescuentoItem(item.id)}>
                              OK
                            </button>
                            <button type="button" className="boton-chico" onClick={() => setItemDescuentoEditando(null)}>
                              ✕
                            </button>
                          </span>
                        ) : hayDescuentoVenta ? (
                          "—"
                        ) : (
                          <button
                            type="button"
                            className="boton-chico"
                            onClick={() => {
                              setItemDescuentoEditando(item.id);
                              setItemDescuentoValor("");
                            }}
                          >
                            + Desc.
                          </button>
                        )}
                      </td>
                      <td>{formatoCLP(item.subtotal)}</td>
                      <td>
                        {item.anulado ? (
                          "Anulado"
                        ) : (
                          <button
                            type="button"
                            className="boton-quitar-item"
                            title="Quitar del carrito"
                            onClick={() => setItemAAnular(item.id)}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {itemsActivos.length === 0 && (
                  <tr>
                    <td colSpan={6}>Todavía no hay productos en el carrito.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            {venta.descuentoTipo && (
              <p>
                Subtotal: {formatoCLP(subtotalItems)} · Descuento: -{formatoCLP(descuentoAplicadoMonto)}
                {venta.costoEnvio ? ` · Envío: ${formatoCLP(venta.costoEnvio)}` : ""}
              </p>
            )}
          </section>

          <section ref={seccionDespachoRef} className="tarjeta tarjeta-mini">
            {!mostrarSelectorComuna ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarSelectorComuna(true)}>
                + Despacho a domicilio (F3)
              </button>
            ) : (
              <>
                <h2>Despacho</h2>
                <label className="fila-inline" style={{ marginBottom: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={mostrarSelectorComuna}
                    onChange={(e) => {
                      setMostrarSelectorComuna(e.target.checked);
                      if (!e.target.checked) actualizarDespacho(false, null);
                    }}
                  />
                  Es despacho a domicilio
                </label>
                <select
                  value={venta.comunaId ?? ""}
                  onChange={(e) => {
                    const comunaId = e.target.value ? Number(e.target.value) : null;
                    if (comunaId) actualizarDespacho(true, comunaId);
                  }}
                >
                  <option value="">Elegir comuna...</option>
                  {comunas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({formatoCLP(c.costoEnvio)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </section>

          <section ref={seccionDescuentoRef} className="tarjeta tarjeta-mini">
            {venta.descuentoTipo ? (
              <>
                <h2>Descuento</h2>
                <p className="fila-inline">
                  <span className="exito">
                    Descuento aplicado:{" "}
                    {venta.descuentoTipo === "porcentaje" ? `${venta.descuentoValor}%` : formatoCLP(venta.descuentoValor!)}{" "}
                    (-{formatoCLP(descuentoAplicadoMonto)})
                  </span>
                  <button type="button" className="boton-chico" onClick={quitarDescuento}>
                    Quitar descuento
                  </button>
                </p>
              </>
            ) : hayDescuentoItem ? (
              <p className="ayuda">Hay descuentos por producto — quítalos para descontar toda la venta.</p>
            ) : !mostrarFormDescuento ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarFormDescuento(true)}>
                + Agregar descuento (F4)
              </button>
            ) : (
              <>
                <h2>Descuento</h2>
                <form onSubmit={aplicarDescuento} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <select value={descuentoTipo} onChange={(e) => setDescuentoTipo(e.target.value as "porcentaje" | "monto_fijo")}>
                    <option value="porcentaje">Porcentaje (%)</option>
                    <option value="monto_fijo">Monto fijo ($)</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    placeholder={descuentoTipo === "porcentaje" ? "Ej: 10" : "Ej: 2000"}
                    value={descuentoValor}
                    onChange={(e) => setDescuentoValor(e.target.value)}
                  />
                  <button type="submit">Aplicar descuento</button>
                </form>
              </>
            )}
          </section>

          <section ref={seccionComentarioRef} className="tarjeta tarjeta-mini">
            {venta.comentario ? (
              <>
                <h2>Comentario</h2>
                <p className="fila-inline">
                  <span>{venta.comentario}</span>
                  <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(true)}>
                    Editar
                  </button>
                  <button type="button" className="boton-chico" onClick={quitarComentario}>
                    Quitar
                  </button>
                </p>
              </>
            ) : !mostrarFormComentario ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(true)}>
                + Comentario (F5)
              </button>
            ) : (
              <>
                <h2>Comentario</h2>
                <form onSubmit={guardarComentario} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <input
                    type="text"
                    placeholder="Ej: cliente pidió sin hueso"
                    maxLength={500}
                    value={comentarioValor}
                    onChange={(e) => setComentarioValor(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="boton-chico">
                    Guardar
                  </button>
                  <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(false)}>
                    Cerrar
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      {itemAAnular != null && (
        <ModalConfirmarClave
          titulo="Anular producto"
          descripcion="Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={[
            "Ítem duplicado",
            "Cliente canceló ese producto",
            "Precio equivocado",
            "Producto equivocado",
            "Error de peso o cantidad",
          ]}
          onConfirmar={confirmarAnularItem}
          onCancelar={() => setItemAAnular(null)}
        />
      )}

      {cancelandoVenta && (
        <ModalConfirmarClave
          titulo="Cancelar toda la venta"
          descripcion="No se guardará nada de esta venta. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={["Cliente canceló la compra", "Venta duplicada", "Error del cajero"]}
          onConfirmar={confirmarCancelarVenta}
          onCancelar={() => setCancelandoVenta(false)}
        />
      )}
    </div>
  );
}

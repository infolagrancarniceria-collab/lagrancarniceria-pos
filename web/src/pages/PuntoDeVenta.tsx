import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP, type MedioPago, type Producto, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";

export default function PuntoDeVenta() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [venta, setVenta] = useState<Venta | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscar, setBuscar] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [medioPago, setMedioPago] = useState<MedioPago>("efectivo");
  const [montoPago, setMontoPago] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const inputCantidadRef = useRef<HTMLInputElement>(null);
  const ventaRef = useRef<Venta | null>(null);

  useEffect(() => {
    ventaRef.current = venta;
  }, [venta]);

  useEffect(() => {
    iniciarVenta();
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

  async function anularItem(itemId: number) {
    if (!venta || !usuario) return;
    setError(null);
    setMensaje(null);
    const clave = window.prompt("Clave de supervisor para anular este ítem:");
    if (!clave) return;
    try {
      const actualizada = await api.caja.anularItem(venta.id, itemId, { clave, usuarioId: usuario.id });
      setVenta(actualizada);
      setMensaje("Ítem anulado");
    } catch (e) {
      setError((e as Error).message);
    }
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
    const montoACobrar = medioPago === "efectivo" ? Math.min(monto, faltaPagarPositivo) : monto;
    if (montoACobrar <= 0) {
      setError("Ya no falta nada por pagar");
      return;
    }
    const vueltoAEntregar = vueltoPreview;
    try {
      const actualizada = await api.caja.agregarPago(venta.id, { medio: medioPago, monto: montoACobrar });
      setVenta(actualizada);
      setMontoPago("");
      if (vueltoAEntregar > 0) {
        window.alert(`Vuelto: ${formatoCLP(vueltoAEntregar)}`);
      }
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
      navigate("/caja");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesando(false);
    }
  }

  async function cancelarVenta() {
    if (!venta) return;
    const confirmado = window.confirm("¿Cancelar toda la venta? No se guardará nada.");
    if (!confirmado) return;
    try {
      await api.caja.cancelarVenta(venta.id);
      navigate("/caja");
    } catch (e) {
      setError((e as Error).message);
    }
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
      <h1>Punto de venta</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <section className="tarjeta">
        <p className="ayuda">
          🔦 Lector de código de barras listo — escanea en cualquier momento en esta pantalla, no hace falta hacer
          clic en ningún campo primero. Funciona con el código de fábrica (productos normales) y con el que
          imprime la balanza (productos pesables).
        </p>
      </section>

      <section className="tarjeta">
        <h2>Agregar producto manualmente</h2>
        <form onSubmit={agregarItem} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <div className="buscador-producto">
            <input
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
            min="0.01"
            step="0.01"
            placeholder="Cantidad"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
          <button type="submit" className="boton boton-primario">
            Agregar al carrito
          </button>
        </form>
      </section>

      <section className="tarjeta">
        <h2>Carrito</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio unitario</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {venta.items.map((item) => (
              <tr key={item.id} className={item.anulado ? "fila-error" : ""}>
                <td>{item.producto.descripcion}</td>
                <td>{item.cantidad}</td>
                <td>{formatoCLP(item.precioUnitario)}</td>
                <td>{formatoCLP(item.subtotal)}</td>
                <td>
                  {item.anulado ? (
                    "Anulado"
                  ) : (
                    <button type="button" onClick={() => anularItem(item.id)}>
                      Anular
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {itemsActivos.length === 0 && (
              <tr>
                <td colSpan={5}>Todavía no hay productos en el carrito.</td>
              </tr>
            )}
          </tbody>
        </table>
        <h2>Total: {formatoCLP(totalVenta)}</h2>
      </section>

      <section className="tarjeta">
        <h2>Pagos</h2>
        <form onSubmit={agregarPago} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <select value={medioPago} onChange={(e) => setMedioPago(e.target.value as MedioPago)}>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
          </select>
          <input
            type="number"
            min="1"
            placeholder={medioPago === "efectivo" ? "Efectivo recibido" : "Monto"}
            value={montoPago}
            onChange={(e) => setMontoPago(e.target.value)}
          />
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
                <td>{p.medio === "efectivo" ? "Efectivo" : "Tarjeta"}</td>
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
        <button type="button" onClick={cancelarVenta}>
          Cancelar venta
        </button>
      </div>
    </div>
  );
}

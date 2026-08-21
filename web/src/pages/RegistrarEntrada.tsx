import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, calcularMargen, formatoCLP, type Producto, type ProductoConCosto, type Proveedor } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";

export default function RegistrarEntrada() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscarProducto, setBuscarProducto] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);
  const [infoProducto, setInfoProducto] = useState<ProductoConCosto | null>(null);
  const [precioNuevo, setPrecioNuevo] = useState("");
  const [cambiandoPrecio, setCambiandoPrecio] = useState(false);

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscarProveedor, setBuscarProveedor] = useState("");
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);

  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState<"compra" | "ajuste">("compra");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }, []);

  // Al elegir un producto, trae su precio de compra actual y anterior (para
  // comparar si el proveedor subió o bajó el costo) y su precio de venta
  // vigente, con la opción de cambiarlo ahí mismo antes de registrar la
  // entrada nueva — a pedido del usuario, para no tener que ir a Productos
  // aparte a revisar/ajustar el precio cada vez que llega mercadería.
  useEffect(() => {
    setInfoProducto(null);
    setPrecioNuevo("");
    if (!productoSeleccionado) return;
    api.productos
      .obtener(productoSeleccionado.id)
      .then(setInfoProducto)
      .catch((e) => setError(e.message));
  }, [productoSeleccionado]);

  async function cambiarPrecioVenta() {
    if (!infoProducto || !usuario) return;
    const nuevo = Number(precioNuevo);
    if (!nuevo || nuevo <= 0) {
      setError("Ingresa un precio de venta nuevo válido");
      return;
    }
    const confirmado = window.confirm(
      `¿Cambiar el precio de venta de "${infoProducto.descripcion}" de ${formatoCLP(infoProducto.precio)} a ${formatoCLP(nuevo)}?`
    );
    if (!confirmado) return;
    setCambiandoPrecio(true);
    setError(null);
    try {
      const actualizado = await api.precios.cambiarIndividual({
        productoId: infoProducto.id,
        precioNuevo: nuevo,
        usuarioId: usuario.id,
      });
      setInfoProducto({ ...infoProducto, precio: actualizado.precio });
      setPrecioNuevo("");
      mostrarToast("Precio actualizado", `${infoProducto.descripcion}: ${formatoCLP(actualizado.precio)}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCambiandoPrecio(false);
    }
  }

  useEffect(() => {
    if (!buscarProducto.trim()) {
      setProductos([]);
      return;
    }
    const timeout = setTimeout(() => {
      api.productos.listar({ buscar: buscarProducto }).then(setProductos).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timeout);
  }, [buscarProducto]);

  const proveedoresFiltrados = buscarProveedor.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(buscarProveedor.trim().toLowerCase()))
    : proveedores;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!productoSeleccionado || !usuario) {
      setError("Falta elegir un producto");
      return;
    }
    const cant = Number(cantidad);
    if (!cant || cant <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    setGuardando(true);
    try {
      await api.inventario.entrada({
        productoId: productoSeleccionado.id,
        cantidad: cant,
        motivo,
        proveedorId: proveedorSeleccionado?.id ?? null,
        costoUnitario: costoUnitario ? Number(costoUnitario) : null,
        numeroFactura: numeroFactura.trim() || null,
        usuarioId: usuario.id,
      });
      setMensaje("Entrada registrada — el stock quedó actualizado");
      mostrarToast("Entrada registrada", `${productoSeleccionado.descripcion}: +${cant} al stock.`);
      setProductoSeleccionado(null);
      setBuscarProducto("");
      setCantidad("");
      setCostoUnitario("");
      setNumeroFactura("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Registrar entrada de mercadería</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Producto
          <div className="buscador-producto">
            <input
              type="text"
              placeholder="Buscar por PLU o nombre..."
              value={buscarProducto}
              onChange={(e) => {
                setBuscarProducto(e.target.value);
                setProductoSeleccionado(null);
              }}
            />
            {buscarProducto.trim() && (
              <div className="resultados-busqueda">
                {productos.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {productos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProductoSeleccionado(p);
                      setBuscarProducto("");
                      setProductos([]);
                    }}
                  >
                    {p.plu} — {p.descripcion}
                  </button>
                ))}
              </div>
            )}
          </div>
          {productoSeleccionado && <p className="exito">Producto elegido: {productoSeleccionado.descripcion}</p>}
        </label>

        {infoProducto && (
          <div className="tarjeta tarjeta-mini">
            <p>
              <strong>Precio de compra actual:</strong>{" "}
              {infoProducto.ultimoCosto != null ? formatoCLP(infoProducto.ultimoCosto) : "sin compras registradas"}
              {infoProducto.penultimoCosto != null && (
                <> · anterior: {formatoCLP(infoProducto.penultimoCosto)}</>
              )}
            </p>
            <p>
              <strong>Precio de venta actual:</strong> {formatoCLP(infoProducto.precio)}
              {infoProducto.ultimoCosto != null && (
                <> · margen: {calcularMargen(infoProducto.precio, infoProducto.ultimoCosto)?.toFixed(2)}%</>
              )}
            </p>
            <div className="fila-inline">
              <input
                type="number"
                min="1"
                className="input-chico"
                placeholder="Nuevo precio de venta"
                value={precioNuevo}
                onChange={(e) => setPrecioNuevo(e.target.value)}
              />
              <button type="button" onClick={cambiarPrecioVenta} disabled={cambiandoPrecio || !precioNuevo}>
                {cambiandoPrecio ? "Cambiando..." : "Cambiar precio de venta"}
              </button>
            </div>
          </div>
        )}

        <label>
          Cantidad
          <input type="number" min="0.001" step="0.001" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        </label>
        <label>
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as "compra" | "ajuste")}>
            <option value="compra">Compra a proveedor</option>
            <option value="ajuste">Ajuste (ej. conteo físico encontró más stock)</option>
          </select>
        </label>
        {motivo === "compra" && (
          <>
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
              Costo unitario
              <input
                type="number"
                min="0"
                value={costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
                placeholder="opcional"
              />
            </label>
            <label>
              N° de factura del proveedor
              <input
                type="text"
                value={numeroFactura}
                onChange={(e) => setNumeroFactura(e.target.value)}
                placeholder="opcional"
              />
            </label>
          </>
        )}

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar entrada"}
          </button>
          <button type="button" onClick={() => navigate("/inventario")}>
            Volver a inventario
          </button>
        </div>
      </form>
    </div>
  );
}

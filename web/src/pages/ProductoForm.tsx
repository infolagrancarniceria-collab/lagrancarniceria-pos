import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, calcularMargen, formatoCLP, type Categoria, type FlagBalanza, type ProductoConCosto } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";

interface FormState {
  plu: string;
  descripcion: string;
  nombreCorto: string;
  marca: string;
  categoriaId: number | "";
  precio: string;
  precioMayor: string;
  flagBalanza: FlagBalanza;
  codigoBarras: string;
  contenido: string;
  capacidadPorCaja: string;
  envase: string;
  impuestoAdicional: string;
  duracion: string;
  codigoProveedor: string;
  umbralStockBajo: string;
}

const formVacio: FormState = {
  plu: "",
  descripcion: "",
  nombreCorto: "",
  marca: "",
  categoriaId: "",
  precio: "",
  precioMayor: "",
  flagBalanza: "NORMAL",
  codigoBarras: "",
  contenido: "",
  capacidadPorCaja: "",
  envase: "",
  impuestoAdicional: "",
  duracion: "",
  codigoProveedor: "",
  umbralStockBajo: "",
};

export default function ProductoForm() {
  const { id } = useParams();
  const esNuevo = !id;
  const navigate = useNavigate();
  const { usuario } = useUsuario();

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [form, setForm] = useState<FormState>(formVacio);
  const [productoActual, setProductoActual] = useState<ProductoConCosto | null>(null);
  const [precioNuevo, setPrecioNuevo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  // Sugerencia de PLU al crear un producto nuevo (el siguiente número
  // libre) — el campo se queda editable por si este producto necesita
  // calzar con un código específico ya conocido.
  useEffect(() => {
    if (!esNuevo) return;
    api.productos
      .proximoPlu()
      .then(({ plu }) => setForm((f) => ({ ...f, plu })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esNuevo]);

  useEffect(() => {
    if (!id) return;
    api.productos
      .obtener(Number(id))
      .then((p) => {
        setProductoActual(p);
        setForm({
          plu: p.plu,
          descripcion: p.descripcion,
          nombreCorto: p.nombreCorto ?? "",
          marca: p.marca ?? "",
          categoriaId: p.categoriaId,
          precio: String(p.precio),
          precioMayor: p.precioMayor != null ? String(p.precioMayor) : "",
          flagBalanza: p.flagBalanza,
          codigoBarras: p.codigoBarras ?? "",
          contenido: p.contenido ?? "",
          capacidadPorCaja: p.capacidadPorCaja ?? "",
          envase: p.envase ?? "",
          impuestoAdicional: p.impuestoAdicional != null ? String(p.impuestoAdicional) : "",
          duracion: p.duracion ?? "",
          codigoProveedor: p.codigoProveedor ?? "",
          umbralStockBajo: p.umbralStockBajo != null ? String(p.umbralStockBajo) : "",
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  function actualizarCampo<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);

    if (!form.categoriaId) {
      setError("Falta elegir una categoría");
      return;
    }

    const datosComunes = {
      plu: form.plu.trim(),
      descripcion: form.descripcion.trim(),
      nombreCorto: form.nombreCorto.trim() || null,
      marca: form.marca.trim() || null,
      categoriaId: Number(form.categoriaId),
      flagBalanza: form.flagBalanza,
      codigoBarras: form.flagBalanza === "NORMAL" ? form.codigoBarras.trim() || null : null,
      contenido: form.contenido.trim() || null,
      capacidadPorCaja: form.capacidadPorCaja.trim() || null,
      envase: form.envase.trim() || null,
      impuestoAdicional: form.impuestoAdicional ? Number(form.impuestoAdicional) : null,
      duracion: form.duracion.trim() || null,
      codigoProveedor: form.codigoProveedor.trim() || null,
      umbralStockBajo: form.umbralStockBajo ? Number(form.umbralStockBajo) : null,
      precioMayor: form.precioMayor ? Number(form.precioMayor) : null,
    };

    setGuardando(true);
    try {
      if (esNuevo) {
        const precio = Number(form.precio);
        if (!precio || precio <= 0) {
          setError("El precio debe ser mayor a 0");
          setGuardando(false);
          return;
        }
        const creado = await api.productos.crear({ ...datosComunes, precio });
        mostrarToast("Producto creado", `${creado.descripcion} se agregó al catálogo.`);
        navigate(`/productos/${creado.id}`);
      } else {
        await api.productos.actualizar(Number(id), datosComunes);
        setMensaje("Datos del producto guardados");
        mostrarToast("Cambios guardados", `${datosComunes.descripcion} se actualizó.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarPrecio(e: React.FormEvent) {
    e.preventDefault();
    if (!productoActual || !usuario) return;
    setError(null);
    setMensaje(null);
    const nuevo = Number(precioNuevo);
    if (!nuevo || nuevo <= 0) {
      setError("Ingresa un precio nuevo válido");
      return;
    }
    const confirmado = window.confirm(
      `¿Cambiar el precio de "${productoActual.descripcion}" de ${formatoCLP(productoActual.precio)} a ${formatoCLP(nuevo)}?`
    );
    if (!confirmado) return;

    try {
      const actualizado = await api.precios.cambiarIndividual({
        productoId: productoActual.id,
        precioNuevo: nuevo,
        usuarioId: usuario.id,
      });
      setProductoActual({ ...productoActual, precio: actualizado.precio });
      setPrecioNuevo("");
      setMensaje("Precio actualizado");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const margenActual = productoActual ? calcularMargen(productoActual.precio, productoActual.ultimoCosto) : null;
  const margenNuevo =
    productoActual && precioNuevo && Number(precioNuevo) > 0
      ? calcularMargen(Number(precioNuevo), productoActual.ultimoCosto)
      : null;

  return (
    <div>
      <h1>{esNuevo ? "Nuevo producto" : `Editar producto: ${productoActual?.descripcion ?? ""}`}</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      {!esNuevo && productoActual && (
        <div className="tarjeta cambio-precio">
          <h2>Precio actual: {formatoCLP(productoActual.precio)}</h2>
          {productoActual.ultimoCosto == null ? (
            <p className="ayuda">
              Sin costo registrado — registra una entrada de compra para este producto en Inventario para ver el
              margen (%).
            </p>
          ) : (
            <p>
              Costo: {formatoCLP(productoActual.ultimoCosto)} · Margen actual:{" "}
              <strong>{margenActual?.toFixed(2)}%</strong>
              {margenNuevo != null && (
                <>
                  {" "}
                  → con el precio nuevo: <strong>{margenNuevo.toFixed(2)}%</strong>
                </>
              )}
            </p>
          )}
          <form onSubmit={cambiarPrecio} onKeyDown={manejarEnterComoTab} className="fila-inline">
            <input
              type="number"
              min="1"
              placeholder="Precio nuevo"
              value={precioNuevo}
              onChange={(e) => setPrecioNuevo(e.target.value)}
            />
            <button type="submit">Cambiar precio</button>
          </form>
        </div>
      )}

      {!esNuevo && productoActual && (
        <div className="tarjeta cambio-precio">
          <h2>
            Stock actual: {productoActual.stockActual}
            {productoActual.umbralStockBajo != null &&
              productoActual.stockActual <= productoActual.umbralStockBajo && (
                <span className="error"> — bajo el umbral ({productoActual.umbralStockBajo})</span>
              )}
          </h2>
          <p className="ayuda">
            El stock se actualiza solo con los movimientos de inventario.{" "}
            <Link to="/inventario/entrada">Registrar entrada</Link> ·{" "}
            <Link to="/inventario/salida">Registrar salida</Link>
          </p>
        </div>
      )}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          PLU / Código
          <input value={form.plu} onChange={(e) => actualizarCampo("plu", e.target.value)} required />
          {esNuevo && <span className="ayuda">Sugerido automáticamente — puedes cambiarlo si este producto necesita un código específico.</span>}
        </label>
        <label>
          Descripción
          <input value={form.descripcion} onChange={(e) => actualizarCampo("descripcion", e.target.value)} required />
        </label>
        <label>
          Nombre corto
          <input value={form.nombreCorto} onChange={(e) => actualizarCampo("nombreCorto", e.target.value)} />
        </label>
        <label>
          Marca
          <input value={form.marca} onChange={(e) => actualizarCampo("marca", e.target.value)} />
        </label>
        <label>
          Categoría
          <SelectorCategoria
            categorias={categorias}
            value={form.categoriaId}
            onChange={(v) => actualizarCampo("categoriaId", v)}
            required
          />
        </label>
        <label>
          Flag balanza
          <select value={form.flagBalanza} onChange={(e) => actualizarCampo("flagBalanza", e.target.value as FlagBalanza)}>
            <option value="NORMAL">Normal</option>
            <option value="PESABLE">Pesable</option>
            <option value="IMPORTE">Importe</option>
          </select>
        </label>
        {form.flagBalanza === "NORMAL" && (
          <label>
            Código de barras (EAN)
            <input value={form.codigoBarras} onChange={(e) => actualizarCampo("codigoBarras", e.target.value)} />
          </label>
        )}
        {esNuevo && (
          <label>
            Precio inicial
            <input
              type="number"
              min="1"
              value={form.precio}
              onChange={(e) => actualizarCampo("precio", e.target.value)}
              required
            />
          </label>
        )}
        <label>
          Precio de venta al por mayor (opcional)
          <input
            type="number"
            min="1"
            placeholder="ej. 12000"
            value={form.precioMayor}
            onChange={(e) => actualizarCampo("precioMayor", e.target.value)}
          />
          <span className="ayuda">
            Solo de referencia — no reemplaza el precio que se negocia en cada venta por mayor.
          </span>
        </label>
        <label>
          Contenido
          <input value={form.contenido} onChange={(e) => actualizarCampo("contenido", e.target.value)} />
        </label>
        <label>
          Capacidad x caja
          <input value={form.capacidadPorCaja} onChange={(e) => actualizarCampo("capacidadPorCaja", e.target.value)} />
        </label>
        <label>
          Envase
          <input value={form.envase} onChange={(e) => actualizarCampo("envase", e.target.value)} />
        </label>
        <label>
          Impuesto adicional (%)
          <input
            type="number"
            min="0"
            value={form.impuestoAdicional}
            onChange={(e) => actualizarCampo("impuestoAdicional", e.target.value)}
          />
        </label>
        <label>
          Duración
          <input value={form.duracion} onChange={(e) => actualizarCampo("duracion", e.target.value)} />
        </label>
        <label>
          Código proveedor
          <input value={form.codigoProveedor} onChange={(e) => actualizarCampo("codigoProveedor", e.target.value)} />
        </label>
        <label>
          Umbral de stock bajo
          <input
            type="number"
            min="0"
            placeholder="ej. 5 (avisa si quedan 5 o menos)"
            value={form.umbralStockBajo}
            onChange={(e) => actualizarCampo("umbralStockBajo", e.target.value)}
          />
        </label>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  calcularMargen,
  formatoCLP,
  FAMILIAS_CAMARA,
  type Categoria,
  type FlagBalanza,
  type Producto,
  type ProductoConCosto,
} from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

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
  aplicaIvaCarne: boolean;
  costoReferencia: string;
  familiaCorte: string;
  descripcionCorta: string;
  promoPrecioUnitario: string;
  promoGramosMinimos: string;
  promoEtiqueta: string;
  pesoPromedioTrozoGramos: string;
  opcionesUnidad: string;
  esCombo: boolean;
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
  aplicaIvaCarne: false,
  costoReferencia: "",
  familiaCorte: "",
  descripcionCorta: "",
  promoPrecioUnitario: "",
  promoGramosMinimos: "",
  promoEtiqueta: "",
  pesoPromedioTrozoGramos: "",
  opcionesUnidad: "",
  esCombo: false,
};

function etiquetaCantidadProducto(producto: Producto): string {
  return producto.flagBalanza === "NORMAL" ? "unidades" : "kg";
}

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
          aplicaIvaCarne: p.aplicaIvaCarne,
          costoReferencia: p.costoReferencia != null ? String(p.costoReferencia) : "",
          familiaCorte: p.familiaCorte ?? "",
          descripcionCorta: p.descripcionCorta ?? "",
          promoPrecioUnitario: p.promoPrecioUnitario != null ? String(p.promoPrecioUnitario) : "",
          promoGramosMinimos: p.promoGramosMinimos != null ? String(p.promoGramosMinimos) : "",
          promoEtiqueta: p.promoEtiqueta ?? "",
          pesoPromedioTrozoGramos: p.pesoPromedioTrozoGramos != null ? String(p.pesoPromedioTrozoGramos) : "",
          opcionesUnidad: p.opcionesUnidad ?? "",
          esCombo: p.esCombo,
        });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  function actualizarCampo<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function marcarEsCombo(activo: boolean) {
    // Un combo siempre se cotiza como unidad (1 combo = 1 unidad) — nunca
    // pesable, así que fuerza Flag balanza al marcarlo.
    setForm((f) => ({ ...f, esCombo: activo, flagBalanza: activo ? "NORMAL" : f.flagBalanza }));
  }

  // --- Componentes del combo (búsqueda + agregar/quitar) ---
  // Un combo nuevo arma su lista de componentes en memoria (componentesNuevo)
  // ANTES de guardar — ya no hace falta guardar el producto primero para
  // recién ahí poder agregarlos. Al guardar, se crea el producto y se
  // agregan los componentes en cadena. Un combo ya guardado sigue agregando
  // y quitando componentes en vivo contra el backend, como antes.
  const [componenteBusqueda, setComponenteBusqueda] = useState("");
  const [componenteResultados, setComponenteResultados] = useState<Producto[]>([]);
  const [componenteSeleccionado, setComponenteSeleccionado] = useState<Producto | null>(null);
  const [componenteCantidad, setComponenteCantidad] = useState("");
  const [guardandoComponente, setGuardandoComponente] = useState(false);
  const [componentesNuevo, setComponentesNuevo] = useState<{ producto: Producto; cantidad: number }[]>([]);

  const idsYaAgregados = esNuevo
    ? componentesNuevo.map((c) => c.producto.id)
    : (productoActual?.componentesDelCombo ?? []).map((c) => c.componenteProductoId);

  useEffect(() => {
    if (!componenteBusqueda.trim() || componenteSeleccionado) {
      setComponenteResultados([]);
      return;
    }
    api.productos
      .listar({ buscar: componenteBusqueda })
      .then((r) =>
        setComponenteResultados(
          r.filter((p) => !p.esCombo && p.id !== productoActual?.id && !idsYaAgregados.includes(p.id)).slice(0, 8)
        )
      )
      .catch(() => setComponenteResultados([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [componenteBusqueda, componenteSeleccionado, productoActual?.id]);

  async function agregarComponente() {
    if (!componenteSeleccionado) return;
    const cantidad = Number(componenteCantidad);
    if (!componenteCantidad.trim() || Number.isNaN(cantidad) || cantidad <= 0) {
      setError("La cantidad del componente no es válida");
      return;
    }

    if (esNuevo) {
      setComponentesNuevo((arr) => [...arr, { producto: componenteSeleccionado, cantidad }]);
      setComponenteBusqueda("");
      setComponenteSeleccionado(null);
      setComponenteCantidad("");
      return;
    }

    if (!productoActual) return;
    setGuardandoComponente(true);
    try {
      const actualizado = await api.productos.agregarComponenteCombo(productoActual.id, componenteSeleccionado.id, cantidad);
      setProductoActual(actualizado);
      actualizarCampo("descripcionCorta", actualizado.descripcionCorta ?? "");
      mostrarToast("Componente agregado", `${componenteSeleccionado.descripcion} se agregó a la receta.`);
      setComponenteBusqueda("");
      setComponenteSeleccionado(null);
      setComponenteCantidad("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoComponente(false);
    }
  }

  function quitarComponenteNuevo(indice: number) {
    setComponentesNuevo((arr) => arr.filter((_, i) => i !== indice));
  }

  async function quitarComponente(componenteId: number, descripcion: string) {
    if (!productoActual) return;
    try {
      const actualizado = await api.productos.quitarComponenteCombo(productoActual.id, componenteId);
      setProductoActual(actualizado);
      actualizarCampo("descripcionCorta", actualizado.descripcionCorta ?? "");
      mostrarToast("Componente quitado", `${descripcion} se quitó de la receta.`, "eliminado");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Lista unificada para mostrar (en memoria si es nuevo, del backend si ya
  // existe) y el valor de referencia sumando lo que cuesta cada componente
  // por separado, para comparar contra el precio del combo mientras se arma.
  const listaComponentes = esNuevo
    ? componentesNuevo.map((c, i) => ({
        key: `nuevo-${i}`,
        cantidad: c.cantidad,
        producto: c.producto,
        quitar: () => quitarComponenteNuevo(i),
      }))
    : (productoActual?.componentesDelCombo ?? []).map((c) => ({
        key: String(c.id),
        cantidad: c.cantidad,
        producto: c.componenteProducto,
        quitar: () => quitarComponente(c.id, c.componenteProducto.descripcion),
      }));
  const subtotalComponentes = listaComponentes.reduce((acc, c) => acc + c.cantidad * c.producto.precio, 0);
  const precioComboActual = esNuevo ? Number(form.precio) || null : productoActual?.precio ?? null;
  const ahorroCombo =
    precioComboActual != null && subtotalComponentes > 0 ? subtotalComponentes - precioComboActual : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);

    if (!form.categoriaId) {
      setError("Falta elegir una categoría");
      return;
    }

    const promoCompleta = form.promoPrecioUnitario && form.promoGramosMinimos && form.promoEtiqueta.trim();
    const promoVacia = !form.promoPrecioUnitario && !form.promoGramosMinimos && !form.promoEtiqueta.trim();
    if (!promoCompleta && !promoVacia) {
      setError("La promoción por volumen necesita los tres datos (precio, cantidad mínima y etiqueta), o ninguno");
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
      aplicaIvaCarne: form.aplicaIvaCarne,
      costoReferencia: form.costoReferencia ? Number(form.costoReferencia) : null,
      familiaCorte: form.familiaCorte || null,
      descripcionCorta: form.descripcionCorta.trim() || null,
      promoPrecioUnitario: form.promoPrecioUnitario ? Number(form.promoPrecioUnitario) : null,
      promoGramosMinimos: form.promoGramosMinimos ? Number(form.promoGramosMinimos) : null,
      promoEtiqueta: form.promoEtiqueta.trim() || null,
      pesoPromedioTrozoGramos: form.pesoPromedioTrozoGramos ? Number(form.pesoPromedioTrozoGramos) : null,
      opcionesUnidad: form.opcionesUnidad.trim() || null,
      esCombo: form.esCombo,
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
        if (form.esCombo && componentesNuevo.length > 0) {
          try {
            for (const c of componentesNuevo) {
              await api.productos.agregarComponenteCombo(creado.id, c.producto.id, c.cantidad);
            }
          } catch (e) {
            mostrarToast(
              "Combo creado con problemas",
              `El combo se creó, pero no se pudieron agregar todos los componentes: ${(e as Error).message}. Termina de agregarlos abajo.`,
              "eliminado"
            );
          }
        }
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

  const margenActual = productoActual ? calcularMargen(productoActual.precio, productoActual.costoEfectivo) : null;
  const margenNuevo =
    productoActual && precioNuevo && Number(precioNuevo) > 0
      ? calcularMargen(Number(precioNuevo), productoActual.costoEfectivo)
      : null;

  return (
    <div>
      <h1>{esNuevo ? "Nuevo producto" : `Editar producto: ${productoActual?.descripcion ?? ""}`}</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      {!esNuevo && productoActual && (
        <div className="tarjeta cambio-precio">
          <h2>Precio actual: {formatoCLP(productoActual.precio)}</h2>
          {productoActual.costoEfectivo == null ? (
            <p className="ayuda">
              Sin costo registrado — registra una entrada de compra para este producto en Inventario, o escribe un
              costo de referencia más abajo, para ver el margen (%).
            </p>
          ) : (
            <div>
              <p className="ayuda">
                Costo: {formatoCLP(productoActual.costoEfectivo)}
                {productoActual.costoEsEstimado && " (estimado — sin ninguna compra real registrada todavía)"}
              </p>
              <div className="fila-inline">
                <span className={`margen-destacado ${margenActual! < 0 ? "margen-negativo" : ""}`}>
                  <span className="margen-etiqueta">Margen actual</span> {margenActual?.toFixed(2)}%
                </span>
                {margenNuevo != null && (
                  <>
                    →
                    <span className={`margen-destacado ${margenNuevo < 0 ? "margen-negativo" : ""}`}>
                      <span className="margen-etiqueta">Con el precio nuevo</span> {margenNuevo.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            </div>
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
        <label className="fila-inline">
          <input type="checkbox" checked={form.esCombo} onChange={(e) => marcarEsCombo(e.target.checked)} />
          Es un combo (junta varios productos en uno, solo se vende por la web)
        </label>
        {form.esCombo && (
          <p className="ayuda">
            Se cotiza como unidad, sin código de barras propio — arma los componentes abajo y el precio de venta más
            arriba.
          </p>
        )}

        {form.esCombo && (
          <fieldset className="tarjeta formulario">
            <legend>Componentes del combo</legend>
            <p className="ayuda">
              Qué productos reales trae este combo, y cuánto de cada uno.
              {esNuevo && " Se agregan al guardar, junto con el resto del producto — no hace falta guardar antes."}
            </p>

            {listaComponentes.length > 0 && (
              <ul className="lista-resultados">
                {listaComponentes.map((c) => (
                  <li key={c.key} className="fila-inline">
                    <span>
                      {c.cantidad} {etiquetaCantidadProducto(c.producto)} — {c.producto.descripcion} (
                      {formatoCLP(c.producto.precio)} c/u)
                    </span>
                    <button type="button" onClick={c.quitar}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {listaComponentes.length > 0 && (
              <p className="ayuda">
                Suma de los componentes por separado: <strong>{formatoCLP(subtotalComponentes)}</strong>
                {ahorroCombo != null && precioComboActual != null && (
                  <>
                    {" — "}
                    {ahorroCombo > 0 ? (
                      <span className="exito">
                        el combo ahorra {formatoCLP(ahorroCombo)} ({((ahorroCombo / subtotalComponentes) * 100).toFixed(1)}%)
                        frente a comprarlos por separado.
                      </span>
                    ) : ahorroCombo < 0 ? (
                      <span className="error">
                        el combo sale {formatoCLP(-ahorroCombo)} más caro que comprar los componentes por separado.
                      </span>
                    ) : (
                      "el combo cuesta lo mismo que los componentes por separado."
                    )}
                  </>
                )}
              </p>
            )}

            <div className="formulario">
              {!componenteSeleccionado && (
                <label>
                  Buscar producto para agregar
                  <input
                    type="text"
                    value={componenteBusqueda}
                    onChange={(e) => setComponenteBusqueda(e.target.value)}
                    placeholder="Ej: asado carnicero"
                  />
                </label>
              )}
              {!componenteSeleccionado && componenteResultados.length > 0 && (
                <ul className="lista-resultados">
                  {componenteResultados.map((prod) => (
                    <li key={prod.id}>
                      <button type="button" onClick={() => setComponenteSeleccionado(prod)}>
                        {prod.descripcion} {prod.marca ? `— ${prod.marca}` : ""} ({formatoCLP(prod.precio)})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {componenteSeleccionado && (
                <>
                  <p>
                    <strong>Producto:</strong> {componenteSeleccionado.descripcion}{" "}
                    <button type="button" onClick={() => setComponenteSeleccionado(null)}>
                      Cambiar
                    </button>
                  </p>
                  <label>
                    Cantidad ({etiquetaCantidadProducto(componenteSeleccionado)})
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={componenteCantidad}
                      onChange={(e) => setComponenteCantidad(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          agregarComponente();
                        }
                      }}
                      autoFocus
                    />
                  </label>
                  <div className="acciones-formulario">
                    <button
                      type="button"
                      className="boton boton-primario"
                      disabled={guardandoComponente}
                      onClick={agregarComponente}
                    >
                      {guardandoComponente ? "Agregando..." : "Agregar al combo"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </fieldset>
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
        {!form.esCombo && (
          <label>
            Código de barras (EAN)
            <input value={form.codigoBarras} onChange={(e) => actualizarCampo("codigoBarras", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
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
        )}
        {!form.esCombo && (
          <label>
            Contenido
            <input value={form.contenido} onChange={(e) => actualizarCampo("contenido", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
          <label>
            Capacidad x caja
            <input value={form.capacidadPorCaja} onChange={(e) => actualizarCampo("capacidadPorCaja", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
          <label>
            Envase
            <input value={form.envase} onChange={(e) => actualizarCampo("envase", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
          <label>
            Impuesto adicional (%)
            <input
              type="number"
              min="0"
              value={form.impuestoAdicional}
              onChange={(e) => actualizarCampo("impuestoAdicional", e.target.value)}
            />
          </label>
        )}
        {!form.esCombo && (
          <label className="fila-inline">
            <input
              type="checkbox"
              checked={form.aplicaIvaCarne}
              onChange={(e) => actualizarCampo("aplicaIvaCarne", e.target.checked)}
            />
            Aplica IVA carne (5%) — para vacuno/cerdo
          </label>
        )}
        <label>
          Costo de referencia
          <input
            type="number"
            min="0"
            placeholder="ej. 6500 (del sistema anterior, si no hay factura real todavía)"
            value={form.costoReferencia}
            onChange={(e) => actualizarCampo("costoReferencia", e.target.value)}
          />
          <span className="ayuda">
            Solo se usa para calcular el margen mientras no haya ninguna compra real registrada en Inventario o
            Cámara — apenas se registre una, esa manda por sobre este valor.
          </span>
        </label>
        {!form.esCombo && (
          <label>
            Duración
            <input value={form.duracion} onChange={(e) => actualizarCampo("duracion", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
          <label>
            Código proveedor
            <input value={form.codigoProveedor} onChange={(e) => actualizarCampo("codigoProveedor", e.target.value)} />
          </label>
        )}
        {!form.esCombo && (
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
        )}
        {!form.esCombo && (
          <label>
            Familia de corte (página web)
            <select value={form.familiaCorte} onChange={(e) => actualizarCampo("familiaCorte", e.target.value)}>
              <option value="">Sin selector de corte</option>
              {FAMILIAS_CAMARA.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="ayuda">
              Si eliges una familia, en la web este producto muestra las opciones de corte configuradas para esa
              familia (Bifes, Trozo entero, Molida, etc. — ver Comunas → Opciones de corte).
            </span>
          </label>
        )}
        <label>
          Descripción corta (página web)
          <input
            value={form.descripcionCorta}
            onChange={(e) => actualizarCampo("descripcionCorta", e.target.value)}
            placeholder="Frase corta para la tarjeta de producto (opcional)"
            disabled={form.esCombo}
          />
          {form.esCombo && (
            <span className="ayuda">
              Se arma sola a partir de los componentes del combo (arriba) — se actualiza cada vez que agregas o
              quitas uno.
            </span>
          )}
        </label>

        {form.flagBalanza === "NORMAL" && (
          <label>
            Opciones por unidad (página web)
            <input
              value={form.opcionesUnidad}
              onChange={(e) => actualizarCampo("opcionesUnidad", e.target.value)}
              placeholder='Ej: "Entero, Trozado, Para la parrilla" (separadas por coma)'
            />
            <span className="ayuda">
              Si se llena, el cotizador de la web pide elegir una de estas opciones POR CADA unidad pedida, en vez de
              una sola para todo el pedido — pensado para algo como "3 pollos enteros a $24.990": el cliente puede
              pedir 2 enteros y 1 para la parrilla. Déjalo vacío si no aplica.
            </span>
          </label>
        )}

        {!form.esCombo && (
          <fieldset className="tarjeta formulario">
            <legend>Promoción por volumen (página web)</legend>
            {form.flagBalanza === "NORMAL" ? (
              <p className="ayuda">
                Los tres campos van juntos (o se llenan los tres, o se dejan los tres vacíos). Ej. "Empanada de Pino":
                precio 990, unidades mínimas 3, etiqueta "3 unidades a $990 c/u".
              </p>
            ) : (
              <p className="ayuda">
                Los tres campos van juntos (o se llenan los tres, o se dejan los tres vacíos). Ej. "Pechuga Entera":
                precio 3980, gramos mínimos 3000, etiqueta "$3.980/kg al llevar 3 kilos o más".
              </p>
            )}
            <label>
              Precio promocional {form.flagBalanza === "NORMAL" ? "por unidad" : "por kilo"}
              <input
                type="number"
                min="1"
                value={form.promoPrecioUnitario}
                onChange={(e) => actualizarCampo("promoPrecioUnitario", e.target.value)}
              />
            </label>
            <label>
              {form.flagBalanza === "NORMAL" ? "Unidades mínimas para la promoción" : "Gramos mínimos para la promoción"}
              <input
                type="number"
                min="1"
                value={form.promoGramosMinimos}
                onChange={(e) => actualizarCampo("promoGramosMinimos", e.target.value)}
              />
            </label>
            <label>
              Etiqueta de la promoción
              <input
                value={form.promoEtiqueta}
                onChange={(e) => actualizarCampo("promoEtiqueta", e.target.value)}
                placeholder={
                  form.flagBalanza === "NORMAL" ? 'ej. "3 unidades a $990 c/u"' : 'ej. "$3.980/kg al llevar 3 kilos o más"'
                }
              />
            </label>
          </fieldset>
        )}

        {form.flagBalanza !== "NORMAL" && (
          <fieldset className="tarjeta formulario">
            <legend>Venta por trozos (página web)</legend>
            <p className="ayuda">
              Para productos donde la gente suele pedir "tantos trozos" en vez de kilos (ej. pollo/aves). Si lo llenas,
              el cotizador de la web deja elegir por cantidad de trozos, estimando el peso como trozos × este valor —
              sigue siendo un peso aproximado, se ajusta al pesar de verdad. Déjalo vacío si no aplica.
            </p>
            <label>
              Peso promedio por trozo (g)
              <input
                type="number"
                min="1"
                value={form.pesoPromedioTrozoGramos}
                onChange={(e) => actualizarCampo("pesoPromedioTrozoGramos", e.target.value)}
                placeholder="ej. 180 (trutro), 90 (ala)"
              />
            </label>
          </fieldset>
        )}

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  calcularMargen,
  formatoCLP,
  type Categoria,
  type FilaImportacionCosto,
  type FilaImportacionProductos,
  type ProductoConUltimoCosto,
} from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

export default function Productos() {
  const [productos, setProductos] = useState<ProductoConUltimoCosto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [buscar, setBuscar] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [mostrarEliminados, setMostrarEliminados] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [archivoImportar, setArchivoImportar] = useState<File | null>(null);
  const [previewImportar, setPreviewImportar] = useState<FilaImportacionProductos[] | null>(null);
  const [mensajeImportar, setMensajeImportar] = useState<string | null>(null);
  const [errorImportar, setErrorImportar] = useState<string | null>(null);

  // Importar costos (CSV) — a diferencia de "Importar productos (CSV)"
  // arriba, esto actualiza el costo de referencia de productos que YA
  // existen, para poder cargar de una vez los costos del sistema anterior.
  const [mostrarImportarCostos, setMostrarImportarCostos] = useState(false);
  const [archivoImportarCostos, setArchivoImportarCostos] = useState<File | null>(null);
  const [previewImportarCostos, setPreviewImportarCostos] = useState<FilaImportacionCosto[] | null>(null);
  const [mensajeImportarCostos, setMensajeImportarCostos] = useState<string | null>(null);
  const [errorImportarCostos, setErrorImportarCostos] = useState<string | null>(null);

  const [modoCategorizar, setModoCategorizar] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [categoriaDestino, setCategoriaDestino] = useState<number | "">("");
  const [mensajeCategorizar, setMensajeCategorizar] = useState<string | null>(null);

  function recargarProductos() {
    setCargando(true);
    api.productos
      .listarConCosto({ buscar: buscar || undefined, categoriaId: categoriaId || undefined, incluirInactivos: mostrarEliminados })
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  async function alternarWeb(p: ProductoConUltimoCosto, campo: "visibleEnWeb" | "featured" | "lowStock", valor: boolean) {
    // Optimista: se ve el cambio al tiro, y se revierte solo si el servidor lo rechaza —
    // son casillas de uso frecuente, esperar la respuesta antes de marcarlas se siente lento.
    setProductos((actual) => actual.map((x) => (x.id === p.id ? { ...x, [campo]: valor } : x)));
    try {
      await api.productos.actualizarVisibilidadWeb(p.id, { [campo]: valor });
    } catch (e) {
      setProductos((actual) => actual.map((x) => (x.id === p.id ? { ...x, [campo]: !valor } : x)));
      setError((e as Error).message);
    }
  }

  async function cambiarDisponibilidadWeb(
    p: ProductoConUltimoCosto,
    disponibilidadWeb: "disponible" | "agotado" | "proximamente"
  ) {
    const anterior = p.disponibilidadWeb;
    setProductos((actual) => actual.map((x) => (x.id === p.id ? { ...x, disponibilidadWeb } : x)));
    try {
      await api.productos.actualizarVisibilidadWeb(p.id, { disponibilidadWeb });
    } catch (e) {
      setProductos((actual) => actual.map((x) => (x.id === p.id ? { ...x, disponibilidadWeb: anterior } : x)));
      setError((e as Error).message);
    }
  }

  async function reactivar(p: ProductoConUltimoCosto) {
    const confirmado = window.confirm(`¿Reactivar "${p.descripcion}" (PLU ${p.plu})?`);
    if (!confirmado) return;
    try {
      await api.productos.reactivar(p.id);
      recargarProductos();
      mostrarToast("Producto reactivado", `${p.descripcion} volvió a estar disponible.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function previsualizarImportar(e: React.FormEvent) {
    e.preventDefault();
    setErrorImportar(null);
    setMensajeImportar(null);
    if (!archivoImportar) return;
    try {
      const resultado = await api.productos.importarCsv(archivoImportar, false);
      setPreviewImportar(resultado.filas);
    } catch (e) {
      setErrorImportar((e as Error).message);
    }
  }

  async function aplicarImportar() {
    if (!archivoImportar) return;
    const validas = previewImportar?.filter((f) => !f.error).length ?? 0;
    const confirmado = window.confirm(`¿Crear ${validas} productos nuevos del archivo?`);
    if (!confirmado) return;
    try {
      const resultado = await api.productos.importarCsv(archivoImportar, true);
      setMensajeImportar(`Productos creados: ${resultado.creados}`);
      setPreviewImportar(null);
      setArchivoImportar(null);
      recargarProductos();
      mostrarToast("Productos importados", `${resultado.creados} producto(s) creado(s) desde el archivo.`);
    } catch (e) {
      setErrorImportar((e as Error).message);
    }
  }

  async function previsualizarImportarCostos(e: React.FormEvent) {
    e.preventDefault();
    setErrorImportarCostos(null);
    setMensajeImportarCostos(null);
    if (!archivoImportarCostos) return;
    try {
      const resultado = await api.productos.importarCostosCsv(archivoImportarCostos, false);
      setPreviewImportarCostos(resultado.filas);
    } catch (e) {
      setErrorImportarCostos((e as Error).message);
    }
  }

  async function aplicarImportarCostos() {
    if (!archivoImportarCostos) return;
    const validas = previewImportarCostos?.filter((f) => !f.error).length ?? 0;
    const confirmado = window.confirm(`¿Actualizar el costo de referencia de ${validas} producto(s)?`);
    if (!confirmado) return;
    try {
      const resultado = await api.productos.importarCostosCsv(archivoImportarCostos, true);
      setMensajeImportarCostos(`Costos actualizados: ${resultado.actualizados}`);
      setPreviewImportarCostos(null);
      setArchivoImportarCostos(null);
      recargarProductos();
      mostrarToast("Costos importados", `${resultado.actualizados} producto(s) actualizado(s) desde el archivo.`);
    } catch (e) {
      setErrorImportarCostos((e as Error).message);
    }
  }

  function alternarSeleccion(id: number) {
    setSeleccionados((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function alternarSeleccionarTodos() {
    setSeleccionados((actual) => {
      if (productos.every((p) => actual.has(p.id))) return new Set();
      return new Set(productos.map((p) => p.id));
    });
  }

  async function aplicarCategorizarMasivo() {
    if (!categoriaDestino || seleccionados.size === 0) return;
    const categoria = categorias.find((c) => c.id === categoriaDestino);
    const confirmado = window.confirm(
      `¿Asignar la categoría "${categoria?.nombre}" a ${seleccionados.size} producto(s)?`
    );
    if (!confirmado) return;
    try {
      const resultado = await api.productos.categorizarMasivo(Array.from(seleccionados), Number(categoriaDestino));
      setMensajeCategorizar(`Categoría actualizada en ${resultado.actualizados} producto(s)`);
      setSeleccionados(new Set());
      setCategoriaDestino("");
      recargarProductos();
      mostrarToast("Categoría asignada", `${resultado.actualizados} producto(s) quedaron en "${categoria?.nombre}".`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function eliminarSeleccionados() {
    if (seleccionados.size === 0) return;
    const confirmado = window.confirm(
      `¿Eliminar ${seleccionados.size} producto(s)? No se podrán deshacer desde esta pantalla — quedan ocultos del sistema, no se borran sus movimientos ya registrados.`
    );
    if (!confirmado) return;
    try {
      const resultado = await api.productos.eliminarMasivo(Array.from(seleccionados));
      setMensajeCategorizar(`${resultado.eliminados} producto(s) eliminado(s)`);
      setSeleccionados(new Set());
      recargarProductos();
      mostrarToast("Productos eliminados", `${resultado.eliminados} producto(s) quedaron ocultos del catálogo.`, "eliminado");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCargando(true);
    const timeout = setTimeout(() => {
      api.productos
        .listarConCosto({ buscar: buscar || undefined, categoriaId: categoriaId || undefined, incluirInactivos: mostrarEliminados })
        .then(setProductos)
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [buscar, categoriaId, mostrarEliminados]);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Productos</h1>
        <div className="fila-inline">
          <button type="button" onClick={() => setMostrarImportar((v) => !v)}>
            {mostrarImportar ? "Cerrar importar" : "Importar productos (CSV)"}
          </button>
          <button type="button" onClick={() => setMostrarImportarCostos((v) => !v)}>
            {mostrarImportarCostos ? "Cerrar importar costos" : "Importar costos (CSV)"}
          </button>
          <button
            type="button"
            onClick={() => {
              setModoCategorizar((v) => !v);
              setSeleccionados(new Set());
              setMensajeCategorizar(null);
            }}
          >
            {modoCategorizar ? "Cerrar selección" : "Seleccionar varios"}
          </button>
          <Link to="/productos/margenes" className="boton">
            Mejor margen
          </Link>
          <Link to="/productos/nuevo" className="boton boton-primario">
            + Nuevo producto
          </Link>
        </div>
      </div>

      {modoCategorizar && (
        <section className="tarjeta">
          <h2>Seleccionar varios productos</h2>
          <p className="ayuda">
            Marca los productos de la lista de abajo (tip: busca "nulo" o filtra por "Sin categorizar" para
            encontrarlos más rápido) y luego asígnales una categoría o elimínalos, todos de una vez.
          </p>
          {mensajeCategorizar && <p className="exito">{mensajeCategorizar}</p>}
          <div className="fila-inline">
            <span>{seleccionados.size} seleccionado(s)</span>
            <SelectorCategoria categorias={categorias} value={categoriaDestino} onChange={setCategoriaDestino} />
            <button
              type="button"
              className="boton boton-primario"
              disabled={!categoriaDestino || seleccionados.size === 0}
              onClick={aplicarCategorizarMasivo}
            >
              Asignar categoría
            </button>
            <button
              type="button"
              className="boton boton-peligro"
              disabled={seleccionados.size === 0}
              onClick={eliminarSeleccionados}
            >
              Eliminar seleccionados
            </button>
          </div>
        </section>
      )}

      {mostrarImportar && (
        <section className="tarjeta">
          <h2>Importar productos desde CSV</h2>
          <p className="ayuda">
            Crea productos nuevos (no cambia precios de productos que ya existen). Columnas:{" "}
            <code>plu,descripcion,precio,flag_balanza,categoria_codigo</code> — <code>flag_balanza</code> debe ser{" "}
            <code>NORMAL</code>, <code>PESABLE</code> o <code>IMPORTE</code>; <code>categoria_codigo</code> es
            opcional (si se deja vacío, el producto queda en "Sin categorizar" para ordenar después).
          </p>
          {errorImportar && <ModalAlerta mensaje={errorImportar} onCerrar={() => setErrorImportar(null)} />}
          {mensajeImportar && <p className="exito">{mensajeImportar}</p>}
          <form onSubmit={previsualizarImportar} onKeyDown={manejarEnterComoTab} className="fila-inline">
            <input type="file" accept=".csv" onChange={(e) => setArchivoImportar(e.target.files?.[0] ?? null)} />
            <button type="submit" disabled={!archivoImportar}>
              Previsualizar
            </button>
          </form>

          {previewImportar && (
            <>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>PLU</th>
                    <th>Descripción</th>
                    <th>Precio</th>
                    <th>Flag balanza</th>
                    <th>Categoría</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {previewImportar.map((f) => (
                    <tr key={f.fila} className={f.error ? "fila-error" : ""}>
                      <td>{f.fila}</td>
                      <td>{f.plu}</td>
                      <td>{f.descripcion || "—"}</td>
                      <td>{f.precio != null ? formatoCLP(f.precio) : "—"}</td>
                      <td>{f.flagBalanza ?? "—"}</td>
                      <td>{f.categoriaCodigo ?? "Sin categorizar"}</td>
                      <td>{f.error ?? "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewImportar.some((f) => !f.error) && (
                <button type="button" className="boton boton-primario" onClick={aplicarImportar}>
                  Confirmar y crear productos válidos
                </button>
              )}
            </>
          )}
        </section>
      )}

      {mostrarImportarCostos && (
        <section className="tarjeta">
          <h2>Importar costos desde CSV</h2>
          <p className="ayuda">
            Actualiza el costo de referencia de productos que <strong>ya existen</strong> (no crea productos nuevos)
            — pensado para cargar de una vez los costos del sistema anterior en productos de los que todavía no se
            tiene la factura real. Columnas: <code>plu,costo</code>. Este costo solo se usa mientras no haya
            ninguna compra real registrada; apenas la haya, esa manda por sobre este valor.
          </p>
          {errorImportarCostos && <ModalAlerta mensaje={errorImportarCostos} onCerrar={() => setErrorImportarCostos(null)} />}
          {mensajeImportarCostos && <p className="exito">{mensajeImportarCostos}</p>}
          <form onSubmit={previsualizarImportarCostos} onKeyDown={manejarEnterComoTab} className="fila-inline">
            <input type="file" accept=".csv" onChange={(e) => setArchivoImportarCostos(e.target.files?.[0] ?? null)} />
            <button type="submit" disabled={!archivoImportarCostos}>
              Previsualizar
            </button>
          </form>

          {previewImportarCostos && (
            <>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>PLU</th>
                    <th>Producto</th>
                    <th>Costo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {previewImportarCostos.map((f) => (
                    <tr key={f.fila} className={f.error ? "fila-error" : ""}>
                      <td>{f.fila}</td>
                      <td>{f.plu}</td>
                      <td>{f.descripcion ?? "—"}</td>
                      <td>{f.costo != null ? formatoCLP(f.costo) : "—"}</td>
                      <td>{f.error ?? "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewImportarCostos.some((f) => !f.error) && (
                <button type="button" className="boton boton-primario" onClick={aplicarImportarCostos}>
                  Confirmar y actualizar costos válidos
                </button>
              )}
            </>
          )}
        </section>
      )}

      <div className="chips-categoria">
        {categorias
          .filter((c) => c.padreId === null)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip-categoria${categoriaId === c.id ? " activo" : ""}${c.nombre === "Sin categorizar" ? " chip-sin-categoria" : ""}`}
              onClick={() => setCategoriaId((actual) => (actual === c.id ? "" : c.id))}
            >
              {c.nombre}
            </button>
          ))}
      </div>

      <div className="filtros">
        <input
          type="text"
          placeholder="Buscar por PLU, nombre..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <SelectorCategoria
          categorias={categorias}
          value={categoriaId}
          onChange={setCategoriaId}
          etiquetaTodas="Todas las categorías"
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={mostrarEliminados}
            onChange={(e) => setMostrarEliminados(e.target.checked)}
          />
          Mostrar eliminados
        </label>
      </div>

      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            {modoCategorizar && (
              <th>
                <input
                  type="checkbox"
                  checked={productos.length > 0 && productos.every((p) => seleccionados.has(p.id))}
                  onChange={alternarSeleccionarTodos}
                />
              </th>
            )}
            <th>PLU</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Flag balanza</th>
            <th>Costo</th>
            <th>Precio de venta</th>
            <th>Margen (%)</th>
            <th>Oculto en web</th>
            <th>Disponibilidad web</th>
            <th>Destacado</th>
            <th>Pocas unidades</th>
            {mostrarEliminados && <th>Estado</th>}
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => {
            const margen = calcularMargen(p.precio, p.costoEfectivo);
            return (
              <tr key={p.id}>
                {modoCategorizar && (
                  <td>
                    <input type="checkbox" checked={seleccionados.has(p.id)} onChange={() => alternarSeleccion(p.id)} />
                  </td>
                )}
                <td>
                  <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                </td>
                <td>
                  {p.descripcion}
                  {p.esCombo && <span className="ayuda"> (combo)</span>}
                </td>
                <td>{p.categoria.nombre}</td>
                <td>{p.flagBalanza}</td>
                <td>
                  {p.costoEfectivo != null ? formatoCLP(p.costoEfectivo) : "—"}
                  {p.costoEsEstimado && <span className="ayuda"> (estimado)</span>}
                </td>
                <td>{formatoCLP(p.precio)}</td>
                <td>
                  {margen != null ? (
                    <strong className={margen < 0 ? "error" : "exito"}>{margen.toFixed(2)}%</strong>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    title="Ocultar de la página web (el producto sigue disponible en el POS normalmente)"
                    checked={!p.visibleEnWeb}
                    onChange={(e) => alternarWeb(p, "visibleEnWeb", !e.target.checked)}
                  />
                </td>
                <td>
                  <select
                    value={p.disponibilidadWeb}
                    onChange={(e) =>
                      cambiarDisponibilidadWeb(p, e.target.value as "disponible" | "agotado" | "proximamente")
                    }
                  >
                    <option value="disponible">Disponible</option>
                    <option value="agotado">Agotado</option>
                    <option value="proximamente">Próximamente</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    title="Destacado (aparece en el filtro 'Destacados' de la web)"
                    checked={p.featured}
                    onChange={(e) => alternarWeb(p, "featured", e.target.checked)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    title="Pocas unidades (muestra el badge en la web)"
                    checked={p.lowStock}
                    onChange={(e) => alternarWeb(p, "lowStock", e.target.checked)}
                  />
                </td>
                {mostrarEliminados && (
                  <td>
                    {p.activo ? (
                      "—"
                    ) : (
                      <>
                        <span className="error">Eliminado</span>{" "}
                        <button type="button" onClick={() => reactivar(p)}>
                          Reactivar
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {productos.length === 0 && !cargando && (
            <tr>
              <td colSpan={(modoCategorizar ? 12 : 11) + (mostrarEliminados ? 1 : 0)}>
                No hay productos que coincidan con la búsqueda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type Categoria, type FilaImportacionProductos, type Producto } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [buscar, setBuscar] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [archivoImportar, setArchivoImportar] = useState<File | null>(null);
  const [previewImportar, setPreviewImportar] = useState<FilaImportacionProductos[] | null>(null);
  const [mensajeImportar, setMensajeImportar] = useState<string | null>(null);
  const [errorImportar, setErrorImportar] = useState<string | null>(null);

  function recargarProductos() {
    setCargando(true);
    api.productos
      .listar({ buscar: buscar || undefined, categoriaId: categoriaId || undefined })
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
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
    } catch (e) {
      setErrorImportar((e as Error).message);
    }
  }

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCargando(true);
    const timeout = setTimeout(() => {
      api.productos
        .listar({ buscar: buscar || undefined, categoriaId: categoriaId || undefined })
        .then(setProductos)
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [buscar, categoriaId]);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Productos</h1>
        <div className="fila-inline">
          <button type="button" onClick={() => setMostrarImportar((v) => !v)}>
            {mostrarImportar ? "Cerrar importar" : "Importar productos (CSV)"}
          </button>
          <Link to="/productos/nuevo" className="boton boton-primario">
            + Nuevo producto
          </Link>
        </div>
      </div>

      {mostrarImportar && (
        <section className="tarjeta">
          <h2>Importar productos desde CSV</h2>
          <p className="ayuda">
            Crea productos nuevos (no cambia precios de productos que ya existen). Columnas:{" "}
            <code>plu,descripcion,precio,flag_balanza,categoria_codigo</code> — <code>flag_balanza</code> debe ser{" "}
            <code>NORMAL</code>, <code>PESABLE</code> o <code>IMPORTE</code>; <code>categoria_codigo</code> es
            opcional (si se deja vacío, el producto queda en "Sin categorizar" para ordenar después).
          </p>
          {errorImportar && <p className="error">{errorImportar}</p>}
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

      <div className="filtros">
        <input
          type="text"
          placeholder="Buscar por PLU, nombre..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {"— ".repeat(c.nivel - 1)}
              {c.codigo} {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Flag balanza</th>
            <th>Precio</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/productos/${p.id}`}>{p.plu}</Link>
              </td>
              <td>{p.descripcion}</td>
              <td>{p.categoria.nombre}</td>
              <td>{p.flagBalanza}</td>
              <td>{formatoCLP(p.precio)}</td>
            </tr>
          ))}
          {productos.length === 0 && !cargando && (
            <tr>
              <td colSpan={5}>No hay productos que coincidan con la búsqueda.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

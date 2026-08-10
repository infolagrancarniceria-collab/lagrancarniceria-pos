import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type Categoria, type Producto } from "../api";

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [buscar, setBuscar] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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
        <Link to="/productos/nuevo" className="boton boton-primario">
          + Nuevo producto
        </Link>
      </div>

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

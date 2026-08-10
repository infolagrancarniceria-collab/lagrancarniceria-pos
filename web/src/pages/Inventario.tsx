import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ProductoConStock } from "../api";

export default function Inventario() {
  const [productos, setProductos] = useState<ProductoConStock[]>([]);
  const [soloBajoStock, setSoloBajoStock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    setCargando(true);
    api.inventario
      .stock(soloBajoStock)
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [soloBajoStock]);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Inventario</h1>
        <div className="fila-inline" style={{ marginBottom: 0 }}>
          <Link to="/inventario/entrada" className="boton boton-primario">
            + Registrar entrada
          </Link>
          <Link to="/inventario/salida" className="boton">
            Registrar salida / merma
          </Link>
          <Link to="/inventario/movimientos" className="boton">
            Historial
          </Link>
          <Link to="/proveedores" className="boton">
            Proveedores
          </Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <input type="checkbox" checked={soloBajoStock} onChange={(e) => setSoloBajoStock(e.target.checked)} />
        Mostrar solo productos con stock bajo
      </label>

      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Stock actual</th>
            <th>Umbral stock bajo</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id} className={p.bajoStock ? "fila-error" : ""}>
              <td>
                <Link to={`/productos/${p.id}`}>{p.plu}</Link>
              </td>
              <td>{p.descripcion}</td>
              <td>{p.categoria.nombre}</td>
              <td>{p.stockActual}</td>
              <td>{p.umbralStockBajo ?? "—"}</td>
            </tr>
          ))}
          {productos.length === 0 && !cargando && (
            <tr>
              <td colSpan={5}>
                {soloBajoStock ? "No hay productos con stock bajo." : "No hay productos registrados."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

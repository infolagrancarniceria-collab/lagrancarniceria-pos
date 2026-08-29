import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Categoria, type ProductoConStock } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import { useFiltroUrl } from "../hooks/useFiltroUrl";
import ModalAlerta from "../components/ModalAlerta";

export default function Inventario() {
  const [productos, setProductos] = useState<ProductoConStock[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // En la URL, no en useState suelto — así "← Volver" recupera el mismo
  // filtro al regresar (ver hooks/useFiltroUrl.ts). "bajo=true" además
  // sigue siendo el link que ya usa el aviso de "stock bajo" en Avisos.tsx.
  const [soloBajoStockStr, setSoloBajoStockStr] = useFiltroUrl("bajo");
  const soloBajoStock = soloBajoStockStr === "true";
  const setSoloBajoStock = (v: boolean) => setSoloBajoStockStr(v ? "true" : "");
  const [categoriaIdStr, setCategoriaIdStr] = useFiltroUrl("categoria");
  const categoriaId: number | "" = categoriaIdStr ? Number(categoriaIdStr) : "";
  const setCategoriaId = (id: number | "") => setCategoriaIdStr(id === "" ? "" : String(id));
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCargando(true);
    api.inventario
      .stock(soloBajoStock, categoriaId || undefined)
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [soloBajoStock, categoriaId]);

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
          <Link to="/inventario/factura" className="boton">
            + Cargar factura
          </Link>
          <Link to="/inventario/facturas" className="boton">
            Facturas
          </Link>
          <Link to="/inventario/movimientos" className="boton">
            Historial
          </Link>
          <Link to="/inventario/revisiones" className="boton">
            Revisiones
          </Link>
          <Link to="/proveedores" className="boton">
            Proveedores
          </Link>
        </div>
      </div>

      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <SelectorCategoria
          categorias={categorias}
          value={categoriaId}
          onChange={setCategoriaId}
          etiquetaTodas="Todas las categorías"
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={soloBajoStock} onChange={(e) => setSoloBajoStock(e.target.checked)} />
          Mostrar solo productos con stock bajo
        </label>
      </div>

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

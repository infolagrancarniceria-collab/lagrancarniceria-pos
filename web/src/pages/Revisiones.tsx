import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Producto } from "../api";

// Lista los productos que quedaron con stock negativo — sucede cuando se
// vende un producto sin que el sistema tuviera stock suficiente registrado
// (ver "Vender sin stock disponible" en Punto de Venta). Es una lista de
// pendientes: apenas alguien corrige el stock con un ajuste, el producto
// deja de aparecer acá solo.
export default function Revisiones() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  function cargar() {
    setCargando(true);
    api.productos
      .listar({ stockNegativo: true })
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Revisiones</h1>
        <Link to="/inventario">Volver a Inventario</Link>
      </div>
      <p className="ayuda">
        Productos que quedaron con stock negativo (se vendieron sin que el sistema tuviera stock suficiente
        registrado). Corrige cada uno con un ajuste en su ficha — desaparecen de esta lista solos apenas el
        stock vuelve a estar en 0 o más.
      </p>
      {error && <p className="error">{error}</p>}
      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Stock actual</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id} className="fila-error">
              <td>
                <Link to={`/productos/${p.id}`}>{p.plu}</Link>
              </td>
              <td>{p.descripcion}</td>
              <td>{p.categoria.nombre}</td>
              <td>{p.stockActual}</td>
            </tr>
          ))}
          {productos.length === 0 && !cargando && <tr><td colSpan={4}>No hay productos con stock negativo.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

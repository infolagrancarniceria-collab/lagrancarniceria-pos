import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type Producto } from "../api";
import ModalAlerta from "../components/ModalAlerta";

type Pestana = "stock_negativo" | "creados_rapido";

// Lista productos pendientes de revisar, en dos pestañas:
// - Stock negativo: se vendieron sin que el sistema tuviera stock
//   suficiente registrado (ver "Vender sin stock disponible" en Punto de
//   Venta) — se corrige con un ajuste en la ficha del producto.
// - Creados rápido: se crearon al vuelo desde Caja al escanear un código
//   que no calzaba con ningún producto (ver crearProductoRapido en
//   PuntoDeVenta.tsx), con solo los datos mínimos para poder cobrar en el
//   momento — hay que completarlos (PLU real, marca, etc.) en su ficha.
// Ambas listas se vacían solas: la primera apenas el stock vuelve a 0 o
// más, la segunda apenas alguien edita y guarda el producto (ver PUT
// /api/productos/:id, que limpia creadoRapido en cualquier guardado).
export default function Revisiones() {
  const [pestana, setPestana] = useState<Pestana>("stock_negativo");
  const [productosStockNegativo, setProductosStockNegativo] = useState<Producto[]>([]);
  const [productosCreadosRapido, setProductosCreadosRapido] = useState<Producto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  function cargar() {
    setCargando(true);
    Promise.all([
      api.productos.listar({ stockNegativo: true }),
      api.productos.listar({ creadoRapido: true, incluirInactivos: true }),
    ])
      .then(([stockNegativo, creadosRapido]) => {
        setProductosStockNegativo(stockNegativo);
        setProductosCreadosRapido(creadosRapido);
      })
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
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="chips-categoria">
        <button
          type="button"
          className={`chip-categoria${pestana === "stock_negativo" ? " activo" : ""}`}
          onClick={() => setPestana("stock_negativo")}
        >
          Stock negativo ({productosStockNegativo.length})
        </button>
        <button
          type="button"
          className={`chip-categoria${pestana === "creados_rapido" ? " activo" : ""}`}
          onClick={() => setPestana("creados_rapido")}
        >
          Creados rápido en Caja ({productosCreadosRapido.length})
        </button>
      </div>

      {cargando && <p>Cargando...</p>}

      {pestana === "stock_negativo" && (
        <>
          <p className="ayuda">
            Productos que quedaron con stock negativo (se vendieron sin que el sistema tuviera stock suficiente
            registrado). Corrige cada uno con un ajuste en su ficha — desaparecen de esta lista solos apenas el
            stock vuelve a estar en 0 o más.
          </p>
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
              {productosStockNegativo.map((p) => (
                <tr key={p.id} className="fila-error">
                  <td>
                    <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                  </td>
                  <td>{p.descripcion}</td>
                  <td>{p.categoria.nombre}</td>
                  <td>{p.stockActual}</td>
                </tr>
              ))}
              {productosStockNegativo.length === 0 && !cargando && (
                <tr>
                  <td colSpan={4}>No hay productos con stock negativo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {pestana === "creados_rapido" && (
        <>
          <p className="ayuda">
            Productos creados al vuelo desde Caja al escanear un código que no calzaba con ninguno del catálogo —
            quedaron con lo mínimo (descripción, precio, categoría) para poder cobrar en el momento. Complétalos en
            su ficha (PLU real, marca, código de barras si corresponde, etc.) — al guardar salen solos de esta lista.
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Código escaneado</th>
              </tr>
            </thead>
            <tbody>
              {productosCreadosRapido.map((p) => (
                <tr key={p.id} className="fila-error">
                  <td>
                    <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                  </td>
                  <td>{p.descripcion}</td>
                  <td>{p.categoria.nombre}</td>
                  <td>{formatoCLP(p.precio)}</td>
                  <td>{p.codigoBarras ?? "—"}</td>
                </tr>
              ))}
              {productosCreadosRapido.length === 0 && !cargando && (
                <tr>
                  <td colSpan={5}>No hay productos pendientes de completar.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

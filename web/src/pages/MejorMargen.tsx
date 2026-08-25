import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, calcularMargen, formatoCLP, type Categoria, type ProductoConCosto } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import ModalAlerta from "../components/ModalAlerta";

interface FilaMargen extends ProductoConCosto {
  margen: number;
}

// Pantalla para encontrar rápido qué productos convienen más para armar
// combos: ordena por margen (%) de mayor a menor, usando la misma fórmula
// ya usada en la ficha de producto (calcularMargen) — markup sobre el
// costo de la última compra, con el precio de venta sin IVA. Solo se
// muestran productos con costo conocido (al menos una compra registrada);
// los que no lo tienen quedan afuera, con un aviso de cuántos son, en vez
// de mostrar un margen inventado.
export default function MejorMargen() {
  const [productos, setProductos] = useState<ProductoConCosto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [margenMinimo, setMargenMinimo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCargando(true);
    api.productos
      .margenes({ categoriaId: categoriaId || undefined })
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [categoriaId]);

  const filas: FilaMargen[] = productos
    .map((p) => ({ ...p, margen: calcularMargen(p.precio, p.ultimoCosto) ?? 0 }))
    .filter((p) => !margenMinimo || p.margen >= Number(margenMinimo))
    .sort((a, b) => b.margen - a.margen);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Mejor margen</h1>
      </div>
      <p className="ayuda">
        Productos ordenados de mayor a menor margen (%) — para encontrar rápido qué conviene combinar en una
        promoción. Solo se muestran productos con al menos una compra registrada en Inventario (para saber su
        costo real); los que no tienen ninguna quedan fuera de esta lista.
      </p>

      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <SelectorCategoria
          categorias={categorias}
          value={categoriaId}
          onChange={setCategoriaId}
          etiquetaTodas="Todas las categorías"
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          Margen mínimo (%)
          <input
            type="number"
            step="1"
            className="input-chico"
            placeholder="ej. 40"
            value={margenMinimo}
            onChange={(e) => setMargenMinimo(e.target.value)}
          />
        </label>
      </div>

      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Descripción</th>
            <th>Categoría</th>
            <th>Último costo</th>
            <th>Precio de venta</th>
            <th>Margen (%)</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/productos/${p.id}`}>{p.plu}</Link>
              </td>
              <td>{p.descripcion}</td>
              <td>{p.categoria.nombre}</td>
              <td>{formatoCLP(p.ultimoCosto ?? 0)}</td>
              <td>{formatoCLP(p.precio)}</td>
              <td>
                <strong className={p.margen < 0 ? "error" : "exito"}>{p.margen.toFixed(2)}%</strong>
              </td>
            </tr>
          ))}
          {filas.length === 0 && !cargando && (
            <tr>
              <td colSpan={6}>No hay productos con costo conocido que cumplan el filtro.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

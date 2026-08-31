import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, calcularMargen, calcularMargenReal, formatoCLP, type Categoria, type ProductoConCosto } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import ModalAlerta from "../components/ModalAlerta";

interface FilaMargen extends ProductoConCosto {
  recargo: number;
  margenReal: number;
}

// Pantalla para encontrar rápido qué productos convienen más para armar
// combos: ordena por margen (%) de mayor a menor, usando la misma fórmula
// ya usada en la ficha de producto (calcularMargen) — markup sobre el
// costo efectivo (la última compra real si existe, o el costo de
// referencia ingresado a mano como respaldo — ver costoEfectivo), con el
// precio de venta sin IVA. Solo se muestran productos con costo conocido;
// los que no lo tienen quedan afuera, con un aviso de cuántos son, en vez
// de mostrar un margen inventado.
export default function MejorMargen() {
  const [productos, setProductos] = useState<ProductoConCosto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [margenMinimo, setMargenMinimo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Generador rápido de propuestas de combo: filtra por margen real mínimo
  // (el mismo "margen real" de Control de precios — sobre la venta neta,
  // no sobre el costo) y muestra la lista completa que cumple, ordenada de
  // mayor a menor, resaltando los primeros N (el tamaño de combo elegido)
  // como sugerencia — quien arma el combo elige a mano de esa lista, esto
  // solo acelera encontrar candidatos.
  const [umbralPropuesta, setUmbralPropuesta] = useState("60");
  const [tamanoPropuesta, setTamanoPropuesta] = useState("4");
  const [propuestaGenerada, setPropuestaGenerada] = useState(false);

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

  const filasBase: FilaMargen[] = productos.map((p) => ({
    ...p,
    recargo: calcularMargen(p.precio, p.costoEfectivo) ?? 0,
    margenReal: calcularMargenReal(p.precio, p.costoEfectivo) ?? 0,
  }));

  const filas = filasBase
    .filter((p) => !margenMinimo || p.recargo >= Number(margenMinimo))
    .sort((a, b) => b.recargo - a.recargo);

  const umbralPropuestaNum = Number(umbralPropuesta) || 0;
  const tamanoPropuestaNum = Math.max(1, Number(tamanoPropuesta) || 0);
  const productosPropuesta = filasBase
    .filter((p) => p.costoEfectivo != null && p.margenReal >= umbralPropuestaNum)
    .sort((a, b) => b.margenReal - a.margenReal);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Mejor margen</h1>
        <Link to="/productos/control-precios" className="boton">
          📈 Ver Control de precios
        </Link>
      </div>
      <p className="ayuda">
        Productos ordenados de mayor a menor recargo (%) — para encontrar rápido qué conviene combinar en una
        promoción. Se muestran también el margen real (el mismo cálculo de Control de precios, sobre la venta neta
        en vez del costo) lado a lado. Solo se muestran productos con costo conocido (una compra real registrada, o
        un costo de referencia ingresado a mano como respaldo — marcado "(estimado)"); los que no tienen ninguno de
        los dos quedan fuera de esta lista.
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
          Recargo mínimo (%)
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
            <th>Costo</th>
            <th>Precio de venta</th>
            <th>Recargo (%)</th>
            <th>Margen real (%)</th>
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
              <td>
                {formatoCLP(p.costoEfectivo ?? 0)}
                {p.costoEsEstimado && <span className="ayuda"> (estimado)</span>}
              </td>
              <td>{formatoCLP(p.precio)}</td>
              <td>
                <strong className={p.recargo < 0 ? "error" : "exito"}>{p.recargo.toFixed(2)}%</strong>
              </td>
              <td>
                <strong className={p.margenReal < 0 ? "error" : "exito"}>{p.margenReal.toFixed(2)}%</strong>
              </td>
            </tr>
          ))}
          {filas.length === 0 && !cargando && (
            <tr>
              <td colSpan={7}>No hay productos con costo conocido que cumplan el filtro.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="encabezado-pantalla" style={{ marginTop: "2rem" }}>
        <h2>Generador de propuestas de combo</h2>
      </div>
      <p className="ayuda">
        Elige un margen real mínimo y un tamaño de combo de referencia — se muestra la lista completa de productos
        que cumplen el umbral (dentro de la categoría filtrada arriba, si hay alguna elegida), ordenada de mayor a
        menor margen real, con los primeros según el tamaño elegido resaltados como sugerencia. El combo se arma a
        mano eligiendo de esa lista.
      </p>
      <div className="filtros">
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          Margen real mínimo (%)
          <input
            type="number"
            step="1"
            className="input-chico"
            value={umbralPropuesta}
            onChange={(e) => {
              setUmbralPropuesta(e.target.value);
              setPropuestaGenerada(false);
            }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          Tamaño de combo
          <input
            type="number"
            step="1"
            min="1"
            className="input-chico"
            value={tamanoPropuesta}
            onChange={(e) => {
              setTamanoPropuesta(e.target.value);
              setPropuestaGenerada(false);
            }}
          />
        </label>
        <button type="button" className="boton boton-primario" onClick={() => setPropuestaGenerada(true)}>
          Generar propuesta
        </button>
      </div>

      {propuestaGenerada && (
        <>
          <p>
            <strong>{productosPropuesta.length}</strong> producto{productosPropuesta.length === 1 ? "" : "s"} cumplen
            un margen real de {umbralPropuestaNum}% o más — los primeros {tamanoPropuestaNum} están resaltados.
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>PLU</th>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Precio de venta</th>
                <th>Margen real (%)</th>
              </tr>
            </thead>
            <tbody>
              {productosPropuesta.map((p, i) => (
                <tr key={p.id} className={i < tamanoPropuestaNum ? "fila-exito" : ""}>
                  <td>
                    <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                  </td>
                  <td>{p.descripcion}</td>
                  <td>{p.categoria.nombre}</td>
                  <td>{formatoCLP(p.precio)}</td>
                  <td>
                    <strong className="exito">{p.margenReal.toFixed(2)}%</strong>
                  </td>
                </tr>
              ))}
              {productosPropuesta.length === 0 && (
                <tr>
                  <td colSpan={5}>Ningún producto llega a ese margen real.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

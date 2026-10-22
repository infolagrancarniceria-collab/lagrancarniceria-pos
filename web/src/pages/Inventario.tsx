import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Categoria, type ProductoConStock } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import ModalAlerta from "../components/ModalAlerta";

// Agrupa por categoría RAÍZ (nivel 1 — ej. Vacuno/Cerdo/Pollo/Abarrotes), no
// la subcategoría directa del producto, que puede ser de nivel 2/3 y daría
// demasiados grupos para revisar de un vistazo — mismo criterio que ya usa
// el reporte de Ventas (ver categoriaRaizNombre en reportes.ts).
function construirResolverRaiz(categorias: Categoria[]): (categoriaId: number) => string {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const cache = new Map<number, string>();
  return (categoriaId: number) => {
    const cacheada = cache.get(categoriaId);
    if (cacheada) return cacheada;
    let actual = porId.get(categoriaId);
    while (actual?.padreId != null) {
      actual = porId.get(actual.padreId);
    }
    const nombre = actual?.nombre ?? "Sin categoría";
    cache.set(categoriaId, nombre);
    return nombre;
  };
}

// Pantalla rediseñada a pedido del usuario — antes era una sola lista plana
// sin forma de ubicar un producto rápido ni de ver de un vistazo cuánto hay
// por rubro. Pensada en particular para apoyar una revisión física de las
// cámaras de frío: agrupar por familia/categoría y poder buscar por nombre
// o PLU hace mucho más rápido ir comparando el sistema contra lo que hay
// realmente en el mesón y en cámara.
export default function Inventario() {
  const [productos, setProductos] = useState<ProductoConStock[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // Pre-marcado si se llega desde el aviso de "stock bajo" (ver
  // web/src/pages/Avisos.tsx, enlaza a "/inventario?bajo=true").
  const [soloBajoStock, setSoloBajoStock] = useState(
    () => new URLSearchParams(window.location.search).get("bajo") === "true"
  );
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setCargando(true);
    const timeout = setTimeout(() => {
      api.inventario
        .stock(soloBajoStock, categoriaId || undefined, buscar.trim() || undefined)
        .then(setProductos)
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [soloBajoStock, categoriaId, buscar]);

  const resolverRaiz = useMemo(() => construirResolverRaiz(categorias), [categorias]);

  const grupos = useMemo(() => {
    const porRaiz = new Map<string, ProductoConStock[]>();
    for (const p of productos) {
      const raiz = resolverRaiz(p.categoriaId);
      const actual = porRaiz.get(raiz) ?? [];
      actual.push(p);
      porRaiz.set(raiz, actual);
    }
    return Array.from(porRaiz.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [productos, resolverRaiz]);

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
          <Link to="/camara/existencias" className="boton">
            Existencias de cámara
          </Link>
        </div>
      </div>

      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <input
          type="text"
          placeholder="Buscar por PLU o nombre..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          style={{ minWidth: "220px" }}
        />
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
      <p className="ayuda">
        Para revisar las cámaras de frío contra lo que hay físicamente, usa{" "}
        <Link to="/camara/existencias">Existencias de cámara</Link> (agrupado por familia) — si una caja lleva mucho
        sin salida, ahí mismo avisa para no dejarla sin revisar. Esta pantalla es el stock que se vende en el mesón
        (Producto.stockActual), no el de cámara.
      </p>

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
          {grupos.length === 0 && !cargando && (
            <tr>
              <td colSpan={5}>
                {soloBajoStock ? "No hay productos con stock bajo." : "No se encontraron productos."}
              </td>
            </tr>
          )}
          {grupos.map(([raiz, filas]) => (
            <Fragment key={raiz}>
              <tr className="fila-total">
                <td colSpan={5}>
                  {raiz} ({filas.length})
                </td>
              </tr>
              {filas.map((p) => (
                <tr key={p.id} className={p.bajoStock ? "fila-error" : ""}>
                  <td>
                    <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                  </td>
                  <td>{p.descripcion}</td>
                  <td>{p.categoria.nombre}</td>
                  <td>
                    {p.stockActual} {p.flagBalanza === "PESABLE" ? "kg" : "un"}
                    {p.bajoStock && " (stock bajo)"}
                  </td>
                  <td>{p.umbralStockBajo ?? "—"}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

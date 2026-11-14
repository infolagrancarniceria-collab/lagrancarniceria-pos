import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Categoria, type ProductoConStock } from "../api";
import SelectorCategoria from "../components/SelectorCategoria";
import ModalAlerta from "../components/ModalAlerta";
import ModalReiniciarInventario from "../components/ModalReiniciarInventario";
import { mostrarToast } from "../lib/toast";

// Agrupa por categoría RAÍZ (nivel 1 — ej. Vacuno/Cerdo/Pollo/Abarrotes), no
// la subcategoría directa del producto, que puede ser de nivel 2/3 y daría
// demasiados grupos para revisar de un vistazo — mismo criterio que ya usa
// el reporte de Ventas (ver categoriaRaizNombre en reportes.ts). Devuelve
// también el id de la raíz (no solo el nombre) para poder reiniciar el
// stock de esa categoría puntual (ver api.inventario.reiniciar).
function construirResolverRaiz(categorias: Categoria[]): (categoriaId: number) => { id: number; nombre: string } {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const cache = new Map<number, { id: number; nombre: string }>();
  return (categoriaId: number) => {
    const cacheada = cache.get(categoriaId);
    if (cacheada) return cacheada;
    let actual = porId.get(categoriaId);
    while (actual?.padreId != null) {
      actual = porId.get(actual.padreId);
    }
    const resultado = actual ? { id: actual.id, nombre: actual.nombre } : { id: categoriaId, nombre: "Sin categoría" };
    cache.set(categoriaId, resultado);
    return resultado;
  };
}

type Reinicio = { alcance: "global" } | { alcance: "categoria"; categoriaId: number; nombre: string };

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
  // Reinicio de stock (ver ModalReiniciarInventario) — null cuando no hay
  // ningún reinicio en curso.
  const [reiniciando, setReiniciando] = useState<Reinicio | null>(null);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  function cargar() {
    setCargando(true);
    api.inventario
      .stock(soloBajoStock, categoriaId || undefined, buscar.trim() || undefined)
      .then(setProductos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    const timeout = setTimeout(cargar, 250);
    return () => clearTimeout(timeout);
  }, [soloBajoStock, categoriaId, buscar]);

  async function confirmarReinicio(motivo: string, usuarioId: number, clave: string) {
    if (!reiniciando) return;
    const resultado = await api.inventario.reiniciar({
      alcance: reiniciando.alcance,
      categoriaId: reiniciando.alcance === "categoria" ? reiniciando.categoriaId : undefined,
      motivo,
      usuarioId,
      clave,
    });
    mostrarToast(
      "Inventario reiniciado",
      `${resultado.cantidadProductosAfectados} producto${resultado.cantidadProductosAfectados === 1 ? "" : "s"} a 0 — ${motivo}.`
    );
    setReiniciando(null);
    cargar();
  }

  const resolverRaiz = useMemo(() => construirResolverRaiz(categorias), [categorias]);

  const grupos = useMemo(() => {
    const porRaiz = new Map<string, { raizId: number; filas: ProductoConStock[] }>();
    for (const p of productos) {
      const raiz = resolverRaiz(p.categoriaId);
      const actual = porRaiz.get(raiz.nombre) ?? { raizId: raiz.id, filas: [] };
      actual.filas.push(p);
      porRaiz.set(raiz.nombre, actual);
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
          <Link to="/mercaderia/ingreso" className="boton">
            + Ingreso de mercadería
          </Link>
          <Link to="/mercaderia/entradas" className="boton">
            Revisar entradas
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
          <button type="button" className="boton boton-peligro" onClick={() => setReiniciando({ alcance: "global" })}>
            ⟲ Reiniciar inventario
          </button>
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
      <p className="ayuda">
        Para ver las compras y los movimientos de este período (no el stock actual), ve a{" "}
        <Link to="/reportes?tab=compras">Reportes → Compras</Link> o <Link to="/reportes?tab=stock">Reportes → Stock</Link>.
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
          {grupos.map(([raiz, { raizId, filas }]) => {
            // Se separan los kilos de las unidades en vez de sumarlos juntos
            // en un solo total — mezclar "3 kg" con "5 un." en el mismo
            // número no diría nada real (a pedido del usuario: totalizar por
            // productos, kilos o unidades, cada uno aparte).
            const subtotalKg = filas
              .filter((p) => p.flagBalanza === "PESABLE")
              .reduce((s, p) => s + p.stockActual, 0);
            const subtotalUnidades = filas
              .filter((p) => p.flagBalanza !== "PESABLE")
              .reduce((s, p) => s + p.stockActual, 0);
            return (
            <Fragment key={raiz}>
              <tr className="fila-total">
                <td colSpan={4}>
                  {raiz} — {filas.length} producto{filas.length === 1 ? "" : "s"}
                  {subtotalKg > 0 && ` · ${subtotalKg.toLocaleString("es-CL")} kg`}
                  {subtotalUnidades > 0 && ` · ${subtotalUnidades.toLocaleString("es-CL")} un.`}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="boton-chico"
                    onClick={() => setReiniciando({ alcance: "categoria", categoriaId: raizId, nombre: raiz })}
                  >
                    ⟲ Reiniciar {raiz}
                  </button>
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
            );
          })}
        </tbody>
      </table>

      {reiniciando && (
        <ModalReiniciarInventario
          alcance={reiniciando.alcance}
          categoriaId={reiniciando.alcance === "categoria" ? reiniciando.categoriaId : undefined}
          categoriaNombre={reiniciando.alcance === "categoria" ? reiniciando.nombre : undefined}
          onConfirmar={confirmarReinicio}
          onCancelar={() => setReiniciando(null)}
        />
      )}
    </div>
  );
}

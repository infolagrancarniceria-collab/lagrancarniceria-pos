import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  calcularMargen,
  calcularMargenReal,
  formatoCLP,
  type Categoria,
  type HistorialEntrada,
  type ProductoConUltimoCosto,
} from "../api";
import ModalAlerta from "../components/ModalAlerta";
import SelectorCategoria from "../components/SelectorCategoria";
import { imprimirControlPrecios } from "../lib/imprimir";

// Factor de IVA (19%) — mismo usado en calcularMargen/calcularMargenReal:
// el precio de venta ya incluye IVA, el costo no (el proveedor lo factura
// aparte). No considera el 5% adicional de IVA carne (aplicaIvaCarne),
// que es una calculadora aparte solo al cargar una factura — mismo
// criterio simplificado que ya usa el resto del sistema al mostrar margen.
const IVA = 1.19;

function sinIva(valorConIva: number): number {
  return Math.round(valorConIva / IVA);
}
function conIva(valorNeto: number): number {
  return Math.round(valorNeto * IVA);
}

function hoy(): string {
  return new Date().toLocaleDateString("es-CL");
}

// Pantalla nueva, a pedido del usuario, para tener de un vistazo el estado
// general de los precios del catálogo — cuántos productos tienen un precio
// realmente configurado, y qué tan rentables son en promedio — separada de
// "Combos" (que sirve para elegir QUÉ productos combinar), pero enlazada
// con ella para pasar de una a otra sin volver al menú.
export default function ControlPrecios() {
  const [productos, setProductos] = useState<ProductoConUltimoCosto[] | null>(null);
  const [historial, setHistorial] = useState<HistorialEntrada[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [verTodos, setVerTodos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
    api.historial.listar().then(setHistorial).catch((e) => setError(e.message));
  }, []);

  // El costo (y su "último valor de compra") depende de la categoría
  // elegida — a pedido del usuario, para poder filtrar el reporte por
  // categoría en vez de verlo siempre completo.
  useEffect(() => {
    api.productos
      .listarConCosto({ categoriaId: categoriaId || undefined })
      .then(setProductos)
      .catch((e) => setError(e.message));
  }, [categoriaId]);

  const categoriaElegida = categoriaId ? categorias.find((c) => c.id === categoriaId) ?? null : null;

  // "Precio activo" = producto activo con un precio realmente cargado (no
  // $0, que en la práctica significa que nunca se terminó de configurar) —
  // confirmado con el usuario. "Ver todos" muestra también esos.
  const productosConPrecioActivo = (productos ?? []).filter((p) => p.activo && p.precio > 0);
  const productosMostrados = verTodos ? productos ?? [] : productosConPrecioActivo;

  // Los promedios solo tienen sentido sobre productos con precio Y costo
  // conocidos — promediar un margen inventado sería peor que no mostrar
  // nada. Son promedios simples (no ponderados por kilos vendidos), tal
  // como lo pidió el usuario.
  const conMargenConocido = productosConPrecioActivo
    .map((p) => ({
      recargo: calcularMargen(p.precio, p.costoEfectivo),
      margenReal: calcularMargenReal(p.precio, p.costoEfectivo),
    }))
    .filter((x): x is { recargo: number; margenReal: number } => x.recargo != null && x.margenReal != null);

  const recargoPromedio = conMargenConocido.length
    ? conMargenConocido.reduce((s, x) => s + x.recargo, 0) / conMargenConocido.length
    : null;
  const margenRealPromedio = conMargenConocido.length
    ? conMargenConocido.reduce((s, x) => s + x.margenReal, 0) / conMargenConocido.length
    : null;

  // Para el registro de cambios de precio: el costo efectivo más reciente
  // conocido de cada producto AHORA (no hay forma de saber cuál era el
  // costo en el momento exacto de un cambio pasado, mismo criterio
  // simplificado que ya usa el resto del sistema al mostrar "margen" en
  // cualquier pantalla) — real si hay una compra registrada, o el costo de
  // referencia ingresado a mano como respaldo si no.
  const costoActualPorProducto = new Map(
    (productos ?? []).map((p) => [p.id, { costo: p.costoEfectivo, estimado: p.costoEsEstimado }]),
  );

  async function imprimir() {
    try {
      await imprimirControlPrecios();
    } catch {
      setError("No se pudo imprimir — revisa la impresora configurada en Configuración → Impresoras (Pedidos web).");
    }
  }

  return (
    <div>
      <div className="encabezado-pantalla no-imprimir">
        <h1>Control de precios</h1>
        <div className="fila-inline" style={{ marginBottom: 0 }}>
          <Link to="/productos/margenes" className="boton">
            🧩 Ver Combos (Mejor margen)
          </Link>
          <button type="button" className="boton boton-primario" onClick={imprimir} disabled={!productos}>
            Imprimir
          </button>
        </div>
      </div>
      <h1 className="solo-imprimir">
        Control de precios — {categoriaElegida?.nombre ?? "Todas las categorías"} — {hoy()}
      </h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <section className="tarjeta">
        <div className="fila-inline">
          <div>
            <strong>Productos con precio activo:</strong> {productosConPrecioActivo.length}
          </div>
          <div>
            <strong>Recargo promedio (sobre costo):</strong>{" "}
            {recargoPromedio != null ? `${recargoPromedio.toFixed(1)}%` : "—"}
          </div>
          <div>
            <strong>Margen real promedio (sobre venta neta):</strong>{" "}
            {margenRealPromedio != null ? `${margenRealPromedio.toFixed(1)}%` : "—"}
          </div>
        </div>
        <p className="ayuda">
          <strong>Guía de rentabilidad:</strong> el recargo se calcula sobre el costo; el margen real se calcula
          sobre la venta neta. Son promedios simples de los productos guardados — no están ponderados por kilos
          vendidos. El costo no incluye IVA (se factura aparte); el precio de venta sí lo incluye — ver las
          columnas "con IVA" / "neto" para comparar ambos en la misma base.
        </p>
      </section>

      <div className="filtros no-imprimir">
        <SelectorCategoria
          categorias={categorias}
          value={categoriaId}
          onChange={setCategoriaId}
          etiquetaTodas="Todas las categorías"
        />
        <label className="fila-inline">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} />
          Ver todos los productos (incluso sin precio activo)
        </label>
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>PLU</th>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Costo neto (último valor de compra)</th>
            <th>Costo con IVA</th>
            <th>Precio neto (sin IVA)</th>
            <th>Precio de venta (con IVA)</th>
            <th>Recargo (%)</th>
            <th>Margen real (%)</th>
          </tr>
        </thead>
        <tbody>
          {productos == null && (
            <tr>
              <td colSpan={9}>Cargando...</td>
            </tr>
          )}
          {productos != null && productosMostrados.length === 0 && (
            <tr>
              <td colSpan={9}>No hay productos para mostrar.</td>
            </tr>
          )}
          {productosMostrados.map((p) => {
            const recargo = calcularMargen(p.precio, p.costoEfectivo);
            const margenReal = calcularMargenReal(p.precio, p.costoEfectivo);
            return (
              <tr key={p.id} className={p.precio <= 0 ? "fila-error" : ""}>
                <td>
                  <Link to={`/productos/${p.id}`}>{p.plu}</Link>
                </td>
                <td>{p.descripcion}</td>
                <td>{p.categoria.nombre}</td>
                <td>
                  {p.costoEfectivo != null ? formatoCLP(p.costoEfectivo) : "—"}
                  {p.costoEsEstimado ? (
                    <div className="ayuda">(estimado — sin compra registrada)</div>
                  ) : (
                    p.ultimoCostoFecha && (
                      <div className="ayuda">
                        Última compra: {new Date(p.ultimoCostoFecha).toLocaleDateString("es-CL")}
                      </div>
                    )
                  )}
                </td>
                <td>{p.costoEfectivo != null ? formatoCLP(conIva(p.costoEfectivo)) : "—"}</td>
                <td>{p.precio > 0 ? formatoCLP(sinIva(p.precio)) : "—"}</td>
                <td>{p.precio > 0 ? formatoCLP(p.precio) : "Sin precio"}</td>
                <td>
                  {recargo != null ? (
                    <span className={recargo < 0 ? "error" : "exito"}>{recargo.toFixed(1)}%</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {margenReal != null ? (
                    <span className={margenReal < 0 ? "error" : "exito"}>{margenReal.toFixed(1)}%</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="no-imprimir">Registro de cambios de precio</h2>
      <p className="ayuda no-imprimir">
        Costo y márgenes calculados con el costo efectivo más reciente hoy (una compra real si existe, o el
        costo de referencia ingresado a mano como respaldo — marcado "(estimado)"), no con el costo que había en
        el momento exacto del cambio (el sistema no guarda esa foto histórica).
      </p>
      <table className="tabla no-imprimir">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Costo efectivo</th>
            <th>Precio de venta</th>
            <th>Margen aplicado</th>
            <th>Margen real</th>
          </tr>
        </thead>
        <tbody>
          {historial == null && (
            <tr>
              <td colSpan={6}>Cargando...</td>
            </tr>
          )}
          {historial != null && historial.length === 0 && (
            <tr>
              <td colSpan={6}>Todavía no hay cambios de precio registrados.</td>
            </tr>
          )}
          {(historial ?? []).map((h) => {
            const info = costoActualPorProducto.get(h.productoId);
            const costo = info?.costo ?? null;
            const recargo = calcularMargen(h.precioNuevo, costo);
            const margenReal = calcularMargenReal(h.precioNuevo, costo);
            return (
              <tr key={h.id}>
                <td>{new Date(h.fecha).toLocaleString("es-CL")}</td>
                <td>
                  {h.producto.plu} — {h.producto.descripcion}
                </td>
                <td>
                  {costo != null ? formatoCLP(costo) : "—"}
                  {info?.estimado && <span className="ayuda"> (estimado)</span>}
                </td>
                <td>{formatoCLP(h.precioNuevo)}</td>
                <td>{recargo != null ? `${recargo.toFixed(1)}%` : "—"}</td>
                <td>{margenReal != null ? `${margenReal.toFixed(1)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

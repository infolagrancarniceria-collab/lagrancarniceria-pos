import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatoCLP, type MovimientoInventario, type Producto } from "../api";
import ModalAlerta from "../components/ModalAlerta";

const etiquetasMotivo: Record<string, string> = {
  compra: "Compra",
  venta: "Venta",
  descarte: "Descarte / merma",
  ajuste: "Ajuste",
  venta_anulada: "Devolución (venta anulada)",
};

export default function MovimientosInventario() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [tipo, setTipo] = useState<"" | "entrada" | "salida">("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filtro por producto — a diferencia de los otros dos (texto libre), este
  // necesita resolver primero a un productoId (ver buscador abajo). Si llega
  // ?productoId=X&productoDescripcion=Y por la URL (ej. desde el link
  // "Ver historial de compras" en la ficha de un producto), arranca ya
  // filtrado por ese producto sin que haya que volver a buscarlo a mano.
  const [productoSeleccionado, setProductoSeleccionado] = useState<{ id: number; descripcion: string } | null>(() => {
    const id = searchParams.get("productoId");
    const descripcion = searchParams.get("productoDescripcion");
    return id ? { id: Number(id), descripcion: descripcion ?? `Producto #${id}` } : null;
  });
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [resultadosProducto, setResultadosProducto] = useState<Producto[]>([]);

  useEffect(() => {
    if (productoSeleccionado || !busquedaProducto.trim()) {
      setResultadosProducto([]);
      return;
    }
    const timeout = setTimeout(() => {
      api.productos
        .listar({ buscar: busquedaProducto })
        .then((r) => setResultadosProducto(r.slice(0, 8)))
        .catch(() => setResultadosProducto([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [busquedaProducto, productoSeleccionado]);

  function elegirProducto(p: Producto) {
    setProductoSeleccionado({ id: p.id, descripcion: `${p.plu} — ${p.descripcion}` });
    setBusquedaProducto("");
    setResultadosProducto([]);
    setSearchParams({ productoId: String(p.id), productoDescripcion: `${p.plu} — ${p.descripcion}` });
  }

  function quitarProducto() {
    setProductoSeleccionado(null);
    setSearchParams({});
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      api.inventario
        .movimientos({
          ...(tipo ? { tipo } : {}),
          ...(numeroFactura ? { numeroFactura } : {}),
          ...(productoSeleccionado ? { productoId: productoSeleccionado.id } : {}),
        })
        .then(setMovimientos)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timeout);
  }, [tipo, numeroFactura, productoSeleccionado]);

  return (
    <div>
      <h1>Historial de movimientos de inventario</h1>
      <p className="ayuda">
        Para cuadrar o revisar de dónde salió un costo o una cantidad de stock — filtra por producto para ver solo
        sus entradas/salidas (compras, mermas, ajustes), o por N° de factura para revisar una compra completa.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | "entrada" | "salida")}>
          <option value="">Todos los movimientos</option>
          <option value="entrada">Solo entradas</option>
          <option value="salida">Solo salidas</option>
        </select>
        <input
          type="text"
          placeholder="Buscar por N° de factura..."
          value={numeroFactura}
          onChange={(e) => setNumeroFactura(e.target.value)}
        />
        {productoSeleccionado ? (
          <span className="fila-inline">
            Producto: <strong>{productoSeleccionado.descripcion}</strong>
            <button type="button" onClick={quitarProducto}>
              Quitar filtro
            </button>
          </span>
        ) : (
          <input
            type="text"
            placeholder="Buscar por producto (PLU o nombre)..."
            value={busquedaProducto}
            onChange={(e) => setBusquedaProducto(e.target.value)}
          />
        )}
        {resultadosProducto.length > 0 && (
          <ul className="lista-resultados">
            {resultadosProducto.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => elegirProducto(p)}>
                  {p.plu} — {p.descripcion}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Motivo</th>
            <th>Cantidad</th>
            <th>Costo unitario</th>
            <th>Proveedor</th>
            <th>N° Factura</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.fecha).toLocaleString("es-CL")}</td>
              <td>
                {m.producto.plu} — {m.producto.descripcion}
              </td>
              <td>{m.tipo === "entrada" ? "Entrada" : "Salida"}</td>
              <td>{etiquetasMotivo[m.motivo] ?? m.motivo}</td>
              <td>{m.cantidad}</td>
              <td>{m.costoUnitario != null ? formatoCLP(m.costoUnitario) : "—"}</td>
              <td>{m.proveedor?.nombre ?? "—"}</td>
              <td>{m.numeroFactura ?? "—"}</td>
              <td>{m.usuario.nombre}</td>
            </tr>
          ))}
          {movimientos.length === 0 && (
            <tr>
              <td colSpan={9}>
                {productoSeleccionado || numeroFactura || tipo
                  ? "No hay movimientos que calcen con este filtro."
                  : "Todavía no hay movimientos registrados."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

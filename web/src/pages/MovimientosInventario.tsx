import { useEffect, useState } from "react";
import { api, type MovimientoInventario } from "../api";

const etiquetasMotivo: Record<string, string> = {
  compra: "Compra",
  venta: "Venta",
  descarte: "Descarte / merma",
  ajuste: "Ajuste",
};

export default function MovimientosInventario() {
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [tipo, setTipo] = useState<"" | "entrada" | "salida">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.inventario
      .movimientos(tipo ? { tipo } : {})
      .then(setMovimientos)
      .catch((e) => setError(e.message));
  }, [tipo]);

  return (
    <div>
      <h1>Historial de movimientos de inventario</h1>
      {error && <p className="error">{error}</p>}

      <div className="filtros">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | "entrada" | "salida")}>
          <option value="">Todos los movimientos</option>
          <option value="entrada">Solo entradas</option>
          <option value="salida">Solo salidas</option>
        </select>
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Motivo</th>
            <th>Cantidad</th>
            <th>Proveedor</th>
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
              <td>{m.proveedor?.nombre ?? "—"}</td>
              <td>{m.usuario.nombre}</td>
            </tr>
          ))}
          {movimientos.length === 0 && (
            <tr>
              <td colSpan={7}>Todavía no hay movimientos registrados.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

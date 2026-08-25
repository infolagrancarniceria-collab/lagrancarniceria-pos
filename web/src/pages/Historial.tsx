import { useEffect, useState } from "react";
import { api, formatoCLP, type HistorialEntrada } from "../api";
import ModalAlerta from "../components/ModalAlerta";

const etiquetasTipo: Record<string, string> = {
  individual: "Individual",
  individual_caja: "Individual (desde Caja)",
  masivo_categoria: "Masivo (categoría)",
  masivo_csv: "Masivo (planilla)",
};

export default function Historial() {
  const [historial, setHistorial] = useState<HistorialEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.historial.listar().then(setHistorial).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Historial de cambios de precio</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Usuario</th>
            <th>Precio anterior</th>
            <th>Precio nuevo</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          {historial.map((h) => (
            <tr key={h.id}>
              <td>{new Date(h.fecha).toLocaleString("es-CL")}</td>
              <td>
                {h.producto.plu} — {h.producto.descripcion}
              </td>
              <td>{h.usuario.nombre}</td>
              <td>{formatoCLP(h.precioAnterior)}</td>
              <td>{formatoCLP(h.precioNuevo)}</td>
              <td title={h.motivoAutorizacion ?? undefined}>{etiquetasTipo[h.tipoCambio] ?? h.tipoCambio}</td>
            </tr>
          ))}
          {historial.length === 0 && (
            <tr>
              <td colSpan={6}>Todavía no hay cambios de precio registrados.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

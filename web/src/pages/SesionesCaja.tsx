import { useEffect, useState } from "react";
import { api, formatoCLP, type SesionCaja } from "../api";

export default function SesionesCaja() {
  const [sesiones, setSesiones] = useState<SesionCaja[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.caja.sesiones().then(setSesiones).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Historial de cajas</h1>
      {error && <p className="error">{error}</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>Apertura</th>
            <th>Cierre</th>
            <th>Abierta por</th>
            <th>Cerrada por</th>
            <th>Fondo fijo</th>
            <th>Ajuste de fondo</th>
            <th>Efectivo contado</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {sesiones.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.fechaApertura).toLocaleString("es-CL")}</td>
              <td>{s.fechaCierre ? new Date(s.fechaCierre).toLocaleString("es-CL") : "—"}</td>
              <td>{s.usuarioApertura?.nombre ?? "—"}</td>
              <td>{s.usuarioCierre?.nombre ?? "—"}</td>
              <td>{formatoCLP(s.fondoFijoInicial)}</td>
              <td>
                {s.motivoAjusteFondo ? (
                  <span title={s.motivoAjusteFondo}>
                    Esperado {formatoCLP(s.fondoFijoSugerido ?? 0)} · autorizó{" "}
                    {s.usuarioAutorizoFondo?.nombre ?? "—"}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>{s.efectivoContado != null ? formatoCLP(s.efectivoContado) : "—"}</td>
              <td>{s.estado === "abierta" ? "Abierta" : "Cerrada"}</td>
            </tr>
          ))}
          {sesiones.length === 0 && (
            <tr>
              <td colSpan={8}>Todavía no hay sesiones de caja registradas.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

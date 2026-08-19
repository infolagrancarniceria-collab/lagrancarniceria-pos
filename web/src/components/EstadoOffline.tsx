import { useEffect, useState } from "react";
import { descartarError, obtenerErrores, obtenerPendientes, sincronizarPendientes } from "../lib/colaOffline";

// Widget chico para las pantallas de Cámara que muestra si hay acciones
// (salidas, ajustes) guardadas en este celular esperando conexión para
// mandarse solas, y si alguna terminó rechazada al reintentarla (raro,
// pero posible — ej. la caja ya la resolvió otra persona mientras tanto).
export function EstadoOffline() {
  const [pendientes, setPendientes] = useState(obtenerPendientes());
  const [errores, setErrores] = useState(obtenerErrores());

  function refrescar() {
    setPendientes(obtenerPendientes());
    setErrores(obtenerErrores());
  }

  useEffect(() => {
    refrescar();
    const intervalo = setInterval(async () => {
      await sincronizarPendientes();
      refrescar();
    }, 15000);
    window.addEventListener("online", refrescar);
    window.addEventListener("focus", refrescar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("online", refrescar);
      window.removeEventListener("focus", refrescar);
    };
  }, []);

  if (pendientes.length === 0 && errores.length === 0) return null;

  return (
    <div className="tarjeta">
      {pendientes.length > 0 && (
        <p className="ayuda">
          {pendientes.length} acción(es) guardada(s) en este celular esperando señal para enviarse —{" "}
          {pendientes.map((p) => p.descripcion).join(", ")}. Se van a mandar solas apenas vuelva la conexión.
        </p>
      )}
      {errores.length > 0 && (
        <div>
          <p className="error">
            {errores.length} acción(es) no se pudieron mandar (el servidor las rechazó al reintentarlas) — revísalas
            a mano:
          </p>
          <ul>
            {errores.map((e) => (
              <li key={e.id}>
                {e.descripcion}: {e.error}{" "}
                <button
                  type="button"
                  className="boton-chico"
                  onClick={() => {
                    descartarError(e.id);
                    refrescar();
                  }}
                >
                  Descartar aviso
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

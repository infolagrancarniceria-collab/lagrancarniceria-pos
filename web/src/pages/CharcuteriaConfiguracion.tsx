import { useEffect, useState } from "react";
import { api } from "../api";
import { mostrarToast } from "../lib/toast";
import SeccionProtegidaCharcuteria from "../components/SeccionProtegidaCharcuteria";

function ConfiguracionContenido() {
  const [umbral, setUmbral] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.charcuteria.obtenerConfiguracion().then((c) => setUmbral(String(c.umbralVencimientoDias)));
  }, []);

  async function guardarUmbral(e: React.FormEvent) {
    e.preventDefault();
    const dias = Number(umbral);
    if (!dias || dias <= 0) return;
    setGuardando(true);
    try {
      await api.charcuteria.guardarConfiguracion(dias);
      mostrarToast("Umbral guardado");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Configuración de Charcutería</h1>

      <div className="tarjeta">
        <h2>Umbral de alerta de vencimiento</h2>
        <form onSubmit={guardarUmbral} className="fila-inline">
          <label>
            Avisar cuando falten
            <input
              type="number"
              min="1"
              className="input-chico"
              value={umbral}
              onChange={(e) => setUmbral(e.target.value)}
            />
          </label>
          días o menos para el vencimiento
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function CharcuteriaConfiguracion() {
  return (
    <SeccionProtegidaCharcuteria>
      <ConfiguracionContenido />
    </SeccionProtegidaCharcuteria>
  );
}

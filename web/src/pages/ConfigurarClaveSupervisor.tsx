import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function ConfigurarClaveSupervisor() {
  const navigate = useNavigate();
  const [yaConfigurada, setYaConfigurada] = useState<boolean | null>(null);
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    api.caja.estadoClave().then((r) => setYaConfigurada(r.configurada)).catch((e) => setError(e.message));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (claveNueva.length < 4) {
      setError("La clave debe tener al menos 4 caracteres");
      return;
    }
    if (claveNueva !== confirmacion) {
      setError("La confirmación no coincide con la clave nueva");
      return;
    }
    try {
      await api.caja.configurarClave({
        claveActual: yaConfigurada ? claveActual : undefined,
        claveNueva,
      });
      setMensaje("Clave de supervisor guardada");
      setTimeout(() => navigate("/caja"), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>{yaConfigurada ? "Cambiar clave de supervisor" : "Configurar clave de supervisor"}</h1>
      <p className="ayuda">
        Esta clave la piden solo para anular un producto de una venta por error. La conocen los
        supervisores, no cada cajero.
      </p>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <form onSubmit={guardar} className="formulario">
        {yaConfigurada && (
          <label>
            Clave actual
            <input type="password" value={claveActual} onChange={(e) => setClaveActual(e.target.value)} required />
          </label>
        )}
        <label>
          Clave nueva
          <input type="password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} required />
        </label>
        <label>
          Confirmar clave nueva
          <input type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />
        </label>
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario">
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}

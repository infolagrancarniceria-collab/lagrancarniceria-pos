import { useState } from "react";
import { api } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

export default function CharcuteriaMiClave() {
  const { usuario } = useUsuario();
  const [claveNueva, setClaveNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario) return;
    if (claveNueva.length < 4) {
      setError("La clave debe tener al menos 4 caracteres");
      return;
    }
    if (claveNueva !== confirmacion) {
      setError("Las claves no coinciden");
      return;
    }
    setGuardando(true);
    try {
      await api.charcuteria.establecerClavePersonal(usuario.id, claveNueva);
      mostrarToast("Clave personal guardada");
      setClaveNueva("");
      setConfirmacion("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Mi clave personal</h1>
      <p className="ayuda">
        Se usa solo para acciones del módulo de charcutería que la piden (ej. editar el vencimiento de un lote) — no
        reemplaza la clave de supervisor, que sigue siendo compartida para el resto del sistema.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario tarjeta">
        <label>
          Clave nueva
          <input type="password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} required />
        </label>
        <label>
          Confirmar clave
          <input type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />
        </label>
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

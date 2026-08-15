import { useEffect, useState } from "react";
import { api, type Usuario } from "../api";

interface Props {
  titulo: string;
  descripcion?: string;
  onConfirmar: (usuarioId: number, clave: string) => Promise<void>;
  onCancelar: () => void;
}

// Modal reutilizable para acciones que necesitan clave de supervisor (anular
// un ítem del carrito, cancelar una venta completa): pide el nombre de quien
// autoriza (no necesariamente quien tiene la sesión de caja abierta) además
// de la clave, para que el registro quede a nombre de la persona real que
// aprobó la anulación.
export default function ModalConfirmarClave({ titulo, descripcion, onConfirmar, onCancelar }: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioId, setUsuarioId] = useState<number | "">("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.usuarios.listar().then(setUsuarios).catch((e) => setError(e.message));
  }, []);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuarioId) {
      setError("Elige quién autoriza la anulación");
      return;
    }
    if (!clave.trim()) {
      setError("Falta la clave de supervisor");
      return;
    }
    setEnviando(true);
    try {
      await onConfirmar(Number(usuarioId), clave);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo">
      <div className="modal-contenido tarjeta">
        <h2>{titulo}</h2>
        {descripcion && <p className="ayuda">{descripcion}</p>}
        {error && <p className="error">{error}</p>}
        <form onSubmit={confirmar} className="formulario">
          <label>
            Quién autoriza
            <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Elegir nombre...</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Clave de supervisor
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={enviando}>
              {enviando ? "Confirmando..." : "Confirmar"}
            </button>
            <button type="button" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

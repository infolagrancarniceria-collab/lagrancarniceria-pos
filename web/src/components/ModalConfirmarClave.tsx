import { useEffect, useState } from "react";
import { api, type Usuario } from "../api";

const OTRO = "Otro";

interface Props {
  titulo: string;
  descripcion?: string;
  motivoOpciones?: string[];
  onConfirmar: (usuarioId: number, clave: string, motivo?: string) => Promise<void>;
  onCancelar: () => void;
}

// Modal reutilizable para acciones que necesitan clave de supervisor (anular
// un ítem del carrito, cancelar una venta completa): pide el nombre de quien
// autoriza (no necesariamente quien tiene la sesión de caja abierta) además
// de la clave, para que el registro quede a nombre de la persona real que
// aprobó la anulación. Si se pasa motivoOpciones, también pide el motivo
// (de una lista rápida, con "Otro" para texto libre).
export default function ModalConfirmarClave({
  titulo,
  descripcion,
  motivoOpciones,
  onConfirmar,
  onCancelar,
}: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioId, setUsuarioId] = useState<number | "">("");
  const [clave, setClave] = useState("");
  const [motivo, setMotivo] = useState("");
  const [motivoOtro, setMotivoOtro] = useState("");
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
    let motivoFinal: string | undefined;
    if (motivoOpciones) {
      if (!motivo) {
        setError("Elige el motivo de la anulación");
        return;
      }
      if (motivo === OTRO && !motivoOtro.trim()) {
        setError("Escribe el motivo");
        return;
      }
      motivoFinal = motivo === OTRO ? motivoOtro.trim() : motivo;
    }
    setEnviando(true);
    try {
      await onConfirmar(Number(usuarioId), clave, motivoFinal);
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
          {motivoOpciones && (
            <label>
              Motivo de anulación
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="">Elegir motivo...</option>
                {motivoOpciones.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={OTRO}>Otro</option>
              </select>
            </label>
          )}
          {motivo === OTRO && (
            <label>
              Especificar motivo
              <input type="text" value={motivoOtro} onChange={(e) => setMotivoOtro(e.target.value)} />
            </label>
          )}
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

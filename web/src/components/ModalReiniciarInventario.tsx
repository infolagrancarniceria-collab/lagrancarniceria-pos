import { useEffect, useState } from "react";
import { api, type Usuario } from "../api";

interface Props {
  alcance: "global" | "categoria";
  categoriaId?: number;
  categoriaNombre?: string;
  onConfirmar: (motivo: string, usuarioId: number, clave: string) => Promise<void>;
  onCancelar: () => void;
}

// Reinicio auditado de stock — a pedido del usuario, para empezar una
// cuadratura física de inventario desde 0 sin perder el rastro de por qué
// cambió cada producto (motivo + quién autoriza + clave de supervisor,
// mismo patrón que Retiro de caja / Corregir cuadratura). Antes de poder
// confirmar, muestra cuántos productos se van a ver afectados (ver
// api.inventario.reiniciarPreview) para que no sea una sorpresa.
export default function ModalReiniciarInventario({ alcance, categoriaId, categoriaNombre, onConfirmar, onCancelar }: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cantidadAfectados, setCantidadAfectados] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [usuarioId, setUsuarioId] = useState<number | "">("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.usuarios.listar().then(setUsuarios).catch((e) => setError(e.message));
    api.inventario
      .reiniciarPreview(alcance, categoriaId)
      .then((r) => setCantidadAfectados(r.cantidadProductos))
      .catch((e) => setError(e.message));
  }, [alcance, categoriaId]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!motivo.trim()) {
      setError("Falta el motivo del reinicio");
      return;
    }
    if (!usuarioId) {
      setError("Elige quién autoriza el reinicio");
      return;
    }
    if (!clave.trim()) {
      setError("Falta la clave de supervisor");
      return;
    }
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim(), Number(usuarioId), clave);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const titulo = alcance === "global" ? "Todas las categorías" : categoriaNombre ?? "Categoría";

  return (
    <div className="modal-fondo">
      <div className="modal-contenido tarjeta">
        <h2>Reiniciar inventario — {titulo}</h2>
        <p className="ayuda">
          Lleva el stock de {alcance === "global" ? "todos los productos" : `los productos de "${titulo}"`} a 0, para
          empezar la cuadratura física desde cero. Queda registrado por qué se hizo y quién lo autorizó — no borra el
          historial de movimientos anteriores, y cada producto queda con un ajuste en su propio historial.
        </p>
        {cantidadAfectados != null && (
          <p className={cantidadAfectados > 0 ? "error" : "ayuda"}>
            {cantidadAfectados === 0
              ? "Ningún producto tiene stock distinto de 0 ahora mismo — no habría nada que reiniciar."
              : `Esto afecta ${cantidadAfectados} producto${cantidadAfectados === 1 ? "" : "s"} con stock actual distinto de 0.`}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <form onSubmit={confirmar} className="formulario">
          <label>
            Motivo del reinicio
            <input
              type="text"
              placeholder='Ej. "Cuadratura física de fin de mes"'
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              autoFocus
            />
          </label>
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
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          <div className="acciones-formulario">
            <button
              type="submit"
              className="boton boton-peligro"
              disabled={enviando || cantidadAfectados === 0}
            >
              {enviando ? "Reiniciando..." : "Confirmar reinicio"}
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

import { useEffect, useState } from "react";
import { api, type Usuario } from "../api";

interface Props {
  onConfirmar: (monto: number, motivo: string, usuarioId: number, clave: string) => Promise<void>;
  onCancelar: () => void;
}

// Retiro de caja — plata que sale del cajón en efectivo sin ser parte de
// una venta (ej. pagarle a un proveedor que llega con mercadería a mitad
// del día). Mismo patrón de autorización que anular una venta
// (ModalConfirmarClave: quién autoriza + clave de supervisor), pero con
// monto y motivo como campos propios en vez de un dropdown de motivos —
// acá el motivo es libre (a quién se le pagó), no una lista corta fija.
export default function ModalRetiroCaja({ onConfirmar, onCancelar }: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
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
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    if (!motivo.trim()) {
      setError("Falta el motivo del retiro (ej. a quién se le pagó)");
      return;
    }
    if (!usuarioId) {
      setError("Elige quién autoriza el retiro");
      return;
    }
    if (!clave.trim()) {
      setError("Falta la clave de supervisor");
      return;
    }
    setEnviando(true);
    try {
      await onConfirmar(montoNum, motivo.trim(), Number(usuarioId), clave);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo">
      <div className="modal-contenido tarjeta">
        <h2>Retiro de caja</h2>
        <p className="ayuda">
          Para cuando se saca plata del cajón para pagar mercadería que llega durante el día — se descuenta del
          efectivo esperado al cerrar la caja, para que no aparezca como una diferencia.
        </p>
        {error && <p className="error">{error}</p>}
        <form onSubmit={confirmar} className="formulario">
          <label>
            Monto a retirar
            <input
              type="number"
              min="1"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Motivo (ej. "Pago a Distribuidora Ñuble")
            <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
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
            <button type="submit" className="boton boton-primario" disabled={enviando}>
              {enviando ? "Retirando..." : "Confirmar retiro"}
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

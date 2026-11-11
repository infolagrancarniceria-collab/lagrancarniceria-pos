import { useEffect, useState } from "react";
import { api, formatoCLP, type Usuario } from "../api";

interface Props {
  fechaSesion: string;
  onConfirmar: (
    medio: "efectivo" | "tarjeta",
    direccion: "suma" | "resta",
    monto: number,
    motivo: string,
    usuarioId: number,
    clave: string
  ) => Promise<void>;
  onCancelar: () => void;
}

// Corrección auditada al efectivo/tarjeta que la cuadratura calculó para un
// día — a pedido del usuario, para cuando un pago quedó registrado con el
// medio equivocado (o cualquier otro error puntual) y hace falta corregir
// el total que se reporta SIN pisar ninguna venta ni pago real. Mismo
// patrón de autorización que Retiro/Ingreso de caja: monto, motivo, quién
// autoriza y clave de supervisor, todo en un solo formulario.
export default function ModalAjusteCuadratura({ fechaSesion, onConfirmar, onCancelar }: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [medio, setMedio] = useState<"efectivo" | "tarjeta">("efectivo");
  const [direccion, setDireccion] = useState<"suma" | "resta">("suma");
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
      setError("Falta el motivo de la corrección");
      return;
    }
    if (!usuarioId) {
      setError("Elige quién autoriza la corrección");
      return;
    }
    if (!clave.trim()) {
      setError("Falta la clave de supervisor");
      return;
    }
    setEnviando(true);
    try {
      await onConfirmar(medio, direccion, montoNum, motivo.trim(), Number(usuarioId), clave);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo">
      <div className="modal-contenido tarjeta">
        <h2>Corregir cuadratura — {fechaSesion}</h2>
        <p className="ayuda">
          Para cuando el efectivo o la tarjeta de este día quedaron mal (ej. un pago se registró con el medio
          equivocado). No modifica ninguna venta ni pago real — queda como una corrección aparte, con motivo, que
          se suma o resta al calcular la cuadratura de este día.
        </p>
        {error && <p className="error">{error}</p>}
        <form onSubmit={confirmar} className="formulario">
          <label>
            Medio a corregir
            <select value={medio} onChange={(e) => setMedio(e.target.value as "efectivo" | "tarjeta")}>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </label>
          <label>
            Corrección
            <select value={direccion} onChange={(e) => setDireccion(e.target.value as "suma" | "resta")}>
              <option value="suma">Sumar (el total reportado quedó bajo)</option>
              <option value="resta">Restar (el total reportado quedó alto)</option>
            </select>
          </label>
          <label>
            Monto {direccion === "suma" ? "a sumar" : "a restar"}
            <input type="number" min="1" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </label>
          <label>
            Motivo (ej. "Pago con tarjeta registrado por error como efectivo")
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
          {Number(monto) > 0 && (
            <p className="ayuda">
              {direccion === "suma" ? "+" : "−"}
              {formatoCLP(Number(monto))} al total de {medio === "efectivo" ? "efectivo" : "tarjeta"} de este día.
            </p>
          )}
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={enviando}>
              {enviando ? "Guardando..." : "Confirmar corrección"}
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

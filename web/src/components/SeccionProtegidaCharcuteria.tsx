import { useState } from "react";
import { api } from "../api";

interface Props {
  children: React.ReactNode;
}

// Gate de entrada para las pantallas sensibles de Charcutería
// (Configuración, Roles, Costo y margen): pide la clave de supervisor antes
// de mostrar el contenido. No queda "recordada" — se vuelve a pedir cada
// vez que se entra a la pantalla, igual que cualquier otra acción que ya
// pide esta misma clave en el resto del sistema.
export default function SeccionProtegidaCharcuteria({ children }: Props) {
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clave.trim()) {
      setError("Ingresa la clave de supervisor");
      return;
    }
    setVerificando(true);
    try {
      await api.charcuteria.verificarClaveSensible(clave);
      setDesbloqueado(true);
    } catch (e) {
      setError((e as Error).message);
      setClave("");
    } finally {
      setVerificando(false);
    }
  }

  if (desbloqueado) return <>{children}</>;

  return (
    <div className="tarjeta" style={{ maxWidth: 420 }}>
      <h1>🔒 Sección protegida</h1>
      <p className="ayuda">Esta sección de Charcutería requiere la clave de supervisor para entrar.</p>
      {error && <p className="error">{error}</p>}
      <form onSubmit={verificar} className="formulario">
        <label>
          Clave de supervisor
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus />
        </label>
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={verificando}>
            {verificando ? "Verificando..." : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

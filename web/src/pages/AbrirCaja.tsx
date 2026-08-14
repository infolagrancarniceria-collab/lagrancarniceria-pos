import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { TecladoNumerico } from "../components/TecladoNumerico";

export default function AbrirCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();
  const [fondoFijoInicial, setFondoFijoInicial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario) return;
    const fondo = Number(fondoFijoInicial);
    if (Number.isNaN(fondo) || fondo < 0) {
      setError("El fondo fijo debe ser un número mayor o igual a 0");
      return;
    }
    setGuardando(true);
    try {
      await api.caja.abrirSesion({ fondoFijoInicial: fondo, usuarioId: usuario.id });
      navigate("/caja");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Abrir caja</h1>
      {error && <p className="error">{error}</p>}
      <form onSubmit={abrir} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Fondo fijo inicial
          <div className="fila-inline">
            <input
              type="number"
              min="0"
              value={fondoFijoInicial}
              onChange={(e) => setFondoFijoInicial(e.target.value)}
              placeholder="ej. 20000"
              required
            />
            <TecladoNumerico valor={fondoFijoInicial} onCambiar={setFondoFijoInicial} />
          </div>
        </label>
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Abriendo..." : "Abrir caja"}
          </button>
        </div>
      </form>
    </div>
  );
}

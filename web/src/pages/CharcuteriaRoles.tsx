import { useEffect, useState } from "react";
import { api, type Usuario } from "../api";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";
import SeccionProtegidaCharcuteria from "../components/SeccionProtegidaCharcuteria";

const ETIQUETAS_ROL: Record<string, string> = {
  admin: "Admin (ve costos/márgenes, edita vencimientos)",
  produccion: "Producción (crea lotes y envasa)",
  caja: "Caja (solo vende — es el default)",
};

function CharcuteriaRolesContenido() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardandoId, setGuardandoId] = useState<number | null>(null);

  function cargar() {
    api.usuarios.listar().then(setUsuarios).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function cambiar(usuarioId: number, rol: "admin" | "produccion" | "caja") {
    if (!clave) {
      setError("Ingresa la clave de supervisor arriba antes de cambiar un rol");
      return;
    }
    setGuardandoId(usuarioId);
    setError(null);
    try {
      await api.charcuteria.cambiarRol(usuarioId, clave, rol);
      mostrarToast("Rol actualizado");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoId(null);
    }
  }

  return (
    <div>
      <h1>Roles de charcutería</h1>
      <p className="ayuda">
        Solo aplica dentro de este módulo — el resto del sistema sigue sin roles. Cambiar el rol de alguien requiere
        la clave de supervisor. Si ese usuario ya tiene la sesión abierta, el cambio se refleja recién la próxima vez
        que elija su nombre en "¿Quién eres?".
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta">
        <label>
          Clave de supervisor
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Rol actual</th>
            <th>Cambiar a</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nombre}</td>
              <td>{ETIQUETAS_ROL[u.rol ?? "caja"]}</td>
              <td className="fila-inline">
                {(["admin", "produccion", "caja"] as const).map((rol) => (
                  <button
                    key={rol}
                    type="button"
                    disabled={guardandoId === u.id || u.rol === rol}
                    onClick={() => cambiar(u.id, rol)}
                  >
                    {rol}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CharcuteriaRoles() {
  return (
    <SeccionProtegidaCharcuteria>
      <CharcuteriaRolesContenido />
    </SeccionProtegidaCharcuteria>
  );
}

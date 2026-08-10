import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Usuario } from "../api";
import { useUsuario } from "../context/UsuarioContext";

export default function Login() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setUsuario } = useUsuario();
  const navigate = useNavigate();

  useEffect(() => {
    api.usuarios.listar().then(setUsuarios).catch((e) => setError(e.message));
  }, []);

  function elegir(usuario: Usuario) {
    setUsuario(usuario);
    navigate("/productos");
  }

  async function agregarUsuario(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombreNuevo.trim()) return;
    try {
      const usuario = await api.usuarios.crear(nombreNuevo.trim());
      elegir(usuario);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="pantalla-login">
      <h1>La Gran Carnicería</h1>
      <p>¿Quién eres?</p>
      {error && <p className="error">{error}</p>}
      <div className="lista-usuarios">
        {usuarios.map((u) => (
          <button key={u.id} type="button" className="boton-usuario" onClick={() => elegir(u)}>
            {u.nombre}
          </button>
        ))}
      </div>
      <form onSubmit={agregarUsuario} className="form-usuario-nuevo">
        <input
          type="text"
          placeholder="Agregar nuevo usuario"
          value={nombreNuevo}
          onChange={(e) => setNombreNuevo(e.target.value)}
        />
        <button type="submit">Agregar y entrar</button>
      </form>
    </div>
  );
}

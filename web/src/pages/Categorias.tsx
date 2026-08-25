import { useEffect, useState } from "react";
import { api, type Categoria } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";

export default function Categorias() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [nivel, setNivel] = useState<1 | 2 | 3>(1);
  const [padreId, setPadreId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function cargar() {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  const padresDisponibles = categorias.filter((c) => c.nivel === nivel - 1);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (nivel > 1 && !padreId) {
      setError("Falta elegir la categoría padre");
      return;
    }
    try {
      await api.categorias.crear({
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        nivel,
        padreId: nivel === 1 ? null : Number(padreId),
      });
      setCodigo("");
      setNombre("");
      setPadreId("");
      setMensaje("Categoría creada");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Categorías</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      <section className="tarjeta">
        <h2>Nueva categoría</h2>
        <form onSubmit={crear} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            Nivel
            <select value={nivel} onChange={(e) => { setNivel(Number(e.target.value) as 1 | 2 | 3); setPadreId(""); }}>
              <option value={1}>1 (ej. 01 Aves)</option>
              <option value={2}>2 (ej. 0101 Pollos)</option>
              <option value={3}>3 (ej. 010101 Trutros)</option>
            </select>
          </label>
          {nivel > 1 && (
            <label>
              Categoría padre
              <select value={padreId} onChange={(e) => setPadreId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Elegir...</option>
                {padresDisponibles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Código
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
          </label>
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario">
              Crear categoría
            </button>
          </div>
        </form>
      </section>

      <table className="tabla">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Nivel</th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((c) => (
            <tr key={c.id}>
              <td>
                {"— ".repeat(c.nivel - 1)}
                {c.codigo}
              </td>
              <td>{c.nombre}</td>
              <td>{c.nivel}</td>
            </tr>
          ))}
          {categorias.length === 0 && (
            <tr>
              <td colSpan={3}>Todavía no hay categorías creadas.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

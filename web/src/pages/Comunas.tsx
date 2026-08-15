import { useEffect, useState } from "react";
import { api, formatoCLP, type Comuna } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function Comunas() {
  const [comunas, setComunas] = useState<Comuna[]>([]);
  const [nombre, setNombre] = useState("");
  const [costoEnvio, setCostoEnvio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editCosto, setEditCosto] = useState("");

  function cargar() {
    api.comunas.listar().then(setComunas).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    const costo = Number(costoEnvio);
    if (!nombre.trim() || Number.isNaN(costo) || costo < 0) {
      setError("Falta el nombre o el costo de envío no es válido");
      return;
    }
    try {
      await api.comunas.crear({ nombre: nombre.trim(), costoEnvio: costo });
      setNombre("");
      setCostoEnvio("");
      setMensaje("Comuna creada");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function comenzarEdicion(c: Comuna) {
    setEditandoId(c.id);
    setEditNombre(c.nombre);
    setEditCosto(String(c.costoEnvio));
  }

  async function guardarEdicion(id: number) {
    setError(null);
    const costo = Number(editCosto);
    if (!editNombre.trim() || Number.isNaN(costo) || costo < 0) {
      setError("Falta el nombre o el costo de envío no es válido");
      return;
    }
    try {
      await api.comunas.actualizar(id, { nombre: editNombre.trim(), costoEnvio: costo });
      setEditandoId(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function eliminar(id: number) {
    const confirmado = window.confirm("¿Eliminar esta comuna? Las ventas ya despachadas ahí no se ven afectadas.");
    if (!confirmado) return;
    try {
      await api.comunas.eliminar(id);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Comunas de despacho</h1>
      <p className="ayuda">
        Lista fija de comunas a las que se hace despacho, con su costo de envío — se usa al marcar una venta como
        "con despacho" en la Caja.
      </p>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <section className="tarjeta">
        <h2>Nueva comuna</h2>
        <form onSubmit={crear} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label>
            Costo de envío
            <input type="number" min="0" value={costoEnvio} onChange={(e) => setCostoEnvio(e.target.value)} required />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario">
              Crear comuna
            </button>
          </div>
        </form>
      </section>

      <table className="tabla">
        <thead>
          <tr>
            <th>Comuna</th>
            <th>Costo de envío</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {comunas.map((c) =>
            editandoId === c.id ? (
              <tr key={c.id}>
                <td>
                  <input value={editNombre} onChange={(e) => setEditNombre(e.target.value)} />
                </td>
                <td>
                  <input type="number" min="0" value={editCosto} onChange={(e) => setEditCosto(e.target.value)} />
                </td>
                <td className="fila-inline">
                  <button type="button" onClick={() => guardarEdicion(c.id)}>
                    Guardar
                  </button>
                  <button type="button" onClick={() => setEditandoId(null)}>
                    Cancelar
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{formatoCLP(c.costoEnvio)}</td>
                <td className="fila-inline">
                  <button type="button" onClick={() => comenzarEdicion(c)}>
                    Editar
                  </button>
                  <button type="button" className="boton-quitar-item" title="Eliminar" onClick={() => eliminar(c.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            )
          )}
          {comunas.length === 0 && (
            <tr>
              <td colSpan={3}>Todavía no hay comunas creadas.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

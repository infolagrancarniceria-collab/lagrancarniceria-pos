import { useEffect, useState } from "react";
import { api, FAMILIAS_CAMARA, type Comuna, type CorteOpcion, formatoCLP } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";

export default function Comunas() {
  const [comunas, setComunas] = useState<Comuna[]>([]);
  const [nombre, setNombre] = useState("");
  const [costoEnvio, setCostoEnvio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editCosto, setEditCosto] = useState("");

  const [cortes, setCortes] = useState<CorteOpcion[]>([]);
  const [corteFamilia, setCorteFamilia] = useState<string>(FAMILIAS_CAMARA[0]);
  const [corteNombre, setCorteNombre] = useState("");
  const [errorCortes, setErrorCortes] = useState<string | null>(null);

  function cargar() {
    api.comunas.listar().then(setComunas).catch((e) => setError(e.message));
  }

  function cargarCortes() {
    api.cortes.listar().then(setCortes).catch((e) => setErrorCortes(e.message));
  }

  useEffect(cargar, []);
  useEffect(cargarCortes, []);

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

  async function crearCorte(e: React.FormEvent) {
    e.preventDefault();
    setErrorCortes(null);
    if (!corteNombre.trim()) {
      setErrorCortes("Falta el nombre del corte");
      return;
    }
    try {
      await api.cortes.crear({ familia: corteFamilia, nombre: corteNombre.trim(), orden: cortes.length });
      setCorteNombre("");
      cargarCortes();
    } catch (e) {
      setErrorCortes((e as Error).message);
    }
  }

  async function eliminarCorte(id: number) {
    const confirmado = window.confirm("¿Eliminar esta opción de corte? Deja de mostrarse en la web.");
    if (!confirmado) return;
    try {
      await api.cortes.eliminar(id);
      cargarCortes();
    } catch (e) {
      setErrorCortes((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Comunas de despacho</h1>
      <p className="ayuda">
        Lista fija de comunas a las que se hace despacho, con su costo de envío — se usa al marcar una venta como
        "con despacho" en la Caja.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
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

      <h1>Opciones de corte (página web)</h1>
      <p className="ayuda">
        Para cada familia (Vacuno, Cerdo, etc.), las opciones de corte que se muestran en la web cuando un producto
        tiene esa familia asignada (ver "Familia de corte" en la ficha de un producto). Ej. familia Vacuno: Bifes,
        Trozo entero, Molida, Parrilla.
      </p>
      {errorCortes && <ModalAlerta mensaje={errorCortes} onCerrar={() => setErrorCortes(null)} />}

      <section className="tarjeta">
        <h2>Nueva opción de corte</h2>
        <form onSubmit={crearCorte} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            Familia
            <select value={corteFamilia} onChange={(e) => setCorteFamilia(e.target.value)}>
              {FAMILIAS_CAMARA.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre del corte
            <input
              value={corteNombre}
              onChange={(e) => setCorteNombre(e.target.value)}
              placeholder="ej. Bifes, Molida, Parrilla"
              required
            />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario">
              Agregar opción de corte
            </button>
          </div>
        </form>
      </section>

      <table className="tabla">
        <thead>
          <tr>
            <th>Familia</th>
            <th>Corte</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cortes.map((c) => (
            <tr key={c.id}>
              <td>{c.familia}</td>
              <td>{c.nombre}</td>
              <td className="fila-inline">
                <button type="button" className="boton-quitar-item" title="Eliminar" onClick={() => eliminarCorte(c.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {cortes.length === 0 && (
            <tr>
              <td colSpan={3}>Todavía no hay opciones de corte creadas.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

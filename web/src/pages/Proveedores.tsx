import { useEffect, useState } from "react";
import { api, type Proveedor } from "../api";

export default function Proveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function cargar() {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    try {
      await api.proveedores.crear({ nombre: nombre.trim(), contacto: contacto.trim() || null });
      setNombre("");
      setContacto("");
      setMensaje("Proveedor creado");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Proveedores</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <section className="tarjeta">
        <h2>Nuevo proveedor</h2>
        <form onSubmit={crear} className="formulario">
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label>
            Contacto
            <input value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="opcional" />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario">
              Crear proveedor
            </button>
          </div>
        </form>
      </section>

      <table className="tabla">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Contacto</th>
          </tr>
        </thead>
        <tbody>
          {proveedores.map((p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td>{p.contacto ?? "—"}</td>
            </tr>
          ))}
          {proveedores.length === 0 && (
            <tr>
              <td colSpan={2}>Todavía no hay proveedores creados.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

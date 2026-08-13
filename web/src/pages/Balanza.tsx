import { useEffect, useState } from "react";
import { api, type ResultadoActualizarBalanza } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function Balanza() {
  const [ip1, setIp1] = useState("");
  const [ip2, setIp2] = useState("");
  const [puerto, setPuerto] = useState(3001);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [actualizando, setActualizando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoActualizarBalanza | null>(null);
  const [errorActualizar, setErrorActualizar] = useState<string | null>(null);

  useEffect(() => {
    api.balanza
      .configuracion()
      .then((c) => {
        setIp1(c.ip1);
        setIp2(c.ip2);
        setPuerto(c.puerto);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setGuardando(true);
    try {
      await api.balanza.guardarConfiguracion({ ip1: ip1.trim(), ip2: ip2.trim(), puerto });
      setMensaje("Configuración guardada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function actualizarBalanza() {
    setErrorActualizar(null);
    setResultado(null);
    setActualizando(true);
    try {
      const r = await api.balanza.actualizar();
      setResultado(r);
    } catch (e) {
      setErrorActualizar((e as Error).message);
    } finally {
      setActualizando(false);
    }
  }

  return (
    <div>
      <h1>Balanza</h1>

      <section className="tarjeta">
        <h2>Actualizar balanza</h2>
        <p className="ayuda">
          Manda el catálogo completo de productos pesables e importe (precio, PLU, nombre) a las dos
          balanzas, por red.
        </p>
        {errorActualizar && <p className="error">{errorActualizar}</p>}
        <button type="button" className="boton boton-primario" onClick={actualizarBalanza} disabled={actualizando}>
          {actualizando ? "Actualizando..." : "Actualizar balanza"}
        </button>

        {resultado && (
          <div style={{ marginTop: "1rem" }}>
            <p className="ayuda">{resultado.cantidadProductos} productos enviados.</p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Balanza</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {resultado.resultados.map((r) => (
                  <tr key={r.ip} className={r.exito ? "" : "fila-error"}>
                    <td>{r.ip}</td>
                    <td className={r.exito ? "exito" : "error"}>{r.exito ? "OK" : r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>Configuración de red</h2>
        {error && <p className="error">{error}</p>}
        {mensaje && <p className="exito">{mensaje}</p>}
        <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            IP balanza 1
            <input type="text" value={ip1} onChange={(e) => setIp1(e.target.value)} placeholder="192.168.18.122" />
          </label>
          <label>
            IP balanza 2
            <input type="text" value={ip2} onChange={(e) => setIp2(e.target.value)} placeholder="192.168.18.120" />
          </label>
          <label>
            Puerto
            <input
              type="number"
              value={puerto}
              onChange={(e) => setPuerto(Number(e.target.value))}
              placeholder="3001"
            />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

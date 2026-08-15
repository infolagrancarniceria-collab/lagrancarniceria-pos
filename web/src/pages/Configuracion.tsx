import { useEffect, useState } from "react";
import { api } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function Configuracion() {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [direccionRed, setDireccionRed] = useState<{ direcciones: string[]; puerto: number } | null>(null);

  useEffect(() => {
    api.configuracion
      .estadoIA()
      .then((r) => setConfigurada(r.configurada))
      .catch((e) => setError(e.message));
    api.configuracion.direccionRed().then(setDireccionRed).catch(() => {});
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!clave.trim()) {
      setError("Pega la clave de API primero");
      return;
    }
    setGuardando(true);
    try {
      await api.configuracion.guardarClaveIA(clave.trim());
      setConfigurada(true);
      setClave("");
      setMensaje("Clave guardada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Configuración</h1>

      <section className="tarjeta">
        <h2>Conectar otro equipo (ej. un monitor en el mesón)</h2>
        <p className="ayuda">
          Este computador tiene que quedar prendido y con el programa abierto — actúa como el servidor para
          los demás equipos. En el otro equipo (conectado a la misma red WiFi), abre Chrome o Edge y entra a
          una de estas direcciones:
        </p>
        {direccionRed && direccionRed.direcciones.length > 0 ? (
          <ul>
            {direccionRed.direcciones.map((ip) => (
              <li key={ip}>
                <strong>
                  http://{ip}:{direccionRed.puerto}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ayuda">
            No se detectó una red local todavía — revisa que este computador esté conectado por WiFi o cable de
            red.
          </p>
        )}
        <p className="ayuda">
          Si no carga, puede que el Firewall de Windows esté bloqueando la conexión: ve a "Firewall de Windows
          Defender" → "Permitir una aplicación a través del firewall" y marca "La Gran Carnicería POS" en
          redes privadas.
        </p>
      </section>

      <section className="tarjeta">
        <h2>Asistente de IA</h2>
        <p className="ayuda">
          Acá se guarda la clave de API de Anthropic que usa el asistente (pantalla "Asistente") para
          responder preguntas y proponer cambios. La clave queda guardada solo en este computador, nunca
          se sube a ningún lado.
        </p>
        {configurada != null && (
          <p className={configurada ? "exito" : "error"}>
            {configurada ? "Ya hay una clave configurada." : "Todavía no hay una clave configurada."}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {mensaje && <p className="exito">{mensaje}</p>}

        <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            {configurada ? "Reemplazar clave de API" : "Clave de API de Anthropic"}
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              placeholder="sk-ant-..."
              autoComplete="off"
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

import { useEffect, useState } from "react";
import { api } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { modoCajaActivo, setModoCajaActivo } from "../lib/modoCaja";
import {
  obtenerImpresoraBoletas,
  obtenerImpresoraEtiquetas,
  setImpresoraBoletas,
  setImpresoraEtiquetas,
} from "../lib/impresoras";
import type { ImpresoraDisponible } from "../electron";

const PREDETERMINADA = "__predeterminada__";

export default function Configuracion() {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [direccionRed, setDireccionRed] = useState<{ direcciones: string[]; puerto: number } | null>(null);
  const [modoCaja, setModoCaja] = useState(() => modoCajaActivo());
  const [impresoras, setImpresoras] = useState<ImpresoraDisponible[] | null>(null);
  const [impresoraBoletas, setImpresoraBoletasState] = useState(() => obtenerImpresoraBoletas() ?? PREDETERMINADA);
  const [impresoraEtiquetas, setImpresoraEtiquetasState] = useState(
    () => obtenerImpresoraEtiquetas() ?? PREDETERMINADA
  );

  function cambiarModoCaja(activo: boolean) {
    setModoCajaActivo(activo);
    setModoCaja(activo);
    // El menú y la pantalla de inicio se arman al cargar la página — un
    // recargue simple asegura que el cambio se vea de inmediato en este PC.
    window.location.reload();
  }

  useEffect(() => {
    api.configuracion
      .estadoIA()
      .then((r) => setConfigurada(r.configurada))
      .catch((e) => setError(e.message));
    api.configuracion.direccionRed().then(setDireccionRed).catch(() => {});
    window.electronAPI?.listarImpresoras().then(setImpresoras).catch(() => setImpresoras([]));
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
        <h2>Modo caja exclusiva</h2>
        <p className="ayuda">
          Pensado para un PC que se usa solo para cobrar (ej. el mesón de atención): esconde el resto del menú
          (Productos, Inventario, Reportes, etc.) y deja solo Caja, Créditos y esta pantalla de Configuración —
          así se puede volver a desactivarlo cuando haga falta. Es una preferencia de <strong>este PC</strong>{" "}
          nada más (no afecta a otros equipos ni queda guardada en la base de datos).
        </p>
        <label className="fila-inline">
          <input type="checkbox" checked={modoCaja} onChange={(e) => cambiarModoCaja(e.target.checked)} />
          Activar modo caja exclusiva en este PC
        </label>
      </section>

      {window.electronAPI && (
        <section className="tarjeta">
          <h2>Impresoras</h2>
          <p className="ayuda">
            Elige qué impresora usar para cada cosa en <strong>este PC</strong>. Si dejas "La predeterminada de
            Windows", el sistema manda el trabajo a la que esté puesta como predeterminada — que no siempre es
            la que se espera si hay más de una impresora conectada (o alguna virtual, como "Microsoft Print to
            PDF"). Elegirla acá evita esa confusión.
          </p>
          {impresoras == null && <p className="ayuda">Buscando impresoras conectadas...</p>}
          {impresoras != null && impresoras.length === 0 && (
            <p className="error">No se detectó ninguna impresora en este PC — revisa que esté conectada y encendida.</p>
          )}
          {impresoras != null && impresoras.length > 0 && (
            <div className="formulario">
              <label>
                Boletas de venta (ticket)
                <select
                  value={impresoraBoletas}
                  onChange={(e) => {
                    setImpresoraBoletasState(e.target.value);
                    setImpresoraBoletas(e.target.value === PREDETERMINADA ? null : e.target.value);
                  }}
                >
                  <option value={PREDETERMINADA}>La predeterminada de Windows</option>
                  {impresoras.map((imp) => (
                    <option key={imp.name} value={imp.name}>
                      {imp.displayName || imp.name}
                      {imp.isDefault ? " (predeterminada)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etiquetas de cámara (100×50mm)
                <select
                  value={impresoraEtiquetas}
                  onChange={(e) => {
                    setImpresoraEtiquetasState(e.target.value);
                    setImpresoraEtiquetas(e.target.value === PREDETERMINADA ? null : e.target.value);
                  }}
                >
                  <option value={PREDETERMINADA}>La predeterminada de Windows</option>
                  {impresoras.map((imp) => (
                    <option key={imp.name} value={imp.name}>
                      {imp.displayName || imp.name}
                      {imp.isDefault ? " (predeterminada)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </section>
      )}

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

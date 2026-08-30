import { useEffect, useState } from "react";
import { api, type EstadoRespaldo } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { modoCajaActivo, setModoCajaActivo } from "../lib/modoCaja";
import {
  obtenerImpresoraBoletas,
  setImpresoraBoletas,
  obtenerImpresoraEtiquetas,
  setImpresoraEtiquetas,
  obtenerImpresoraPedidosWeb,
  setImpresoraPedidosWeb,
} from "../lib/impresoras";
import type { ImpresoraDisponible } from "../electron";
import ModalAlerta from "../components/ModalAlerta";
import { mostrarToast } from "../lib/toast";

const PREDETERMINADA = "__predeterminada__";

export default function Configuracion() {
  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [syncWebConfigurada, setSyncWebConfigurada] = useState<boolean | null>(null);
  const [syncWebUrl, setSyncWebUrl] = useState("");
  const [syncWebClave, setSyncWebClave] = useState("");
  const [errorSyncWeb, setErrorSyncWeb] = useState<string | null>(null);
  const [mensajeSyncWeb, setMensajeSyncWeb] = useState<string | null>(null);
  const [guardandoSyncWeb, setGuardandoSyncWeb] = useState(false);
  const [direccionRed, setDireccionRed] = useState<{ direcciones: string[]; puerto: number } | null>(null);
  const [modoCaja, setModoCaja] = useState(() => modoCajaActivo());
  const [impresoras, setImpresoras] = useState<ImpresoraDisponible[] | null>(null);
  const [impresoraBoletas, setImpresoraBoletasState] = useState(() => obtenerImpresoraBoletas() ?? PREDETERMINADA);
  const [impresoraEtiquetas, setImpresoraEtiquetasState] = useState(
    () => obtenerImpresoraEtiquetas() ?? PREDETERMINADA
  );
  const [impresoraPedidosWeb, setImpresoraPedidosWebState] = useState(
    () => obtenerImpresoraPedidosWeb() ?? PREDETERMINADA
  );
  const [estadoRespaldo, setEstadoRespaldo] = useState<EstadoRespaldo | null>(null);
  const [rutaUsbInput, setRutaUsbInput] = useState("");
  const [guardandoRutaUsb, setGuardandoRutaUsb] = useState(false);
  const [respaldando, setRespaldando] = useState(false);
  const [errorRespaldo, setErrorRespaldo] = useState<string | null>(null);
  // Aviso de "el USB no estaba conectado" tras apretar "Respaldar ahora" —
  // no se guarda en la base de datos a propósito (para poder reintentar
  // solo apenas se conecte, ver ejecutarRespaldo en el servidor), así que
  // solo se puede mostrar como aviso puntual de esta respuesta, no como
  // parte del estado persistido que se recarga después.
  const [avisoUsb, setAvisoUsb] = useState<string | null>(null);

  function cambiarModoCaja(activo: boolean) {
    setModoCajaActivo(activo);
    setModoCaja(activo);
    // El menú y la pantalla de inicio se arman al cargar la página — un
    // recargue simple asegura que el cambio se vea de inmediato en este PC.
    window.location.reload();
  }

  function cargarEstadoRespaldo() {
    api.configuracion
      .estadoRespaldo()
      .then((r) => {
        setEstadoRespaldo(r);
        setRutaUsbInput(r.rutaUsb ?? "");
      })
      .catch((e) => setErrorRespaldo(e.message));
  }

  useEffect(() => {
    api.configuracion
      .estadoIA()
      .then((r) => setConfigurada(r.configurada))
      .catch((e) => setError(e.message));
    api.configuracion.direccionRed().then(setDireccionRed).catch(() => {});
    window.electronAPI?.listarImpresoras().then(setImpresoras).catch(() => setImpresoras([]));
    cargarEstadoRespaldo();
    api.configuracion
      .estadoSyncWeb()
      .then((r) => {
        setSyncWebConfigurada(r.configurada);
        if (r.webSyncUrl) setSyncWebUrl(r.webSyncUrl);
      })
      .catch((e) => setErrorSyncWeb(e.message));
  }, []);

  async function elegirCarpetaUsb() {
    const carpeta = await window.electronAPI?.elegirCarpeta();
    if (!carpeta) return;
    setRutaUsbInput(carpeta);
    await guardarRutaUsb(carpeta);
  }

  async function guardarRutaUsb(ruta: string | null) {
    setErrorRespaldo(null);
    setAvisoUsb(null);
    setGuardandoRutaUsb(true);
    try {
      await api.configuracion.guardarRutaUsbRespaldo(ruta);
      cargarEstadoRespaldo();
    } catch (e) {
      setErrorRespaldo((e as Error).message);
    } finally {
      setGuardandoRutaUsb(false);
    }
  }

  async function respaldarAhora() {
    setErrorRespaldo(null);
    setAvisoUsb(null);
    setRespaldando(true);
    try {
      const resultado = await api.configuracion.respaldarAhora();
      if (!resultado.local.ok) {
        setErrorRespaldo(`Falló el respaldo local: ${resultado.local.error ?? "error desconocido"}`);
      } else if (resultado.usb && !resultado.usb.ok) {
        if (resultado.usb.omitido) {
          setAvisoUsb(resultado.usb.error ?? "No se pudo respaldar al USB en este momento.");
        } else {
          setErrorRespaldo(`Falló el respaldo a USB: ${resultado.usb.error ?? "error desconocido"}`);
        }
      } else {
        mostrarToast("Respaldo hecho correctamente");
      }
      cargarEstadoRespaldo();
    } catch (e) {
      setErrorRespaldo((e as Error).message);
    } finally {
      setRespaldando(false);
    }
  }

  function formatoFechaHora(iso: string | null): string {
    if (!iso) return "nunca";
    return new Date(iso).toLocaleString("es-CL");
  }

  async function guardarSyncWeb(e: React.FormEvent) {
    e.preventDefault();
    setErrorSyncWeb(null);
    setMensajeSyncWeb(null);
    if (!syncWebUrl.trim() || !syncWebClave.trim()) {
      setErrorSyncWeb("Completa la URL de la web y la llave de sync");
      return;
    }
    setGuardandoSyncWeb(true);
    try {
      await api.configuracion.guardarSyncWeb({ webSyncUrl: syncWebUrl.trim(), syncApiKey: syncWebClave.trim() });
      setSyncWebConfigurada(true);
      setSyncWebClave("");
      setMensajeSyncWeb("Guardado — sincronizando el catálogo ahora mismo.");
    } catch (e) {
      setErrorSyncWeb((e as Error).message);
    } finally {
      setGuardandoSyncWeb(false);
    }
  }

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
          (Productos, Inventario, Reportes, etc.) y deja solo Caja, Créditos, Pedidos web y esta pantalla de
          Configuración — así se puede volver a desactivarlo cuando haga falta. Es una preferencia de{" "}
          <strong>este PC</strong> nada más (no afecta a otros equipos ni queda guardada en la base de datos).
        </p>
        <label className="fila-inline">
          <input type="checkbox" checked={modoCaja} onChange={(e) => cambiarModoCaja(e.target.checked)} />
          Activar modo caja exclusiva en este PC
        </label>
      </section>

      <section className="tarjeta">
        <h2>Respaldo de la base de datos</h2>
        <p className="ayuda">
          Todos los días se guarda una copia completa de la base de datos (ventas, precios, inventario, todo) sin
          que haya que hacer nada — se conservan los últimos 30 días de cada destino, borrando solos los más
          viejos. Las carpetas de respaldo siempre son las de <strong>el PC principal</strong> (el que actúa de
          servidor), no las del equipo que estés usando para ver esta pantalla.
        </p>
        {errorRespaldo && <ModalAlerta mensaje={errorRespaldo} onCerrar={() => setErrorRespaldo(null)} />}

        <div className="fila-inline">
          <div>
            <strong>Local (en este PC):</strong>{" "}
            {estadoRespaldo?.local.ultimoEn ? (
              <span className={estadoRespaldo.local.ok ? "exito" : "error"}>
                {estadoRespaldo.local.ok ? "✓" : "✗"} {formatoFechaHora(estadoRespaldo.local.ultimoEn)}
              </span>
            ) : (
              <span className="ayuda">todavía no se ha hecho ninguno</span>
            )}
            {estadoRespaldo?.local.ok === false && estadoRespaldo.local.error && (
              <div className="ayuda">{estadoRespaldo.local.error}</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <strong>USB / disco externo (opcional):</strong>{" "}
          {estadoRespaldo?.rutaUsb ? (
            estadoRespaldo.usb.ultimoEn ? (
              <span className={estadoRespaldo.usb.ok ? "exito" : "error"}>
                {estadoRespaldo.usb.ok ? "✓" : "✗"} {formatoFechaHora(estadoRespaldo.usb.ultimoEn)}
              </span>
            ) : (
              <span className="ayuda">todavía no se ha hecho ninguno</span>
            )
          ) : (
            <span className="ayuda">sin configurar</span>
          )}
          {estadoRespaldo?.rutaUsb && estadoRespaldo.usb.ok === false && estadoRespaldo.usb.error && (
            <div className="ayuda">{estadoRespaldo.usb.error}</div>
          )}
          <p className="ayuda">
            Si el USB no está conectado el día que toca respaldar, no es un error — simplemente se hace apenas
            vuelva a estar conectado.
          </p>
          {avisoUsb && <p className="ayuda">⚠ {avisoUsb}</p>}
          <div className="fila-inline">
            {window.electronAPI ? (
              <button type="button" className="boton" onClick={elegirCarpetaUsb} disabled={guardandoRutaUsb}>
                {estadoRespaldo?.rutaUsb ? "Cambiar carpeta..." : "Elegir carpeta..."}
              </button>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Ej: E:\Respaldos"
                  value={rutaUsbInput}
                  onChange={(e) => setRutaUsbInput(e.target.value)}
                />
                <button
                  type="button"
                  className="boton"
                  disabled={guardandoRutaUsb || !rutaUsbInput.trim()}
                  onClick={() => guardarRutaUsb(rutaUsbInput.trim())}
                >
                  Guardar
                </button>
              </>
            )}
            {estadoRespaldo?.rutaUsb && (
              <button type="button" className="boton" disabled={guardandoRutaUsb} onClick={() => guardarRutaUsb(null)}>
                Quitar
              </button>
            )}
          </div>
        </div>

        <div className="acciones-formulario">
          <button type="button" className="boton boton-primario" disabled={respaldando} onClick={respaldarAhora}>
            {respaldando ? "Respaldando..." : "Respaldar ahora"}
          </button>
        </div>
      </section>

      {window.electronAPI && (
        <section className="tarjeta">
          <h2>Impresoras</h2>
          <p className="ayuda">
            Elige qué impresora usar para las boletas, las etiquetas de cámara y los pedidos web en{" "}
            <strong>este PC</strong> (pueden ser la misma o distintas — por ejemplo, si revisas Pedidos web desde el
            PC servidor, acá puedes apuntar a la impresora que esté conectada a ese equipo, sin depender de la
            impresora de boletas del mesón). Si dejas "La predeterminada de Windows", el sistema manda el trabajo a
            la que esté puesta como predeterminada — que no siempre es la que se espera si hay más de una
            impresora conectada (o alguna virtual, como "Microsoft Print to PDF"), o directamente no imprime nada
            si este equipo no tiene ninguna impresora conectada. Elegirla acá evita esa confusión.
          </p>
          <p className="ayuda">
            Si la impresora elegida no soporta imprimir sin diálogo (pasa con algunas impresoras térmicas), el
            sistema cae de vuelta solo al diálogo normal de Windows en vez de fallar — hay que confirmar ahí
            quién imprime, pero la boleta o la etiqueta sí sale igual.
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
                Etiquetas de cámara
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
              <label>
                Pedidos web
                <select
                  value={impresoraPedidosWeb}
                  onChange={(e) => {
                    setImpresoraPedidosWebState(e.target.value);
                    setImpresoraPedidosWeb(e.target.value === PREDETERMINADA ? null : e.target.value);
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
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
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

      <section className="tarjeta">
        <h2>Sincronización con la página web</h2>
        <p className="ayuda">
          Conecta este POS con lagrancarniceria.cl: manda el catálogo de productos visibles, las comunas de
          despacho y las opciones de corte, y trae los pedidos que los clientes arman en la web (pantalla
          "Pedidos web"). La llave se guarda solo en este computador.
        </p>
        {syncWebConfigurada != null && (
          <p className={syncWebConfigurada ? "exito" : "error"}>
            {syncWebConfigurada ? "Ya está conectado con la web." : "Todavía no está conectado con la web."}
          </p>
        )}
        {errorSyncWeb && <ModalAlerta mensaje={errorSyncWeb} onCerrar={() => setErrorSyncWeb(null)} />}
        {mensajeSyncWeb && <p className="exito">{mensajeSyncWeb}</p>}

        <form onSubmit={guardarSyncWeb} onKeyDown={manejarEnterComoTab} className="formulario">
          <label>
            URL de la web
            <input
              value={syncWebUrl}
              onChange={(e) => setSyncWebUrl(e.target.value)}
              placeholder="https://lagrancarniceria.cl"
            />
          </label>
          <label>
            {syncWebConfigurada ? "Reemplazar llave de sync" : "Llave de sync"}
            <input
              type="password"
              value={syncWebClave}
              onChange={(e) => setSyncWebClave(e.target.value)}
              placeholder="La llave que te dieron al conectar la web"
              autoComplete="off"
            />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={guardandoSyncWeb}>
              {guardandoSyncWeb ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

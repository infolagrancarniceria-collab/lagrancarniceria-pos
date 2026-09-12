import { useEffect, useMemo, useState } from "react";
import { api, type ResultadoActualizarBalanza } from "../api";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import ModalAlerta from "../components/ModalAlerta";

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
  const [busquedaDetalle, setBusquedaDetalle] = useState("");

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
    setBusquedaDetalle("");
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

  const detalleFiltrado = useMemo(() => {
    if (!resultado) return [];
    const texto = busquedaDetalle.trim().toLowerCase();
    if (!texto) return resultado.detalle;
    return resultado.detalle.filter(
      (d) => d.descripcion.toLowerCase().includes(texto) || d.plu.toLowerCase().includes(texto)
    );
  }, [resultado, busquedaDetalle]);

  return (
    <div>
      <h1>Balanza</h1>

      <section className="tarjeta">
        <h2>Actualizar balanza</h2>
        <p className="ayuda">
          Manda el catálogo completo de productos pesables e importe (precio, PLU, nombre) a las dos
          balanzas, por red.
        </p>
        {errorActualizar && <ModalAlerta mensaje={errorActualizar} onCerrar={() => setErrorActualizar(null)} />}
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

            <h3 style={{ marginTop: "1.5rem" }}>Detalle de lo enviado</h3>
            <p className="ayuda">
              Busca un producto para confirmar el precio exacto que se mandó en este envío — útil cuando la
              balanza responde "OK" pero un producto puntual no muestra el precio nuevo, para descartar que el
              dato enviado desde el POS ya estuviera mal.
            </p>
            <input
              type="text"
              value={busquedaDetalle}
              onChange={(e) => setBusquedaDetalle(e.target.value)}
              placeholder="Buscar por nombre o PLU..."
              style={{ marginBottom: "0.75rem" }}
            />
            <table className="tabla">
              <thead>
                <tr>
                  <th>PLU</th>
                  <th>Producto</th>
                  <th>Precio enviado</th>
                  <th>Unidad</th>
                  <th>Incluido</th>
                </tr>
              </thead>
              <tbody>
                {detalleFiltrado.length === 0 && (
                  <tr>
                    <td colSpan={5}>Sin resultados.</td>
                  </tr>
                )}
                {detalleFiltrado.map((d) => (
                  <tr key={d.plu} className={d.incluido ? "" : "fila-error"}>
                    <td>{d.plu}</td>
                    <td>{d.descripcion}</td>
                    <td>${d.precioEnviado.toLocaleString("es-CL")}</td>
                    <td>{d.unidad === "KGM" ? "Por kilo" : d.unidad === "PCS" ? "Por unidad" : "—"}</td>
                    <td className={d.incluido ? "exito" : "error"}>{d.incluido ? "Sí" : "No se envió"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta">
        <h2>Configuración de red</h2>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
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

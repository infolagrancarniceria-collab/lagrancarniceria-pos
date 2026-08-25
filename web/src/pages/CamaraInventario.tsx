import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type DetalleSesionInventarioCamara,
  type ResultadoCierreSesionCamara,
  type SesionInventarioCamara,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";
import ModalAlerta from "../components/ModalAlerta";

export default function CamaraInventario() {
  const { usuario } = useUsuario();

  const [sesion, setSesion] = useState<SesionInventarioCamara | null>(null);
  const [detalle, setDetalle] = useState<DetalleSesionInventarioCamara | null>(null);
  const [buscandoSesion, setBuscandoSesion] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ultimoEscaneo, setUltimoEscaneo] = useState<{ numero: string; producto: string; esperada: boolean; yaEscaneada: boolean } | null>(
    null
  );

  const [cerrando, setCerrando] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [reporteCierre, setReporteCierre] = useState<ResultadoCierreSesionCamara | null>(null);

  async function cargarDetalle(id: number) {
    const d = await api.camara.detalleSesionInventario(id);
    setDetalle(d);
  }

  useEffect(() => {
    (async () => {
      try {
        const abiertas = await api.camara.sesionesInventario({ estado: "abierta" });
        if (abiertas.length > 0) {
          setSesion(abiertas[0]);
          await cargarDetalle(abiertas[0].id);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBuscandoSesion(false);
      }
    })();
  }, []);

  async function iniciarConteo() {
    if (!usuario) return;
    setError(null);
    try {
      const creada = await api.camara.abrirSesionInventario(usuario.id);
      setSesion(creada);
      await cargarDetalle(creada.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function escanear(codigo: string) {
    if (!sesion || !usuario) return;
    setError(null);
    try {
      const resultado = await api.camara.escanearInventario(sesion.id, { codigo, usuarioId: usuario.id });
      setUltimoEscaneo({
        numero: String(resultado.caja.id).padStart(6, "0"),
        producto: resultado.caja.producto.descripcion,
        esperada: resultado.esperada,
        yaEscaneada: resultado.yaEscaneada,
      });
      await cargarDetalle(sesion.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEscanerCodigoBarras(escanear, !!sesion && sesion.estado === "abierta" && !reporteCierre);

  async function cerrarConteo(e: React.FormEvent) {
    e.preventDefault();
    if (!sesion || !usuario) return;
    setError(null);
    setCerrando(true);
    try {
      const reporte = await api.camara.cerrarSesionInventario(sesion.id, {
        usuarioId: usuario.id,
        observaciones: observaciones.trim() || undefined,
      });
      setReporteCierre(reporte);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCerrando(false);
    }
  }

  function nuevoConteo() {
    setSesion(null);
    setDetalle(null);
    setUltimoEscaneo(null);
    setReporteCierre(null);
    setObservaciones("");
    setError(null);
  }

  if (buscandoSesion) {
    return <p className="ayuda">Buscando si hay un conteo abierto...</p>;
  }

  if (reporteCierre) {
    return (
      <div>
        <div className="encabezado-pantalla">
          <h1>Conteo cerrado</h1>
          <Link to="/camara" className="boton">
            Volver a Cámara
          </Link>
        </div>
        <section className="tarjeta">
          <p>
            Se esperaban <strong>{reporteCierre.totalEsperadas}</strong> caja(s), se escanearon{" "}
            <strong>{reporteCierre.totalEscaneadas}</strong>.
          </p>

          <h3>Faltantes ({reporteCierre.faltantes.length})</h3>
          {reporteCierre.faltantes.length === 0 ? (
            <p className="exito">Ninguna — todo lo esperado se escaneó.</p>
          ) : (
            <>
              <p className="error">
                Estas cajas quedaron marcadas "ajuste_pendiente" — resuélvelas en{" "}
                <Link to="/camara/ajustes-pendientes">Ajustes pendientes</Link>.
              </p>
              <ul>
                {reporteCierre.faltantes.map((c) => (
                  <li key={c.id}>
                    Caja {String(c.id).padStart(6, "0")} — {c.producto.descripcion} ({c.saldoKg.toFixed(3)} kg)
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Escaneadas pero no esperadas ({reporteCierre.noEsperadas.length})</h3>
          {reporteCierre.noEsperadas.length === 0 ? (
            <p className="ayuda">Ninguna.</p>
          ) : (
            <ul>
              {reporteCierre.noEsperadas.map((c) => (
                <li key={c.id}>
                  Caja {String(c.id).padStart(6, "0")} — {c.producto.descripcion} (estado: {c.estado})
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="boton boton-primario" onClick={nuevoConteo}>
            Volver a Cámara
          </button>
        </section>
      </div>
    );
  }

  if (!sesion) {
    return (
      <div>
        <div className="encabezado-pantalla">
          <h1>Inventario por escaneo</h1>
          <Link to="/camara" className="boton">
            Volver a Cámara
          </Link>
        </div>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        <section className="tarjeta">
          <p className="ayuda">
            Al iniciar un conteo, el sistema guarda una foto de qué cajas deberían estar en cámara ahora mismo. A
            medida que vayas escaneando las etiquetas de las cajas físicas, se van comparando contra esa foto.
          </p>
          <button type="button" className="boton boton-primario" onClick={iniciarConteo}>
            Iniciar conteo
          </button>
        </section>
      </div>
    );
  }

  const totalEsperadas = detalle?.esperados.length ?? 0;
  const totalEscaneadas = detalle?.escaneos.length ?? 0;

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Inventario por escaneo — conteo #{sesion.id}</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <section className="tarjeta">
        <p>
          Escaneadas <strong>{totalEscaneadas}</strong> de <strong>{totalEsperadas}</strong> esperadas.
        </p>
        <p className="ayuda">Escanea el código de barras de cada caja física — no hace falta hacer clic en nada.</p>

        {ultimoEscaneo && (
          <p className={ultimoEscaneo.esperada ? "exito" : "error"}>
            Caja {ultimoEscaneo.numero} — {ultimoEscaneo.producto}
            {ultimoEscaneo.yaEscaneada && " (ya estaba escaneada, no se duplicó)"}
            {!ultimoEscaneo.esperada && " — no estaba en la foto esperada de este conteo"}
          </p>
        )}
      </section>

      {detalle && detalle.escaneos.length > 0 && (
        <section className="tarjeta">
          <h3>Escaneadas en este conteo</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Producto</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              {detalle.escaneos.map((e) => (
                <tr key={e.id}>
                  <td>{String(e.cajaId).padStart(6, "0")}</td>
                  <td>{e.caja.producto.descripcion}</td>
                  <td>{new Date(e.escaneadoEn).toLocaleTimeString("es-CL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="tarjeta">
        <h3>Cerrar conteo</h3>
        <form onSubmit={cerrarConteo} className="formulario">
          <label>
            Observaciones (opcional)
            <input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </label>
          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={cerrando}>
              {cerrando ? "Cerrando..." : "Cerrar conteo y ver reporte"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

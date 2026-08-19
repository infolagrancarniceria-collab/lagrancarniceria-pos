import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type GrupoImportacionCamara, type Producto, type PrevisualizacionImportacionCamara, type ResultadoImportacionCamara } from "../api";
import { useUsuario } from "../context/UsuarioContext";

function SelectorProducto({
  grupo,
  productoId,
  onElegir,
}: {
  grupo: GrupoImportacionCamara;
  productoId: number | null;
  onElegir: (productoId: number | null) => void;
}) {
  const [buscar, setBuscar] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [elegido, setElegido] = useState<{ id: number; descripcion: string } | null>(
    grupo.productoIdSugerido ? { id: grupo.productoIdSugerido, descripcion: grupo.productoSugerido ?? "" } : null
  );

  async function buscarProductos(texto: string) {
    setBuscar(texto);
    if (!texto.trim()) {
      setResultados([]);
      return;
    }
    const r = await api.productos.listar({ buscar: texto });
    setResultados(r);
  }

  if (elegido) {
    return (
      <span>
        {elegido.descripcion}{" "}
        <button
          type="button"
          className="boton-chico"
          onClick={() => {
            setElegido(null);
            onElegir(null);
          }}
        >
          Cambiar
        </button>
      </span>
    );
  }

  return (
    <div className="buscador-producto">
      <input
        type="text"
        placeholder="Buscar producto..."
        value={buscar}
        onChange={(e) => buscarProductos(e.target.value)}
      />
      {buscar.trim() && (
        <div className="resultados-busqueda">
          {resultados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              className="resultado-item"
              onClick={() => {
                setElegido({ id: p.id, descripcion: p.descripcion });
                setBuscar("");
                setResultados([]);
                onElegir(p.id);
              }}
            >
              {p.plu} — {p.descripcion}
            </button>
          ))}
        </div>
      )}
      <p className="ayuda">Sin elegir producto, las {grupo.cantidadCajas} caja(s) de "{grupo.producto}" se omiten.</p>
    </div>
  );
}

export default function CamaraImportar() {
  const { usuario } = useUsuario();

  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [previsualizacion, setPrevisualizacion] = useState<PrevisualizacionImportacionCamara | null>(null);
  const [mapeo, setMapeo] = useState<Record<string, number | null>>({});
  const [resultado, setResultado] = useState<ResultadoImportacionCamara | null>(null);

  async function leerArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const texto = await archivo.text();
    setJson(texto);
  }

  async function previsualizar() {
    setError(null);
    setResultado(null);
    setCargando(true);
    try {
      const r = await api.camara.previsualizarImportacion(json);
      setPrevisualizacion(r);
      const inicial: Record<string, number | null> = {};
      for (const g of r.grupos) inicial[g.clave] = g.productoIdSugerido;
      setMapeo(inicial);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!usuario || !previsualizacion) return;
    setError(null);
    setCargando(true);
    try {
      const r = await api.camara.confirmarImportacion({
        json,
        usuarioId: usuario.id,
        mapeo: previsualizacion.grupos.map((g) => ({ clave: g.clave, productoId: mapeo[g.clave] ?? null })),
      });
      setResultado(r);
      setPrevisualizacion(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  function nuevaImportacion() {
    setJson("");
    setPrevisualizacion(null);
    setMapeo({});
    setResultado(null);
    setError(null);
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Importar del sistema anterior</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <p className="error">{error}</p>}

      {resultado && (
        <section className="tarjeta">
          <p className="exito">Se importaron {resultado.importadas} caja(s) correctamente.</p>
          {resultado.omitidasPorConflicto.length > 0 && (
            <p className="error">
              {resultado.omitidasPorConflicto.length} caja(s) se omitieron porque ese número ya existía en el
              sistema nuevo: {resultado.omitidasPorConflicto.map((id) => String(id).padStart(6, "0")).join(", ")}.
            </p>
          )}
          {resultado.omitidasPorProducto.length > 0 && (
            <p className="error">
              {resultado.omitidasPorProducto.length} caja(s) se omitieron porque no se eligió un producto para su
              grupo: {resultado.omitidasPorProducto.map((id) => String(id).padStart(6, "0")).join(", ")}.
            </p>
          )}
          <button type="button" className="boton boton-primario" onClick={nuevaImportacion}>
            Importar otro archivo
          </button>
        </section>
      )}

      {!resultado && !previsualizacion && (
        <section className="tarjeta">
          <p className="ayuda">
            Para traer las cajas ya registradas en el sistema anterior (camara_actual_referencia.html): abre ese
            archivo en el navegador, presiona F12 para abrir la consola, escribe{" "}
            <code>copy(localStorage.getItem('granCarniceria_camara_v1')))</code> y presiona Enter (copia el
            contenido solo). Pega ese contenido acá abajo, o súbelo como archivo .json si lo guardaste aparte.
          </p>
          <label>
            Archivo .json (opcional)
            <input type="file" accept=".json,application/json" onChange={leerArchivo} />
          </label>
          <label>
            Contenido pegado
            <textarea rows={8} value={json} onChange={(e) => setJson(e.target.value)} placeholder="Pega acá el JSON exportado..." />
          </label>
          <div className="acciones-formulario">
            <button type="button" className="boton boton-primario" onClick={previsualizar} disabled={cargando || !json.trim()}>
              {cargando ? "Revisando..." : "Previsualizar importación"}
            </button>
          </div>
        </section>
      )}

      {previsualizacion && (
        <section className="tarjeta">
          <p>
            Se encontraron <strong>{previsualizacion.totalCajas}</strong> caja(s) en el archivo.
          </p>
          {previsualizacion.cajasConConflicto.length > 0 && (
            <p className="error">
              {previsualizacion.cajasConConflicto.length} caja(s) ya existen con ese mismo número en el sistema
              nuevo y se van a omitir automáticamente:{" "}
              {previsualizacion.cajasConConflicto.map((id) => String(id).padStart(6, "0")).join(", ")}.
            </p>
          )}

          <h3>Elige a qué producto del catálogo nuevo corresponde cada uno</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>Familia</th>
                <th>Producto (nombre anterior)</th>
                <th>Cajas</th>
                <th>Producto en el sistema nuevo</th>
              </tr>
            </thead>
            <tbody>
              {previsualizacion.grupos.map((g) => (
                <tr key={g.clave}>
                  <td>{g.familia}</td>
                  <td>{g.producto}</td>
                  <td>{g.cantidadCajas}</td>
                  <td>
                    <SelectorProducto
                      grupo={g}
                      productoId={mapeo[g.clave] ?? null}
                      onElegir={(productoId) => setMapeo((prev) => ({ ...prev, [g.clave]: productoId }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="acciones-formulario">
            <button type="button" className="boton boton-primario" onClick={confirmar} disabled={cargando}>
              {cargando ? "Importando..." : "Confirmar importación"}
            </button>
            <button type="button" className="boton" onClick={nuevaImportacion} disabled={cargando}>
              Cancelar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

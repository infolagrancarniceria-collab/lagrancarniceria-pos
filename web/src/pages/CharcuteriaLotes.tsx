import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type EstadoLoteProduccion, type LoteProduccion, type Receta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const ETIQUETAS_ESTADO: Record<EstadoLoteProduccion, string> = {
  en_proceso: "En proceso",
  terminado: "Terminado",
  envasado: "Envasado",
  cerrado: "Cerrado",
  anulado: "Anulado",
};

export default function CharcuteriaLotes() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();
  const [lotes, setLotes] = useState<LoteProduccion[]>([]);
  const [recetasActivas, setRecetasActivas] = useState<Receta[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<EstadoLoteProduccion | "">("");
  const [recetaId, setRecetaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  function cargar() {
    api.charcuteria.lotes.listar(filtroEstado || undefined).then(setLotes).catch((e) => setError(e.message));
    api.charcuteria.recetas.listar({ soloActivas: true }).then(setRecetasActivas);
  }

  useEffect(cargar, [filtroEstado]);

  async function crearLote() {
    if (!usuario || !recetaId) {
      setError("Elige una receta");
      return;
    }
    setCreando(true);
    setError(null);
    try {
      const lote = await api.charcuteria.lotes.crear(usuario.id, Number(recetaId));
      mostrarToast("Lote creado", `Código ${lote.codigo}.`);
      navigate(`/charcuteria/lotes/${lote.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div>
      <h1>Lotes de producción</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta fila-inline">
        <select value={recetaId} onChange={(e) => setRecetaId(e.target.value)}>
          <option value="">— elegir receta —</option>
          {recetasActivas.map((r) => (
            <option key={r.id} value={r.id}>
              {r.productoElaborado.nombre} (v{r.version})
            </option>
          ))}
        </select>
        <button type="button" className="boton boton-primario" onClick={crearLote} disabled={creando}>
          {creando ? "Creando..." : "+ Crear lote nuevo"}
        </button>
      </div>

      <div className="chips-categoria">
        {(["", "en_proceso", "terminado", "envasado", "cerrado", "anulado"] as const).map((e) => (
          <button
            key={e}
            type="button"
            className={`chip-categoria${filtroEstado === e ? " activo" : ""}`}
            onClick={() => setFiltroEstado(e)}
          >
            {e === "" ? "Todos" : ETIQUETAS_ESTADO[e]}
          </button>
        ))}
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Código</th>
            <th>Producto elaborado</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th>Vencimiento</th>
            <th>Merma real</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lotes.map((l) => (
            <tr key={l.id}>
              <td>{l.codigo}</td>
              <td>{l.receta.productoElaborado.nombre}</td>
              <td>{ETIQUETAS_ESTADO[l.estado]}</td>
              <td>{new Date(l.fechaElaboracion).toLocaleDateString("es-CL")}</td>
              <td>{l.fechaVencimiento ? new Date(l.fechaVencimiento).toLocaleDateString("es-CL") : "—"}</td>
              <td>{l.mermaRealPct != null ? `${l.mermaRealPct}%` : "—"}</td>
              <td>
                <Link to={`/charcuteria/lotes/${l.id}`}>Ver detalle</Link>
              </td>
            </tr>
          ))}
          {lotes.length === 0 && (
            <tr>
              <td colSpan={7}>Sin lotes todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

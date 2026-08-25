import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatoCLP } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { TecladoNumerico } from "../components/TecladoNumerico";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import ModalAlerta from "../components/ModalAlerta";

const MOTIVOS_AJUSTE_FONDO = [
  "Se retiró efectivo para otro uso",
  "Se agregó efectivo adicional",
  "Corrección de un error de conteo del cierre anterior",
];

export default function AbrirCaja() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();
  const [fondoFijoInicial, setFondoFijoInicial] = useState("");
  const [fondoSugerido, setFondoSugerido] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [pidiendoAutorizacion, setPidiendoAutorizacion] = useState(false);

  useEffect(() => {
    api.caja
      .fondoSugerido()
      .then(({ fondoSugerido }) => {
        setFondoSugerido(fondoSugerido);
        if (fondoSugerido != null) setFondoFijoInicial(String(fondoSugerido));
      })
      .catch((e) => setError(e.message));
  }, []);

  // Si lo que se va a abrir hoy coincide con lo que debería haber (según el
  // cierre de ayer), se abre directo. Si se editó a otro número, hace falta
  // autorización — mismo patrón que las anulaciones de Caja (clave +
  // motivo + quién autoriza).
  const esAjuste = fondoSugerido != null && Math.abs((Number(fondoFijoInicial) || 0) - fondoSugerido) > 0.01;

  async function abrirDirecto() {
    if (!usuario) return;
    const fondo = Number(fondoFijoInicial);
    setGuardando(true);
    try {
      await api.caja.abrirSesion({ fondoFijoInicial: fondo, usuarioId: usuario.id });
      navigate("/caja");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function abrirConAutorizacion(usuarioAutorizoId: number, clave: string, motivo?: string) {
    if (!usuario) return;
    const fondo = Number(fondoFijoInicial);
    await api.caja.abrirSesion({
      fondoFijoInicial: fondo,
      usuarioId: usuario.id,
      clave,
      motivoAjusteFondo: motivo,
      usuarioAutorizoId,
    });
    setPidiendoAutorizacion(false);
    navigate("/caja");
  }

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario) return;
    const fondo = Number(fondoFijoInicial);
    if (Number.isNaN(fondo) || fondo < 0) {
      setError("El fondo fijo debe ser un número mayor o igual a 0");
      return;
    }
    if (esAjuste) {
      setPidiendoAutorizacion(true);
      return;
    }
    await abrirDirecto();
  }

  return (
    <div>
      <h1>Abrir caja</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      {fondoSugerido != null && (
        <p className="ayuda">
          La caja anterior cerró con <strong>{formatoCLP(fondoSugerido)}</strong> en efectivo — eso es lo que
          debería haber hoy para empezar. Ya viene precargado abajo; si el número real es otro, corrígelo y se te
          va a pedir motivo y autorización.
        </p>
      )}

      <form onSubmit={abrir} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Fondo fijo inicial
          <div className="fila-inline">
            <input
              type="number"
              min="0"
              value={fondoFijoInicial}
              onChange={(e) => setFondoFijoInicial(e.target.value)}
              placeholder="ej. 20000"
              required
            />
            <TecladoNumerico valor={fondoFijoInicial} onCambiar={setFondoFijoInicial} />
          </div>
        </label>
        {esAjuste && (
          <p className="ayuda">
            Distinto de lo esperado ({formatoCLP(fondoSugerido!)}) — al confirmar se va a pedir el motivo y la
            clave de supervisor.
          </p>
        )}
        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Abriendo..." : esAjuste ? "Continuar (necesita autorización)" : "Abrir caja"}
          </button>
        </div>
      </form>

      {pidiendoAutorizacion && (
        <ModalConfirmarClave
          titulo="Autorizar ajuste del fondo inicial"
          descripcion={`Vas a abrir la caja con ${formatoCLP(Number(fondoFijoInicial) || 0)} en vez de los ${formatoCLP(fondoSugerido ?? 0)} esperados.`}
          motivoOpciones={MOTIVOS_AJUSTE_FONDO}
          onConfirmar={abrirConAutorizacion}
          onCancelar={() => setPidiendoAutorizacion(false)}
        />
      )}
    </div>
  );
}

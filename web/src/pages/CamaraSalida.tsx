import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type AvisoFifoCamara, type CajaCamara, type DestinoSalidaCamara, type ResultadoSalidaCamara } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { ejecutarOEncolar } from "../lib/colaOffline";
import { EstadoOffline } from "../components/EstadoOffline";
import { mostrarToast } from "../lib/toast";

const DESTINOS: { valor: DestinoSalidaCamara; etiqueta: string }[] = [
  { valor: "sala_venta", etiqueta: "Sala de venta" },
  { valor: "produccion", etiqueta: "Producción" },
  { valor: "merma", etiqueta: "Merma" },
  { valor: "donacion", etiqueta: "Donación" },
  { valor: "mayorista", etiqueta: "Venta por mayor" },
  { valor: "otro", etiqueta: "Otro" },
];

export default function CamaraSalida() {
  const { usuario } = useUsuario();

  const [caja, setCaja] = useState<CajaCamara | null>(null);
  const [fifo, setFifo] = useState<AvisoFifoCamara | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codigoManual, setCodigoManual] = useState("");

  const [destino, setDestino] = useState<DestinoSalidaCamara>("sala_venta");
  const [pesoTexto, setPesoTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [precioTotal, setPrecioTotal] = useState("");
  const [estadoPago, setEstadoPago] = useState<"pagado" | "pendiente">("pendiente");

  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSalidaCamara | null>(null);
  const [guardadoOffline, setGuardadoOffline] = useState(false);

  function limpiarFormulario() {
    setDestino("sala_venta");
    setPesoTexto("");
    setMotivo("");
    setClienteNombre("");
    setPrecioTotal("");
    setEstadoPago("pendiente");
  }

  function nuevaBusqueda() {
    setCaja(null);
    setFifo(null);
    setResultado(null);
    setGuardadoOffline(false);
    setError(null);
    setCodigoManual("");
    limpiarFormulario();
  }

  async function buscarCaja(codigo: string) {
    const id = Number(codigo);
    if (!id || !Number.isInteger(id)) {
      setError(`Código escaneado no reconocido: "${codigo}"`);
      return;
    }
    setError(null);
    setResultado(null);
    setBuscando(true);
    try {
      const encontrada = await api.camara.obtenerCaja(id);
      if (encontrada.estado === "salida") {
        setError(`La caja ${String(id).padStart(6, "0")} ya salió completa de cámara — no queda saldo.`);
        setCaja(null);
        setFifo(null);
        return;
      }
      if (encontrada.estado === "anulada") {
        setError(`La caja ${String(id).padStart(6, "0")} fue anulada — no corresponde sacarle nada.`);
        setCaja(null);
        setFifo(null);
        return;
      }
      setCaja(encontrada);
      limpiarFormulario();
      setPesoTexto(String(encontrada.saldoKg));
      const avisoFifo = await api.camara.avisoFifo(id).catch(() => null);
      setFifo(avisoFifo);
    } catch {
      setError(`No se encontró ninguna caja con el número ${codigo}`);
      setCaja(null);
      setFifo(null);
    } finally {
      setBuscando(false);
    }
  }

  useEscanerCodigoBarras(buscarCaja, !resultado);

  async function confirmarSalida(e: React.FormEvent) {
    e.preventDefault();
    if (!caja || !usuario) return;
    setError(null);

    const peso = Number(pesoTexto);
    if (!peso || peso <= 0) {
      setError("Ingresa el peso que sale (mayor a 0)");
      return;
    }
    if (peso > caja.saldoKg + 0.0005) {
      setError(`No puede salir más peso del que queda en la caja (quedan ${caja.saldoKg} kg)`);
      return;
    }

    let mayoristaData: { clienteNombre?: string; precioTotal: number; estadoPago: "pagado" | "pendiente" } | undefined;
    if (destino === "mayorista") {
      const precio = Number(precioTotal);
      if (!precio || precio <= 0) {
        setError("Ingresa el precio total de la venta por mayor");
        return;
      }
      mayoristaData = { clienteNombre: clienteNombre.trim() || undefined, precioTotal: precio, estadoPago };
    }

    setGuardando(true);
    try {
      const claveIdempotencia = crypto.randomUUID();
      const respuesta = await ejecutarOEncolar<ResultadoSalidaCamara>(
        `/api/camara/cajas/${caja.id}/salida`,
        {
          destino,
          pesoKg: peso,
          motivo: motivo.trim() || undefined,
          usuarioId: usuario.id,
          version: caja.version,
          mayorista: mayoristaData,
          claveIdempotencia,
        },
        claveIdempotencia,
        `Salida de caja ${String(caja.id).padStart(6, "0")}`
      );
      if (respuesta.enviada) {
        setResultado(respuesta.datos);
        const etiquetaDestino = DESTINOS.find((d) => d.valor === destino)?.etiqueta ?? destino;
        mostrarToast("Salida registrada", `Caja ${numeroCaja} → ${etiquetaDestino}.`, "eliminado");
      } else {
        setGuardadoOffline(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const numeroCaja = caja ? String(caja.id).padStart(6, "0") : null;

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Salida de cámara</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>

      {error && <p className="error">{error}</p>}
      <EstadoOffline />

      {!caja && !resultado && !guardadoOffline && (
        <section className="tarjeta">
          <p className="ayuda">
            {buscando ? "Buscando caja..." : "Escanea el código de barras de la etiqueta de la caja que sale de cámara."}
          </p>
          <form
            className="fila-inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (!codigoManual.trim()) return;
              buscarCaja(codigoManual.trim());
              setCodigoManual("");
            }}
          >
            <label>
              O ingresa el número de caja a mano
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ej.: 000028"
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value)}
              />
            </label>
            <button type="submit" className="boton" disabled={buscando || !codigoManual.trim()}>
              Buscar
            </button>
          </form>
        </section>
      )}

      {caja && !resultado && !guardadoOffline && (
        <section className="tarjeta">
          <h2>
            Caja {numeroCaja} — {caja.producto.descripcion}
          </h2>
          <p className="ayuda">
            Familia: {caja.familiaNombre} · Ingresó el {new Date(caja.fechaIngreso).toLocaleDateString("es-CL")} ·{" "}
            {caja.pesoEstimado ? "peso estimado" : "peso real"}
          </p>
          <p>
            Saldo disponible: <strong>{caja.saldoKg.toFixed(3)} kg</strong> (de {caja.pesoInicialKg.toFixed(3)} kg
            iniciales) — costo neto {formatoCLP(caja.costoNetoKg)}/kg
          </p>

          {fifo?.hayMasAntigua && fifo.cajaMasAntigua && (
            <p className="error">
              Aviso FIFO: hay una caja más antigua de este producto sin usar (caja {fifo.cajaMasAntigua.numero},
              ingresó el {new Date(fifo.cajaMasAntigua.fechaIngreso).toLocaleDateString("es-CL")}). Puedes continuar
              igual si esta caja tiene una razón para salir primero.
            </p>
          )}

          <form onSubmit={confirmarSalida} onKeyDown={manejarEnterComoTab} className="formulario">
            <label>
              Destino
              <select value={destino} onChange={(e) => setDestino(e.target.value as DestinoSalidaCamara)}>
                {DESTINOS.map((d) => (
                  <option key={d.valor} value={d.valor}>
                    {d.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Peso que sale (kg)
              <input
                type="number"
                min="0.001"
                max={caja.saldoKg}
                step="0.001"
                value={pesoTexto}
                onChange={(e) => setPesoTexto(e.target.value)}
              />
              <span className="ayuda">
                Deja el valor completo ({caja.saldoKg.toFixed(3)} kg) para una salida completa, o bájalo para una
                salida parcial (la caja queda "parcial" en cámara con el saldo restante).
              </span>
            </label>

            {destino === "mayorista" && (
              <>
                <label>
                  Cliente (opcional)
                  <input type="text" value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} />
                </label>
                <label>
                  Precio total de la venta
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={precioTotal}
                    onChange={(e) => setPrecioTotal(e.target.value)}
                    placeholder="ej. 45000"
                  />
                </label>
                <label>
                  Estado de pago
                  <select value={estadoPago} onChange={(e) => setEstadoPago(e.target.value as "pagado" | "pendiente")}>
                    <option value="pendiente">Pendiente</option>
                    <option value="pagado">Pagado</option>
                  </select>
                </label>
              </>
            )}

            <label>
              Motivo / observación (opcional)
              <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </label>

            <div className="acciones-formulario">
              <button type="submit" className="boton boton-primario" disabled={guardando}>
                {guardando ? "Guardando..." : "Confirmar salida"}
              </button>
              <button type="button" className="boton" onClick={nuevaBusqueda} disabled={guardando}>
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {resultado && (
        <section className="tarjeta">
          <p className="exito">
            Listo — {resultado.movimiento.pesoKg.toFixed(3)} kg de la caja {numeroCaja} salieron con destino "
            {DESTINOS.find((d) => d.valor === resultado.movimiento.destino)?.etiqueta ?? resultado.movimiento.destino}
            ". La caja quedó en estado "{resultado.caja.estado}" (saldo {resultado.caja.saldoKg.toFixed(3)} kg).
          </p>
          {resultado.salidaMayorista && (
            <p className="ayuda">
              Venta por mayor registrada: {formatoCLP(resultado.salidaMayorista.precioTotal)} —{" "}
              {resultado.salidaMayorista.estadoPago === "pagado" ? "pagado" : "pendiente de pago"}.
            </p>
          )}
          <button type="button" className="boton boton-primario" onClick={nuevaBusqueda}>
            Escanear otra caja
          </button>
        </section>
      )}

      {guardadoOffline && (
        <section className="tarjeta">
          <p className="ayuda">
            Sin conexión ahora mismo — la salida de la caja {numeroCaja} quedó guardada en este celular y se va a
            enviar sola en cuanto vuelva la señal. No hace falta repetirla.
          </p>
          <button type="button" className="boton boton-primario" onClick={nuevaBusqueda}>
            Escanear otra caja
          </button>
        </section>
      )}
    </div>
  );
}

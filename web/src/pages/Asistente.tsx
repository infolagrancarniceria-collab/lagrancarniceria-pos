import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type PropuestaAsistente } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

interface Mensaje {
  autor: "usuario" | "asistente";
  texto: string;
}

// Ejecuta la acción que propuso la IA usando exactamente los mismos
// endpoints que usaría una persona a mano desde el resto del sistema — el
// asistente nunca tiene un camino propio para escribir datos.
async function ejecutarPropuesta(accion: PropuestaAsistente["accion"], usuarioId: number): Promise<void> {
  const d = accion.datos;
  switch (accion.tipo) {
    case "proponer_cambio_precio":
      await api.precios.cambiarIndividual({
        productoId: Number(d.productoId),
        precioNuevo: Number(d.precioNuevo),
        usuarioId,
      });
      return;
    case "proponer_cambio_precio_masivo_categoria":
      await api.precios.masivoCategoria({
        categoriaId: Number(d.categoriaId),
        tipo: d.tipo === "monto_fijo" ? "monto_fijo" : "porcentaje",
        valor: Number(d.valor),
        usuarioId,
        confirmar: true,
      });
      return;
    case "proponer_crear_categoria":
      await api.categorias.crear({
        codigo: String(d.codigo),
        nombre: String(d.nombre),
        nivel: (Number(d.nivel) as 1 | 2 | 3) ?? 1,
        padreId: d.padreId != null ? Number(d.padreId) : null,
      });
      return;
    case "proponer_entrada_inventario":
      await api.inventario.entrada({
        productoId: Number(d.productoId),
        cantidad: Number(d.cantidad),
        motivo: d.motivo === "ajuste" ? "ajuste" : "compra",
        proveedorId: d.proveedorId != null ? Number(d.proveedorId) : null,
        costoUnitario: d.costoUnitario != null ? Number(d.costoUnitario) : null,
        usuarioId,
      });
      return;
    case "proponer_salida_inventario":
      await api.inventario.salida({
        productoId: Number(d.productoId),
        cantidad: Number(d.cantidad),
        motivo: d.motivo === "ajuste" ? "ajuste" : "descarte",
        usuarioId,
      });
      return;
    default:
      throw new Error(`Acción desconocida: ${accion.tipo}`);
  }
}

export default function Asistente() {
  const { usuario } = useUsuario();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [historialApi, setHistorialApi] = useState<unknown[]>([]);
  const [propuesta, setPropuesta] = useState<PropuestaAsistente | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const mensaje = texto.trim();
    if (!mensaje || !usuario) return;

    setMensajes((m) => [...m, { autor: "usuario", texto: mensaje }]);
    setTexto("");
    setEnviando(true);
    try {
      const resultado = await api.asistente.enviarMensaje(mensaje, historialApi);
      setHistorialApi(resultado.historial);
      if (resultado.tipo === "propuesta") {
        setPropuesta(resultado);
      } else {
        setMensajes((m) => [...m, { autor: "asistente", texto: resultado.texto }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar() {
    if (!propuesta || !usuario) return;
    setConfirmando(true);
    setError(null);
    try {
      await ejecutarPropuesta(propuesta.accion, usuario.id);
      setMensajes((m) => [...m, { autor: "asistente", texto: `Listo — ${propuesta.descripcion}` }]);
      setPropuesta(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConfirmando(false);
    }
  }

  function cancelar() {
    if (!propuesta) return;
    setMensajes((m) => [...m, { autor: "asistente", texto: "Cambio cancelado — no se aplicó nada." }]);
    setPropuesta(null);
  }

  return (
    <div>
      <h1>Asistente</h1>
      {error && <p className="error">{error}</p>}

      <section className="tarjeta">
        <div className="chat-mensajes">
          {mensajes.length === 0 && (
            <p className="ayuda">
              Pregúntame sobre productos, precios, inventario o ventas — o pídeme un cambio (ej. "sube el
              precio de los pollos en 5%"). Todo cambio te lo muestro antes para que lo confirmes.
            </p>
          )}
          {mensajes.map((m, i) => (
            <p key={i} className={`chat-burbuja chat-burbuja-${m.autor}`}>
              <strong>{m.autor === "usuario" ? "Tú" : "Asistente"}:</strong> {m.texto}
            </p>
          ))}
        </div>

        {propuesta && (
          <div className="tarjeta propuesta-ia">
            <p>
              <strong>La IA propone:</strong> {propuesta.descripcion}
            </p>
            <div className="fila-inline">
              <button type="button" className="boton boton-primario" onClick={confirmar} disabled={confirmando}>
                {confirmando ? "Aplicando..." : "Confirmar"}
              </button>
              <button type="button" onClick={cancelar} disabled={confirmando}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        <form onSubmit={enviar} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <input
            type="text"
            placeholder="Escribe tu pregunta o pedido..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={enviando || !!propuesta}
          />
          <button type="submit" className="boton boton-primario" disabled={enviando || !!propuesta}>
            {enviando ? "Pensando..." : "Enviar"}
          </button>
        </form>
      </section>

      <p className="ayuda">
        ¿Falta configurar la clave de API? Ve a <Link to="/configuracion">Configuración</Link>.
      </p>
    </div>
  );
}

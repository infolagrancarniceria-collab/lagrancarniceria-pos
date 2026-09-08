import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, codigoCliente, formatoCLP, type MedioCobro, type PagoVenta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import ModalAlerta from "../components/ModalAlerta";

// Crédito y transferencia funcionan igual (quedan pendientes hasta que se
// marcan como cobrados/confirmados) — se llevan en la misma pantalla, con
// una pestaña para filtrar cada uno por separado, porque el dueño quiere
// verlos aparte aunque el mecanismo sea el mismo (ver comentario en
// PagoVenta.medio del schema).
type Filtro = "todos" | "credito" | "transferencia";

const ETIQUETAS_FILTRO: Record<Filtro, string> = {
  todos: "Todos",
  credito: "Crédito",
  transferencia: "Transferencia",
};

export default function CreditosPendientes() {
  const { usuario } = useUsuario();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [creditos, setCreditos] = useState<PagoVenta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // Selección múltiple — a pedido del usuario, para cobrar de una vez varios
  // pedidos antiguos que quedaron pendientes con el flujo viejo (antes
  // "Enviar a Caja" siempre dejaba crédito, ahora ya queda pagado desde el
  // principio) y que el equipo ya sabe que se pagaron. No inventa ningún
  // cobro nuevo: repite el mismo cobro individual de siempre, uno por cada
  // fila marcada.
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [cobrandoLote, setCobrandoLote] = useState(false);

  function cargar() {
    setCargando(true);
    api.caja
      .creditosPendientes(filtro === "todos" ? undefined : filtro)
      .then((datos) => {
        setCreditos(datos);
        setSeleccionados(new Set());
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  async function cobrar(pago: PagoVenta, medioCobro: MedioCobro) {
    if (!usuario) return;
    setError(null);
    setMensaje(null);
    const palabra = pago.medio === "transferencia" ? "la transferencia" : "el crédito";
    const confirmado = window.confirm(
      `¿Registrar el cobro de ${formatoCLP(pago.monto)} (${palabra} de ${pago.clienteNombre}) como ${
        medioCobro === "efectivo" ? "efectivo" : "tarjeta"
      }?`
    );
    if (!confirmado) return;
    try {
      await api.caja.cobrarCredito(pago.id, { medioCobro, usuarioId: usuario.id });
      setMensaje(`Cobro registrado: ${pago.clienteNombre} — ${formatoCLP(pago.monto)}`);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function alternarSeleccion(id: number) {
    setSeleccionados((prev) => {
      const copia = new Set(prev);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }

  function alternarSeleccionTodos() {
    setSeleccionados((prev) => (prev.size === creditos.length ? new Set() : new Set(creditos.map((c) => c.id))));
  }

  async function cobrarSeleccionados(medioCobro: MedioCobro) {
    if (!usuario || seleccionados.size === 0) return;
    setError(null);
    setMensaje(null);
    const filas = creditos.filter((c) => seleccionados.has(c.id));
    const totalLote = filas.reduce((s, c) => s + c.monto, 0);
    const confirmado = window.confirm(
      `¿Registrar el cobro de ${filas.length} pendiente(s) por ${formatoCLP(totalLote)} como ${
        medioCobro === "efectivo" ? "efectivo" : "tarjeta"
      }? Esto asume que TODOS se pagaron con el mismo medio — si alguno se pagó distinto, cóbralo aparte.`
    );
    if (!confirmado) return;

    setCobrandoLote(true);
    let exitosos = 0;
    const fallidos: string[] = [];
    for (const pago of filas) {
      try {
        await api.caja.cobrarCredito(pago.id, { medioCobro, usuarioId: usuario.id });
        exitosos++;
      } catch (e) {
        fallidos.push(`${pago.clienteNombre ?? "—"} (${(e as Error).message})`);
      }
    }
    setCobrandoLote(false);
    if (fallidos.length > 0) {
      setError(`Se cobraron ${exitosos} de ${filas.length}. Fallaron: ${fallidos.join("; ")}`);
    } else {
      setMensaje(`Se registraron ${exitosos} cobro(s) por ${formatoCLP(totalLote)}.`);
    }
    cargar();
  }

  const totalPendiente = creditos.reduce((suma, c) => suma + c.monto, 0);
  const totalSeleccionado = creditos.filter((c) => seleccionados.has(c.id)).reduce((s, c) => s + c.monto, 0);

  const subtotalesPorCliente = new Map<string, number>();
  for (const c of creditos) {
    const nombre = c.clienteNombre ?? "—";
    subtotalesPorCliente.set(nombre, (subtotalesPorCliente.get(nombre) ?? 0) + c.monto);
  }

  return (
    <div>
      <h1>Créditos y transferencias pendientes</h1>
      <p className="ayuda">
        Ventas que quedaron a crédito (fiadas) o esperando que se confirme una transferencia, y todavía no se han
        cobrado. Al cobrarlas, esa plata se suma al efectivo o tarjeta del día en que se cobra — no del día en que se
        hizo la venta original. Para ver la deuda total de un cliente (sumando crédito y transferencia), revisa{" "}
        <Link to="/clientes">Clientes</Link>.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      <div className="filtros no-imprimir">
        {(Object.keys(ETIQUETAS_FILTRO) as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`boton ${filtro === f ? "boton-primario" : ""}`}
            onClick={() => setFiltro(f)}
          >
            {ETIQUETAS_FILTRO[f]}
          </button>
        ))}
      </div>

      {cargando && <p>Cargando...</p>}

      {!cargando && creditos.length > 0 && (
        <div className="tarjeta">
          <h2>Total pendiente por cliente</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Debe</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(subtotalesPorCliente.entries()).map(([nombre, monto]) => (
                <tr key={nombre}>
                  <td>{nombre}</td>
                  <td>{formatoCLP(monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Total pendiente:</strong> {formatoCLP(totalPendiente)}
          </p>
        </div>
      )}

      {seleccionados.size > 0 && (
        <div className="tarjeta fila-inline">
          <strong>
            {seleccionados.size} seleccionado(s) — {formatoCLP(totalSeleccionado)}
          </strong>
          <button type="button" disabled={cobrandoLote} onClick={() => cobrarSeleccionados("efectivo")}>
            {cobrandoLote ? "Cobrando..." : "Cobrar seleccionados en efectivo"}
          </button>
          <button type="button" disabled={cobrandoLote} onClick={() => cobrarSeleccionados("tarjeta")}>
            {cobrandoLote ? "Cobrando..." : "Cobrar seleccionados con tarjeta"}
          </button>
          <button type="button" disabled={cobrandoLote} onClick={() => setSeleccionados(new Set())}>
            Quitar selección
          </button>
        </div>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={creditos.length > 0 && seleccionados.size === creditos.length}
                onChange={alternarSeleccionTodos}
                disabled={creditos.length === 0}
              />
            </th>
            <th>Medio</th>
            <th>Cliente</th>
            <th>Monto</th>
            <th>Venta</th>
            <th>Fecha de la venta</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {creditos.map((c) => (
            <tr key={c.id}>
              <td>
                <input type="checkbox" checked={seleccionados.has(c.id)} onChange={() => alternarSeleccion(c.id)} />
              </td>
              <td>{c.medio === "transferencia" ? "Transferencia" : "Crédito"}</td>
              <td>{c.clienteId != null ? `${codigoCliente(c.clienteId)} — ${c.clienteNombre}` : c.clienteNombre}</td>
              <td>{formatoCLP(c.monto)}</td>
              <td>#{c.ventaId} — {c.venta ? formatoCLP(c.venta.total) : ""}</td>
              <td>{c.venta ? new Date(c.venta.fecha).toLocaleString("es-CL") : ""}</td>
              <td className="fila-inline">
                <button type="button" onClick={() => cobrar(c, "efectivo")}>
                  Cobrar en efectivo
                </button>
                <button type="button" onClick={() => cobrar(c, "tarjeta")}>
                  Cobrar con tarjeta
                </button>
              </td>
            </tr>
          ))}
          {!cargando && creditos.length === 0 && (
            <tr>
              <td colSpan={7}>No hay créditos ni transferencias pendientes.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

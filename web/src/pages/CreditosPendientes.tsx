import { useEffect, useState } from "react";
import { api, formatoCLP, type MedioCobro, type PagoVenta } from "../api";
import { useUsuario } from "../context/UsuarioContext";

export default function CreditosPendientes() {
  const { usuario } = useUsuario();
  const [creditos, setCreditos] = useState<PagoVenta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  function cargar() {
    setCargando(true);
    api.caja
      .creditosPendientes()
      .then(setCreditos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function cobrar(pago: PagoVenta, medioCobro: MedioCobro) {
    if (!usuario) return;
    setError(null);
    setMensaje(null);
    const confirmado = window.confirm(
      `¿Registrar el cobro de ${formatoCLP(pago.monto)} a ${pago.clienteNombre} como ${
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

  const totalPendiente = creditos.reduce((suma, c) => suma + c.monto, 0);

  const subtotalesPorCliente = new Map<string, number>();
  for (const c of creditos) {
    const nombre = c.clienteNombre ?? "—";
    subtotalesPorCliente.set(nombre, (subtotalesPorCliente.get(nombre) ?? 0) + c.monto);
  }

  return (
    <div>
      <h1>Créditos pendientes</h1>
      <p className="ayuda">
        Ventas que quedaron a crédito (fiadas) y todavía no se han cobrado. Al cobrarlas, esa plata se suma al
        efectivo o tarjeta del día en que se cobra — no del día en que se hizo la venta original.
      </p>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}
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

      <table className="tabla">
        <thead>
          <tr>
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
              <td>{c.clienteNombre}</td>
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
              <td colSpan={5}>No hay créditos pendientes.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

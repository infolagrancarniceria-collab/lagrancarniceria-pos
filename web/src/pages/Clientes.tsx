import { useEffect, useState } from "react";
import { api, codigoCliente, formatoCLP, type Cliente, type EstadoCuentaCliente } from "../api";
import ModalAlerta from "../components/ModalAlerta";

const ETIQUETAS_MEDIO: Record<string, string> = { credito: "Crédito", transferencia: "Transferencia" };

export default function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscar, setBuscar] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clienteAbiertoId, setClienteAbiertoId] = useState<number | null>(null);
  const [estadoCuenta, setEstadoCuenta] = useState<EstadoCuentaCliente | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(false);

  function cargar() {
    setCargando(true);
    api.clientes
      .listar()
      .then(setClientes)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirEstadoCuenta(id: number) {
    setClienteAbiertoId(id);
    setCargandoEstado(true);
    setEstadoCuenta(null);
    api.clientes
      .estadoCuenta(id)
      .then(setEstadoCuenta)
      .catch((e) => setError(e.message))
      .finally(() => setCargandoEstado(false));
  }

  const filtrados = buscar.trim()
    ? clientes.filter((c) => {
        const t = buscar.trim().toLowerCase();
        return (
          c.nombre.toLowerCase().includes(t) ||
          (c.telefono ?? "").toLowerCase().includes(t) ||
          (c.rut ?? "").toLowerCase().includes(t) ||
          codigoCliente(c.id).toLowerCase().includes(t)
        );
      })
    : clientes;

  if (clienteAbiertoId != null) {
    return (
      <div>
        <button type="button" onClick={() => setClienteAbiertoId(null)}>
          ← Volver a Clientes
        </button>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        {cargandoEstado && <p>Cargando...</p>}
        {estadoCuenta && (
          <div className="tarjeta">
            <h1>
              {codigoCliente(estadoCuenta.cliente.id)} — {estadoCuenta.cliente.nombre}
            </h1>
            <p className="ayuda">
              {estadoCuenta.cliente.telefono ?? "Sin teléfono"} · {estadoCuenta.cliente.rut ?? "Sin RUT"}
            </p>
            <h2>Debe pendiente: {formatoCLP(estadoCuenta.totalPendiente)}</h2>
            <p>
              Crédito: {formatoCLP(estadoCuenta.pendientePorMedio.credito ?? 0)} · Transferencia:{" "}
              {formatoCLP(estadoCuenta.pendientePorMedio.transferencia ?? 0)}
            </p>

            <h3>Historial</h3>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Medio</th>
                  <th>Venta</th>
                  <th>Monto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {estadoCuenta.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.venta ? new Date(p.venta.fecha).toLocaleString("es-CL") : ""}</td>
                    <td>{ETIQUETAS_MEDIO[p.medio] ?? p.medio}</td>
                    <td>#{p.ventaId}</td>
                    <td>{formatoCLP(p.monto)}</td>
                    <td>
                      {p.cobrado ? (
                        <span className="exito">
                          Cobrado{p.fechaCobro ? ` — ${new Date(p.fechaCobro).toLocaleDateString("es-CL")}` : ""}
                        </span>
                      ) : (
                        <span className="error">Pendiente</span>
                      )}
                    </td>
                  </tr>
                ))}
                {estadoCuenta.pagos.length === 0 && (
                  <tr>
                    <td colSpan={5}>Este cliente todavía no tiene ventas a crédito ni transferencia.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1>Clientes</h1>
      <p className="ayuda">
        Registro de clientes que compran a crédito o por transferencia — el código (ej. {codigoCliente(1)}) identifica
        a cada uno sin depender de que se sepa un RUT de memoria. Se crean directamente desde el selector de cliente al
        cobrar en Punto de Venta.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <input
        type="text"
        placeholder="Buscar por nombre, código, RUT o teléfono"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
      />

      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>RUT</th>
            <th>Debe</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((c) => (
            <tr key={c.id}>
              <td>{codigoCliente(c.id)}</td>
              <td>{c.nombre}</td>
              <td>{c.telefono ?? "—"}</td>
              <td>{c.rut ?? "—"}</td>
              <td className={c.deudaPendiente ? "error" : ""}>{formatoCLP(c.deudaPendiente ?? 0)}</td>
              <td>
                <button type="button" onClick={() => abrirEstadoCuenta(c.id)}>
                  Ver estado de cuenta
                </button>
              </td>
            </tr>
          ))}
          {!cargando && filtrados.length === 0 && (
            <tr>
              <td colSpan={6}>No hay clientes registrados todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

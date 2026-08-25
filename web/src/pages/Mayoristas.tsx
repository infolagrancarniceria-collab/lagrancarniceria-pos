import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type SalidaMayorista } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import ModalAlerta from "../components/ModalAlerta";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Pantalla para ver las ventas por mayor registradas desde "Salida de
// cámara" (destino "Venta por mayor") y marcar rápido cuál ya se cobró —
// mismo patrón que "Créditos pendientes" en Caja, pero para este tipo de
// venta aparte (no pasa por el punto de venta normal).
export default function Mayoristas() {
  const { usuario } = useUsuario();

  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [salidas, setSalidas] = useState<SalidaMayorista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [actualizandoId, setActualizandoId] = useState<number | null>(null);

  // Edición en línea (cliente, precio, observaciones) — no toca el peso ni
  // la caja de cámara, así que no necesita autorización.
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editCliente, setEditCliente] = useState("");
  const [editPrecio, setEditPrecio] = useState("");
  const [editObservaciones, setEditObservaciones] = useState("");
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // Anular — sí necesita autorización (motivo + quién autoriza + clave),
  // igual que el resto de las acciones que deshacen algo en el sistema.
  const [anulandoId, setAnulandoId] = useState<number | null>(null);

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await api.camara.mayoristas({
        desde,
        hasta,
        estadoPago: soloPendientes ? "pendiente" : undefined,
      });
      setSalidas(resultado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function marcar(id: number, estadoPago: "pagado" | "pendiente") {
    if (!usuario) return;
    setActualizandoId(id);
    setError(null);
    try {
      const actualizada = await api.camara.marcarEstadoPagoMayorista(id, estadoPago, usuario.id);
      setSalidas((prev) => prev.map((s) => (s.id === id ? actualizada : s)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActualizandoId(null);
    }
  }

  function abrirEdicion(s: SalidaMayorista) {
    setEditandoId(s.id);
    setEditCliente(s.clienteNombre ?? "");
    setEditPrecio(String(s.precioTotal));
    setEditObservaciones(s.observaciones ?? "");
  }

  async function guardarEdicion(id: number) {
    if (!usuario) return;
    const precio = Number(editPrecio);
    if (!precio || precio <= 0) {
      setError("El precio total debe ser mayor a 0");
      return;
    }
    setGuardandoEdicion(true);
    setError(null);
    try {
      const actualizada = await api.camara.editarMayorista(id, {
        usuarioId: usuario.id,
        clienteNombre: editCliente.trim() || null,
        precioTotal: precio,
        observaciones: editObservaciones.trim() || null,
      });
      setSalidas((prev) => prev.map((s) => (s.id === id ? actualizada : s)));
      setEditandoId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function confirmarAnular(usuarioId: number, clave: string, motivo?: string) {
    if (anulandoId == null) return;
    const resultado = await api.camara.anularMayorista(anulandoId, { usuarioId, clave, motivo: motivo || "" });
    setSalidas((prev) => prev.map((s) => (s.id === anulandoId ? resultado.salida : s)));
    setAnulandoId(null);
  }

  const totalPendiente = salidas
    .filter((s) => !s.anulada && s.estadoPago === "pendiente")
    .reduce((acc, s) => acc + s.precioTotal, 0);

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Ventas por mayor</h1>
        <Link to="/camara">Volver a Cámara</Link>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={buscar} className="fila-inline">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label className="fila-inline">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes de pago
        </label>
        <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
      </form>

      {totalPendiente > 0 && (
        <p className="error">Total pendiente de cobro en el rango: {formatoCLP(totalPendiente)}</p>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Cliente</th>
            <th>Cantidad (kg)</th>
            <th>Total</th>
            <th>Estado</th>
            <th>Registró</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {salidas.length === 0 && (
            <tr>
              <td colSpan={8} className="ayuda">
                Sin ventas por mayor en este rango.
              </td>
            </tr>
          )}
          {salidas.map((s) => (
            <Fragment key={s.id}>
              <tr className={s.anulada ? "fila-error" : ""}>
                <td>{new Date(s.fecha).toLocaleString("es-CL")}</td>
                <td>{s.producto.descripcion}</td>
                <td>{s.clienteNombre || "—"}</td>
                <td>{s.cantidadKg.toFixed(3)}</td>
                <td>{formatoCLP(s.precioTotal)}</td>
                <td className={s.anulada ? "" : s.estadoPago === "pagado" ? "exito" : "error"}>
                  {s.anulada ? "Anulada" : s.estadoPago === "pagado" ? "Pagado" : "Pendiente"}
                </td>
                <td>{s.usuario.nombre}</td>
                <td>
                  {!s.anulada && (
                    <span className="fila-inline" style={{ flexWrap: "nowrap" }}>
                      <button
                        type="button"
                        className="boton boton-chico"
                        disabled={actualizandoId === s.id}
                        onClick={() => marcar(s.id, s.estadoPago === "pagado" ? "pendiente" : "pagado")}
                      >
                        {s.estadoPago === "pagado" ? "Marcar pendiente" : "Marcar pagado"}
                      </button>
                      <button type="button" className="boton boton-chico" onClick={() => abrirEdicion(s)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton boton-chico boton-peligro"
                        onClick={() => setAnulandoId(s.id)}
                      >
                        Anular
                      </button>
                    </span>
                  )}
                </td>
              </tr>
              {editandoId === s.id && (
                <tr>
                  <td colSpan={8}>
                    <div className="fila-inline">
                      <label className="ayuda">
                        Cliente
                        <input
                          type="text"
                          value={editCliente}
                          onChange={(e) => setEditCliente(e.target.value)}
                        />
                      </label>
                      <label className="ayuda">
                        Precio total
                        <input
                          type="number"
                          min="1"
                          className="input-chico"
                          value={editPrecio}
                          onChange={(e) => setEditPrecio(e.target.value)}
                        />
                      </label>
                      <label className="ayuda">
                        Observaciones
                        <input
                          type="text"
                          value={editObservaciones}
                          onChange={(e) => setEditObservaciones(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="boton boton-chico boton-primario"
                        disabled={guardandoEdicion}
                        onClick={() => guardarEdicion(s.id)}
                      >
                        {guardandoEdicion ? "Guardando..." : "Guardar"}
                      </button>
                      <button type="button" className="boton boton-chico" onClick={() => setEditandoId(null)}>
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {s.anulada && (
                <tr>
                  <td colSpan={8} className="ayuda">
                    Anulada por {s.usuarioAnulacion?.nombre ?? "—"}
                    {s.fechaAnulacion ? ` el ${new Date(s.fechaAnulacion).toLocaleString("es-CL")}` : ""} — motivo:{" "}
                    {s.motivoAnulacion || "sin especificar"}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {anulandoId != null && (
        <ModalConfirmarClave
          titulo="Anular venta por mayor"
          descripcion="Devuelve el peso a la caja de cámara de origen. Solo funciona si esa caja no tuvo ningún movimiento después de esta venta. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={["Venta ingresada por error", "Cliente canceló la compra", "Datos equivocados"]}
          onConfirmar={confirmarAnular}
          onCancelar={() => setAnulandoId(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, formatoCLP, type PedidoWeb } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const ESTADOS = ["pendiente", "atendido"] as const;

export default function PedidosWeb() {
  const { usuario } = useUsuario();
  const [estado, setEstado] = useState<(typeof ESTADOS)[number]>("pendiente");
  const [pedidos, setPedidos] = useState<PedidoWeb[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function cargar() {
    setCargando(true);
    api.pedidosWeb
      .listar(estado)
      .then(setPedidos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [estado]);

  async function marcarAtendido(p: PedidoWeb) {
    if (!usuario) return;
    try {
      await api.pedidosWeb.marcarAtendido(p.id, usuario.id);
      mostrarToast("Pedido atendido", `El pedido de ${p.clienteNombre} quedó marcado como atendido.`);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Pedidos web</h1>
      </div>
      <p className="ayuda">
        Pedidos armados por clientes en lagrancarniceria.com (cotización de despacho) — se traen automáticamente
        cada pocos minutos si el PC tiene internet. No reemplazan una venta en Caja: son solo el pedido que el
        cliente pidió, para que el equipo lo revise y coordine el despacho.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="chips-categoria">
        {ESTADOS.map((e) => (
          <button
            key={e}
            type="button"
            className={`chip-categoria${estado === e ? " activo" : ""}`}
            onClick={() => setEstado(e)}
          >
            {e === "pendiente" ? "Pendientes" : "Atendidos"}
          </button>
        ))}
      </div>

      {cargando && <p>Cargando...</p>}

      {!cargando && pedidos.length === 0 && (
        <p>No hay pedidos {estado === "pendiente" ? "pendientes" : "atendidos"} por ahora.</p>
      )}

      {pedidos.map((p) => (
        <section key={p.id} className="tarjeta">
          <div className="encabezado-pantalla">
            <h2>{p.clienteNombre}</h2>
            <span>{new Date(p.fecha).toLocaleString("es-CL")}</span>
          </div>
          <p>
            <strong>Teléfono:</strong> {p.clienteTelefono} · <strong>Dirección:</strong> {p.clienteDireccion} (
            {p.comunaNombre})
          </p>
          <p>
            <strong>Costo de envío:</strong> {formatoCLP(p.costoEnvio)}
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Corte</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.descripcion}</td>
                  <td>{item.corte ?? "—"}</td>
                  <td>
                    {item.cantidad} {item.unidad === "kg" ? "kg" : "un."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.comentario && (
            <p>
              <strong>Comentario del cliente:</strong> {p.comentario}
            </p>
          )}
          {p.estado === "pendiente" ? (
            <div className="acciones-formulario">
              <button type="button" className="boton boton-primario" onClick={() => marcarAtendido(p)}>
                Marcar como atendido
              </button>
            </div>
          ) : (
            <p className="exito">Atendido el {p.atendidoEn ? new Date(p.atendidoEn).toLocaleString("es-CL") : ""}</p>
          )}
        </section>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, formatoCLP, formatoPeso, type PedidoWeb } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { mostrarToast } from "../lib/toast";
import { useFiltroUrl } from "../hooks/useFiltroUrl";
import ModalAlerta from "../components/ModalAlerta";

const ESTADOS = ["pendiente", "atendido"] as const;

export default function PedidosWeb() {
  const { usuario } = useUsuario();
  // En la URL, no en useState suelto — así "← Volver" recupera la misma
  // pestaña (Pendientes/Atendidos) al regresar (ver hooks/useFiltroUrl.ts).
  const [estadoStr, setEstadoStr] = useFiltroUrl("estado", "pendiente");
  const estado = estadoStr as (typeof ESTADOS)[number];
  const setEstado = setEstadoStr;
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
        Pedidos armados por clientes en lagrancarniceria.com (retiro en tienda o despacho) — se traen automáticamente
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
            <strong>Teléfono:</strong> {p.clienteTelefono} ·{" "}
            <strong>Entrega:</strong> {p.tipoEntrega === "despacho" ? "Despacho a domicilio" : "Retiro en tienda"}
            {p.fechaEntrega ? ` · ${p.fechaEntrega}` : ""}
          </p>
          {p.tipoEntrega === "despacho" && (
            <p>
              <strong>Dirección:</strong> {p.clienteDireccion} ({p.comunaNombre}) ·{" "}
              <strong>Costo de envío:</strong> {p.costoEnvio != null ? formatoCLP(p.costoEnvio) : "—"}
            </p>
          )}
          {p.medioPago && (
            <p>
              <strong>Medio de pago:</strong> {p.medioPago}
            </p>
          )}
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Corte</th>
                <th>Envasado</th>
                <th>Cantidad</th>
                <th>Instrucciones</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((item, i) => (
                <tr key={i}>
                  <td>{item.descripcion}</td>
                  <td>{item.corte ?? "—"}</td>
                  <td>{item.envasado ?? "—"}</td>
                  <td>{item.unidad === "kg" ? formatoPeso(item.cantidad) : `${item.cantidad} un.`}</td>
                  <td>{item.instrucciones ?? "—"}</td>
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

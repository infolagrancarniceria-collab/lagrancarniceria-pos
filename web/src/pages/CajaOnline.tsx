import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatoCLP, formatoPeso, type PedidoWeb, type Producto, type Venta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";
import { imprimirSilencioso } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import { ValeVenta } from "../components/ValeVenta";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

const ERROR_CODIGO_SIN_MATCH = "No se encontró ningún producto con ese código";

interface FilaChecklist {
  plu: string;
  descripcion: string;
  unidad: "kg" | "unidad";
  cantidadPedida: number; // gramos si es "kg", unidades si no
  cantidadEscaneada: number; // misma escala que cantidadPedida
}

// Compara lo que el cliente pidió online (texto, sin relación a Producto —
// ver comentario de PedidoWeb.itemsJson) contra lo que de verdad se fue
// pistoleando en esta venta, para que quien cobra note a simple vista si
// falta algo o si se escaneó de más — sin bloquear nada: a veces un
// producto se cambia por otro a mano (sin stock, etc.) y quien pistolea
// sabe por qué.
function construirChecklist(pedido: PedidoWeb, venta: Venta | null): FilaChecklist[] {
  const escaneadoPorPlu = new Map<string, number>();
  if (venta) {
    for (const item of venta.items) {
      if (item.anulado) continue;
      const escala = item.producto.flagBalanza === "NORMAL" ? item.cantidad : Math.round(item.cantidad * 1000);
      escaneadoPorPlu.set(item.producto.plu, (escaneadoPorPlu.get(item.producto.plu) ?? 0) + escala);
    }
  }
  return pedido.items.map((item) => ({
    plu: item.plu,
    descripcion: item.descripcion,
    unidad: item.unidad,
    cantidadPedida: item.cantidad,
    cantidadEscaneada: escaneadoPorPlu.get(item.plu) ?? 0,
  }));
}

export default function CajaOnline() {
  const { pedidoId } = useParams<{ pedidoId: string }>();
  const navigate = useNavigate();
  const { usuario } = useUsuario();

  const [pedido, setPedido] = useState<PedidoWeb | null>(null);
  const [venta, setVenta] = useState<Venta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesandoCobro, setProcesandoCobro] = useState<"pendiente" | "efectivo" | "tarjeta" | null>(null);
  const [itemAAnular, setItemAAnular] = useState<number | null>(null);
  const [ventaParaImprimir, setVentaParaImprimir] = useState<Venta | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);

  useEffect(() => {
    if (!ventaParaImprimir) return;
    imprimirSilencioso().finally(() => setVentaParaImprimir(null));
  }, [ventaParaImprimir]);

  useEffect(() => {
    if (!pedidoId || !usuario) return;
    setCargando(true);
    setError(null);
    Promise.all([api.pedidosWeb.obtener(Number(pedidoId)), api.caja.crearVentaDesdePedidoWeb(Number(pedidoId), usuario.id)])
      .then(([pedidoCargado, ventaCreada]) => {
        setPedido(pedidoCargado);
        setVenta(ventaCreada);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId, usuario?.id]);

  const escanearCodigo = useCallback(
    async (codigo: string) => {
      if (!venta) return;
      setError(null);
      setMensaje(null);
      try {
        const actualizada = await api.caja.escanearCodigo(venta.id, codigo);
        const nuevo = actualizada.items[actualizada.items.length - 1];
        setMensaje(nuevo ? `Agregado: ${nuevo.producto.descripcion} (${nuevo.cantidad})` : "Producto agregado");
        setVenta(actualizada);
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg === ERROR_CODIGO_SIN_MATCH ? `Código "${codigo}" no reconocido — búscalo a mano abajo` : msg);
      }
    },
    [venta]
  );

  useEscanerCodigoBarras(escanearCodigo, venta?.estado === "abierta");

  useEffect(() => {
    if (!busqueda.trim()) {
      setResultados([]);
      return;
    }
    api.productos
      .listar({ buscar: busqueda })
      .then((r) => setResultados(r.slice(0, 8)))
      .catch(() => setResultados([]));
  }, [busqueda]);

  async function agregarProductoManual(producto: Producto) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.agregarItem(venta.id, { productoId: producto.id, cantidad: 1 });
      setVenta(actualizada);
      setMensaje(`Agregado: ${producto.descripcion}`);
      setBusqueda("");
      setResultados([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmarAnularItem(usuarioIdAutoriza: number, clave: string, motivo?: string) {
    if (!venta || itemAAnular == null) return;
    const actualizada = await api.caja.anularItem(venta.id, itemAAnular, { clave, usuarioId: usuarioIdAutoriza, motivo });
    setVenta(actualizada);
    setMensaje("Ítem quitado");
    setItemAAnular(null);
  }

  async function cobrar(tipo: "pendiente" | "efectivo" | "tarjeta") {
    if (!venta || !usuario) return;
    if (venta.items.filter((i) => !i.anulado).length === 0) {
      setError("Todavía no se ha pistoleado ningún producto");
      return;
    }
    setProcesandoCobro(tipo);
    setError(null);
    try {
      const conPago = await api.caja.agregarPago(venta.id, {
        medio: tipo === "pendiente" ? "pedido_web" : tipo,
        monto: venta.total,
      });
      const confirmada = await api.caja.confirmarVenta(conPago.id, usuario.id);
      setVenta(confirmada);
      setVentaParaImprimir(confirmada);
      mostrarToast(
        "Venta confirmada",
        tipo === "pendiente"
          ? `Pedido de ${pedido?.clienteNombre} pistoleado — queda pendiente de pago.`
          : `Pedido de ${pedido?.clienteNombre} pistoleado y cobrado.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesandoCobro(null);
    }
  }

  if (cargando) return <p>Cargando...</p>;
  if (!pedido) return <p className="error">Pedido no encontrado.</p>;

  const checklist = construirChecklist(pedido, venta);
  const yaConfirmada = venta?.estado !== "abierta";

  return (
    <>
      <div className="no-imprimir">
        <div className="encabezado-pantalla">
          <h1>Caja Online — pedido de {pedido.clienteNombre}</h1>
          <button type="button" onClick={() => navigate("/pedidos-web")}>
            Volver a Pedidos web
          </button>
        </div>
        <p className="ayuda">
          Pistolea acá los productos de verdad (igual que en Punto de Venta) para armar la venta real de este pedido
          — así se evita que quede duplicado entre el mesón y el pedido. El cliente paga al recibir, así que por
          defecto la venta queda "pendiente de pago" hasta que se registre el cobro en Pedidos online pendientes de
          pago.
        </p>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        {mensaje && <p className="exito">{mensaje}</p>}

        <div className="tarjeta">
          <h2>Lo que pidió el cliente</h2>
          <p>
            <strong>Teléfono:</strong> {pedido.clienteTelefono} · <strong>Entrega:</strong>{" "}
            {pedido.tipoEntrega === "despacho" ? "Despacho a domicilio" : "Retiro en tienda"}
          </p>
          {pedido.comentario && (
            <p>
              <strong>Comentario del cliente:</strong> {pedido.comentario}
            </p>
          )}
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Pedido</th>
                <th>Pistoleado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {checklist.map((fila) => {
                const completo = fila.cantidadEscaneada >= fila.cantidadPedida;
                return (
                  <tr key={fila.plu}>
                    <td>{fila.descripcion}</td>
                    <td>{fila.unidad === "kg" ? formatoPeso(fila.cantidadPedida) : `${fila.cantidadPedida} un.`}</td>
                    <td>{fila.unidad === "kg" ? formatoPeso(fila.cantidadEscaneada) : `${fila.cantidadEscaneada} un.`}</td>
                    <td>{completo ? "✓" : fila.cantidadEscaneada > 0 ? "⚠ parcial" : "— falta"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!yaConfirmada && (
          <div className="tarjeta">
            <h2>Pistolear productos</h2>
            <p className="ayuda">Usa el lector de código de barras, o búscalo a mano si el código no se reconoce.</p>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto por nombre"
            />
            {resultados.length > 0 && (
              <ul className="lista-resultados">
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => agregarProductoManual(p)}>
                      {p.descripcion} {p.marca ? `— ${p.marca}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="tarjeta">
          <h2>Venta #{venta?.id}</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant.</th>
                <th>Precio</th>
                <th>Subtotal</th>
                {!yaConfirmada && <th></th>}
              </tr>
            </thead>
            <tbody>
              {venta?.items.filter((i) => !i.anulado).map((item) => (
                <tr key={item.id}>
                  <td>{item.producto.descripcion}</td>
                  <td>{item.cantidad}</td>
                  <td>{formatoCLP(item.precioUnitario)}</td>
                  <td>{formatoCLP(item.subtotal)}</td>
                  {!yaConfirmada && (
                    <td>
                      <button type="button" className="boton-quitar-item" onClick={() => setItemAAnular(item.id)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {venta && venta.items.filter((i) => !i.anulado).length === 0 && (
                <tr>
                  <td colSpan={5}>Todavía no se ha pistoleado nada.</td>
                </tr>
              )}
            </tbody>
          </table>
          <h3>Total: {venta ? formatoCLP(venta.total) : "—"}</h3>
        </div>

        {!yaConfirmada && (
          <div className="tarjeta">
            <h2>Cobro</h2>
            <p className="ayuda">
              Normalmente el cliente paga al recibir — déjalo pendiente y regístralo después en "Pedidos online
              pendientes de pago". Solo marca "ya pagó" si el cliente pagó al momento (ej. transferencia confirmada).
            </p>
            <div className="acciones-formulario">
              <button
                type="button"
                className="boton boton-primario"
                disabled={procesandoCobro !== null}
                onClick={() => cobrar("pendiente")}
              >
                {procesandoCobro === "pendiente" ? "Confirmando..." : "Dejar pendiente de pago y confirmar"}
              </button>
              <button type="button" disabled={procesandoCobro !== null} onClick={() => cobrar("efectivo")}>
                {procesandoCobro === "efectivo" ? "Confirmando..." : "Ya pagó — efectivo"}
              </button>
              <button type="button" disabled={procesandoCobro !== null} onClick={() => cobrar("tarjeta")}>
                {procesandoCobro === "tarjeta" ? "Confirmando..." : "Ya pagó — tarjeta"}
              </button>
            </div>
          </div>
        )}

        {yaConfirmada && venta && (
          <div className="tarjeta">
            <p className="exito">Venta confirmada.</p>
            <button type="button" onClick={() => setVentaParaImprimir(venta)}>
              Reimprimir ticket
            </button>
          </div>
        )}

        {itemAAnular != null && (
          <ModalConfirmarClave
            titulo="Quitar producto"
            descripcion="Requiere clave de supervisor, igual que en Punto de Venta."
            onConfirmar={confirmarAnularItem}
            onCancelar={() => setItemAAnular(null)}
          />
        )}
      </div>

      <div className="vale-oculto-hasta-imprimir">{ventaParaImprimir && <ValeVenta venta={ventaParaImprimir} />}</div>
    </>
  );
}

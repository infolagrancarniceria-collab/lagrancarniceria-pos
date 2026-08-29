import { useEffect, useState, type FormEvent } from "react";
import { api, formatoCLP, formatoPeso, type PedidoWeb, type Producto } from "../api";
import { etiquetaPedido, subtotalItem, totalPedido, ValePedidoWeb } from "../components/ValePedidoWeb";
import { RutaDespacho } from "../components/RutaDespacho";
import { useUsuario } from "../context/UsuarioContext";
import { imprimirPedidoWeb, imprimirRutaDespacho } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

const ESTADOS = ["pendiente", "atendido", "anulado"] as const;

const MOTIVOS_ANULACION = ["Cliente se arrepintió", "Pedido duplicado", "No contesta"];

interface FormularioDescuento {
  tipo: "porcentaje" | "monto";
  valor: string;
  motivo: string;
}

function formularioDesde(p: PedidoWeb): FormularioDescuento {
  return {
    tipo: p.descuentoTipo ?? "porcentaje",
    valor: p.descuentoValor != null ? String(p.descuentoValor) : "",
    motivo: p.descuentoMotivo ?? "",
  };
}

function etiquetaCantidadProducto(producto: Producto): string {
  return producto.flagBalanza === "NORMAL" ? "Cantidad (unidades)" : "Cantidad (kg)";
}

export default function PedidosWeb() {
  const { usuario } = useUsuario();
  const [estado, setEstado] = useState<(typeof ESTADOS)[number]>("pendiente");
  const [pedidos, setPedidos] = useState<PedidoWeb[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [anulando, setAnulando] = useState<PedidoWeb | null>(null);
  const [descuentoEditId, setDescuentoEditId] = useState<number | null>(null);
  const [formDescuento, setFormDescuento] = useState<FormularioDescuento | null>(null);
  const [guardandoDescuento, setGuardandoDescuento] = useState(false);
  const [pedidoParaImprimir, setPedidoParaImprimir] = useState<PedidoWeb | null>(null);

  const [regaloEditId, setRegaloEditId] = useState<number | null>(null);
  const [regaloBusqueda, setRegaloBusqueda] = useState("");
  const [regaloResultados, setRegaloResultados] = useState<Producto[]>([]);
  const [regaloSeleccionado, setRegaloSeleccionado] = useState<Producto | null>(null);
  const [regaloCantidad, setRegaloCantidad] = useState("");
  const [guardandoRegalo, setGuardandoRegalo] = useState(false);

  // Selección para la hoja de ruta de despacho — un Map (no un Set de ids)
  // para no perder los datos del pedido si se cambia de pestaña mientras
  // hay pedidos elegidos de otra (ej. algunos de "Pendientes" y otros de
  // "Atendidos"), ya que "pedidos" solo trae los de la pestaña activa.
  const [seleccionRuta, setSeleccionRuta] = useState<Map<number, PedidoWeb>>(new Map());
  const [rutaParaImprimir, setRutaParaImprimir] = useState<PedidoWeb[] | null>(null);
  const [enviandoACajaId, setEnviandoACajaId] = useState<number | null>(null);

  function cargar() {
    setCargando(true);
    api.pedidosWeb
      .listar(estado)
      .then(setPedidos)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [estado]);

  useEffect(() => {
    if (!pedidoParaImprimir) return;
    imprimirPedidoWeb()
      .catch(() =>
        setError(
          "No se pudo imprimir — revisa que este PC tenga una impresora elegida en Configuración → Impresoras (Pedidos web) y que esté conectada."
        )
      )
      .finally(() => setPedidoParaImprimir(null));
  }, [pedidoParaImprimir]);

  useEffect(() => {
    if (!rutaParaImprimir) return;
    imprimirRutaDespacho()
      .catch(() =>
        setError(
          "No se pudo imprimir la ruta — revisa que este PC tenga una impresora elegida en Configuración → Impresoras (Pedidos web) y que esté conectada."
        )
      )
      .finally(() => setRutaParaImprimir(null));
  }, [rutaParaImprimir]);

  function alternarSeleccionRuta(p: PedidoWeb) {
    setSeleccionRuta((actual) => {
      const nuevo = new Map(actual);
      if (nuevo.has(p.id)) nuevo.delete(p.id);
      else nuevo.set(p.id, p);
      return nuevo;
    });
  }

  function imprimirRuta() {
    setRutaParaImprimir(Array.from(seleccionRuta.values()));
  }

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

  async function confirmarAnular(usuarioId: number, clave: string, motivo?: string) {
    if (!anulando) return;
    await api.pedidosWeb.anular(anulando.id, usuarioId, clave, motivo ?? "");
    mostrarToast("Pedido anulado", `El pedido de ${anulando.clienteNombre} quedó anulado.`, "eliminado");
    setAnulando(null);
    cargar();
  }

  function abrirDescuento(p: PedidoWeb) {
    setDescuentoEditId(p.id);
    setFormDescuento(formularioDesde(p));
  }

  async function guardarDescuento(p: PedidoWeb, e: FormEvent) {
    e.preventDefault();
    if (!usuario || !formDescuento) return;
    const valor = Number(formDescuento.valor);
    if (!formDescuento.valor.trim() || Number.isNaN(valor) || valor < 0) {
      setError("El valor del descuento no es válido");
      return;
    }
    setGuardandoDescuento(true);
    try {
      await api.pedidosWeb.aplicarDescuento(p.id, usuario.id, {
        descuentoTipo: formDescuento.tipo,
        descuentoValor: valor,
        descuentoMotivo: formDescuento.motivo.trim() || null,
      });
      mostrarToast("Descuento guardado", `Se aplicó un descuento al pedido de ${p.clienteNombre}.`);
      setDescuentoEditId(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoDescuento(false);
    }
  }

  async function quitarDescuento(p: PedidoWeb) {
    if (!usuario) return;
    try {
      await api.pedidosWeb.aplicarDescuento(p.id, usuario.id, null);
      mostrarToast("Descuento quitado", `Se quitó el descuento del pedido de ${p.clienteNombre}.`, "eliminado");
      setDescuentoEditId(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function abrirRegalo(p: PedidoWeb) {
    setRegaloEditId(p.id);
    setRegaloBusqueda("");
    setRegaloResultados([]);
    setRegaloSeleccionado(null);
    setRegaloCantidad("");
  }

  function cerrarRegalo() {
    setRegaloEditId(null);
    setRegaloSeleccionado(null);
  }

  useEffect(() => {
    if (regaloEditId == null || regaloSeleccionado || !regaloBusqueda.trim()) {
      setRegaloResultados([]);
      return;
    }
    api.productos
      .listar({ buscar: regaloBusqueda })
      .then((r) => setRegaloResultados(r.slice(0, 8)))
      .catch(() => setRegaloResultados([]));
  }, [regaloBusqueda, regaloEditId, regaloSeleccionado]);

  async function agregarRegalo(p: PedidoWeb, e: FormEvent) {
    e.preventDefault();
    if (!usuario || !regaloSeleccionado) return;
    const cantidad = Number(regaloCantidad);
    if (!regaloCantidad.trim() || Number.isNaN(cantidad) || cantidad <= 0) {
      setError("La cantidad del regalo no es válida");
      return;
    }
    setGuardandoRegalo(true);
    try {
      await api.pedidosWeb.agregarRegalo(p.id, usuario.id, regaloSeleccionado.id, cantidad);
      mostrarToast("Regalo agregado", `${regaloSeleccionado.descripcion} se agregó de regalo al pedido de ${p.clienteNombre}.`);
      cerrarRegalo();
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoRegalo(false);
    }
  }

  async function quitarRegalo(p: PedidoWeb, regalo: PedidoWeb["regalos"][number]) {
    if (!usuario) return;
    try {
      await api.pedidosWeb.quitarRegalo(p.id, regalo.id, usuario.id);
      mostrarToast("Regalo quitado", `Se repuso el stock de ${regalo.producto.descripcion}.`, "eliminado");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function enviarACaja(p: PedidoWeb) {
    if (!usuario) return;
    setEnviandoACajaId(p.id);
    try {
      const { ventaId } = await api.pedidosWeb.enviarACaja(p.id, usuario.id);
      mostrarToast(
        "Enviado a Caja",
        `Pedido de ${p.clienteNombre} quedó como venta #${ventaId}, a crédito pendiente de cobrar.`
      );
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviandoACajaId(null);
    }
  }

  return (
    <>
    <div className="no-imprimir">
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
            {e === "pendiente" ? "Pendientes" : e === "atendido" ? "Atendidos" : "Anulados"}
          </button>
        ))}
      </div>

      {seleccionRuta.size > 0 && (
        <div className="tarjeta fila-inline">
          <span>
            {seleccionRuta.size} pedido{seleccionRuta.size === 1 ? "" : "s"} de despacho seleccionado
            {seleccionRuta.size === 1 ? "" : "s"} para la ruta.
          </span>
          <button type="button" className="boton boton-primario" onClick={imprimirRuta}>
            Imprimir ruta de despacho
          </button>
          <button type="button" onClick={() => setSeleccionRuta(new Map())}>
            Limpiar selección
          </button>
        </div>
      )}

      {cargando && <p>Cargando...</p>}

      {!cargando && pedidos.length === 0 && (
        <p>
          No hay pedidos {estado === "pendiente" ? "pendientes" : estado === "atendido" ? "atendidos" : "anulados"} por
          ahora.
        </p>
      )}

      {pedidos.map((p) => {
        const total = totalPedido(p);
        return (
          <section key={p.id} className="tarjeta">
            <div className="encabezado-pantalla">
              <h2>
                {etiquetaPedido(p)} — {p.clienteNombre}
              </h2>
              <span>{new Date(p.fecha).toLocaleString("es-CL")}</span>
            </div>
            {p.tipoEntrega === "despacho" && p.estado !== "anulado" && (
              <label className="fila-inline">
                <input type="checkbox" checked={seleccionRuta.has(p.id)} onChange={() => alternarSeleccionRuta(p)} />
                Incluir en la ruta de despacho
              </label>
            )}
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
                  <th>Precio</th>
                  <th>Subtotal</th>
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
                    <td>
                      {item.precioUnitario != null
                        ? `${formatoCLP(item.precioUnitario)} ${item.unidad === "kg" ? "/kg" : "/un."}`
                        : "—"}
                    </td>
                    <td>{subtotalItem(item) != null ? formatoCLP(subtotalItem(item)!) : "—"}</td>
                    <td>{item.instrucciones ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {p.descuentoTipo && descuentoEditId !== p.id && (
              <p>
                <strong>Descuento:</strong>{" "}
                {p.descuentoTipo === "porcentaje" ? `${p.descuentoValor}%` : formatoCLP(p.descuentoValor ?? 0)}
                {p.descuentoMotivo ? ` — ${p.descuentoMotivo}` : ""}
              </p>
            )}

            <p>
              <strong>Total:</strong> {total != null ? formatoCLP(total) : "por calcular en Caja (falta precio en algún ítem)"}
            </p>

            {p.regalos.length > 0 && (
              <div>
                <strong>Regalos (sin costo, ya descontados del stock):</strong>
                <ul>
                  {p.regalos.map((r) => (
                    <li key={r.id}>
                      {r.producto.descripcion} — {r.cantidad} {r.producto.flagBalanza === "NORMAL" ? "un." : "kg"} (agregó{" "}
                      {r.agregadoPor.nombre})
                      {p.estado !== "anulado" && (
                        <>
                          {" "}
                          <button type="button" onClick={() => quitarRegalo(p, r)}>
                            Quitar
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.ventaGeneradaId && (
              <p className="exito">Enviado a Caja — venta #{p.ventaGeneradaId} (crédito pendiente de cobrar).</p>
            )}

            {p.comentario && (
              <p>
                <strong>Comentario del cliente:</strong> {p.comentario}
              </p>
            )}

            {p.estado === "anulado" && (
              <p className="error">
                Anulado — {p.motivoAnulacion ?? "sin motivo especificado"}
                {p.anuladoEn ? `, ${new Date(p.anuladoEn).toLocaleString("es-CL")}` : ""}
              </p>
            )}

            {descuentoEditId === p.id && formDescuento && (
              <form className="formulario" onSubmit={(e) => guardarDescuento(p, e)}>
                <h3>Aplicar descuento</h3>
                <p className="ayuda">
                  Queda como anotación para quien cobre en Caja — el pedido web es solo una cotización, el descuento
                  real se aplica al vender.
                </p>
                <div className="fila-inline">
                  <label>
                    Tipo
                    <select
                      value={formDescuento.tipo}
                      onChange={(e) => setFormDescuento({ ...formDescuento, tipo: e.target.value as "porcentaje" | "monto" })}
                    >
                      <option value="porcentaje">Porcentaje (%)</option>
                      <option value="monto">Monto ($)</option>
                    </select>
                  </label>
                  <label>
                    Valor
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formDescuento.valor}
                      onChange={(e) => setFormDescuento({ ...formDescuento, valor: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Motivo (opcional)
                  <input
                    type="text"
                    value={formDescuento.motivo}
                    onChange={(e) => setFormDescuento({ ...formDescuento, motivo: e.target.value })}
                    placeholder="Ej: cliente frecuente"
                  />
                </label>
                <div className="acciones-formulario">
                  <button type="submit" className="boton boton-primario" disabled={guardandoDescuento}>
                    {guardandoDescuento ? "Guardando..." : "Guardar"}
                  </button>
                  {p.descuentoTipo && (
                    <button type="button" onClick={() => quitarDescuento(p)} disabled={guardandoDescuento}>
                      Quitar descuento
                    </button>
                  )}
                  <button type="button" onClick={() => setDescuentoEditId(null)} disabled={guardandoDescuento}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {regaloEditId === p.id && (
              <form className="formulario" onSubmit={(e) => agregarRegalo(p, e)}>
                <h3>Agregar regalo</h3>
                <p className="ayuda">
                  No le cobra nada al cliente, pero descuenta el producto real del stock apenas se agrega.
                </p>
                {!regaloSeleccionado && (
                  <label>
                    Buscar producto
                    <input
                      type="text"
                      value={regaloBusqueda}
                      onChange={(e) => setRegaloBusqueda(e.target.value)}
                      placeholder="Ej: longaniza"
                      autoFocus
                    />
                  </label>
                )}
                {!regaloSeleccionado && regaloResultados.length > 0 && (
                  <ul className="lista-resultados">
                    {regaloResultados.map((prod) => (
                      <li key={prod.id}>
                        <button type="button" onClick={() => setRegaloSeleccionado(prod)}>
                          {prod.descripcion} {prod.marca ? `— ${prod.marca}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {regaloSeleccionado && (
                  <>
                    <p>
                      <strong>Producto:</strong> {regaloSeleccionado.descripcion}{" "}
                      <button type="button" onClick={() => setRegaloSeleccionado(null)}>
                        Cambiar
                      </button>
                    </p>
                    <label>
                      {etiquetaCantidadProducto(regaloSeleccionado)}
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={regaloCantidad}
                        onChange={(e) => setRegaloCantidad(e.target.value)}
                        autoFocus
                      />
                    </label>
                  </>
                )}
                <div className="acciones-formulario">
                  <button type="submit" className="boton boton-primario" disabled={guardandoRegalo || !regaloSeleccionado}>
                    {guardandoRegalo ? "Guardando..." : "Agregar"}
                  </button>
                  <button type="button" onClick={cerrarRegalo} disabled={guardandoRegalo}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            <div className="acciones-formulario">
              {p.estado === "pendiente" && (
                <button type="button" className="boton boton-primario" onClick={() => marcarAtendido(p)}>
                  Marcar como atendido
                </button>
              )}
              {p.estado !== "anulado" && (
                <button type="button" onClick={() => setAnulando(p)}>
                  Anular pedido
                </button>
              )}
              {p.estado !== "anulado" && descuentoEditId !== p.id && (
                <button type="button" onClick={() => abrirDescuento(p)}>
                  {p.descuentoTipo ? "Editar descuento" : "Aplicar descuento"}
                </button>
              )}
              {p.estado !== "anulado" && regaloEditId !== p.id && (
                <button type="button" onClick={() => abrirRegalo(p)}>
                  Agregar regalo
                </button>
              )}
              {p.estado !== "anulado" && !p.ventaGeneradaId && (
                <button type="button" onClick={() => enviarACaja(p)} disabled={enviandoACajaId === p.id}>
                  {enviandoACajaId === p.id ? "Enviando..." : "Enviar a Caja"}
                </button>
              )}
              <button type="button" onClick={() => setPedidoParaImprimir(p)}>
                Imprimir
              </button>
            </div>
          </section>
        );
      })}

      {anulando && (
        <ModalConfirmarClave
          titulo="Anular pedido"
          descripcion={`Se anula el pedido de ${anulando.clienteNombre}. Elige el motivo, quién autoriza y la clave de supervisor.`}
          motivoOpciones={MOTIVOS_ANULACION}
          onConfirmar={confirmarAnular}
          onCancelar={() => setAnulando(null)}
        />
      )}
    </div>

    <div className="vale-oculto-hasta-imprimir">
      {pedidoParaImprimir && <ValePedidoWeb pedido={pedidoParaImprimir} />}
      {rutaParaImprimir && <RutaDespacho pedidos={rutaParaImprimir} />}
    </div>
    </>
  );
}

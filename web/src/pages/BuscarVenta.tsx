import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatoCLP, type Venta } from "../api";
import ModalConfirmarClave from "../components/ModalConfirmarClave";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const etiquetaMedio: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  credito: "Crédito",
};

// En la app instalada (Electron), imprime directo en la impresora
// predeterminada sin ningún diálogo. En un navegador normal (ej. el PC del
// mesón conectado por WiFi sin el programa instalado) window.electronAPI no
// existe — ahí se usa el print() normal del navegador, que sí muestra su
// propio diálogo por seguridad (no hay forma de evitarlo desde una página
// web común).
function imprimirVale() {
  if (window.electronAPI) {
    window.electronAPI.imprimirSilencioso();
  } else {
    window.print();
  }
}

export default function BuscarVenta() {
  const [desde, setDesde] = useState(fechaHace(7));
  const [hasta, setHasta] = useState(hoy());
  const [numeroVenta, setNumeroVenta] = useState("");
  const [resultados, setResultados] = useState<Venta[]>([]);
  const [ventaDetalle, setVentaDetalle] = useState<Venta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [anulandoVenta, setAnulandoVenta] = useState(false);

  // Confirmar una venta en Punto de Venta redirige acá con ?imprimir=<id>
  // para imprimir el vale automáticamente, sin tener que buscarla a mano
  // después. Se captura el ID una sola vez al montar (no se vuelve a leer
  // de la URL) para no reintentar la impresión si el usuario navega o
  // refresca la pantalla — el parámetro se limpia de la URL apenas se usa.
  const [searchParams, setSearchParams] = useSearchParams();
  const [idAImprimir] = useState(() => searchParams.get("imprimir"));

  useEffect(() => {
    if (!idAImprimir) return;
    api.caja
      .obtenerVenta(Number(idAImprimir))
      .then(setVentaDetalle)
      .catch((e) => setError((e as Error).message));
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (idAImprimir && ventaDetalle?.id === Number(idAImprimir)) {
      imprimirVale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventaDetalle]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVentaDetalle(null);
    setCargando(true);
    try {
      const datos = await api.caja.buscarVentas({
        desde,
        hasta,
        ventaId: numeroVenta ? Number(numeroVenta) : undefined,
      });
      setResultados(datos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  async function verDetalle(ventaId: number) {
    setError(null);
    try {
      const venta = await api.caja.obtenerVenta(ventaId);
      setVentaDetalle(venta);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const itemsActivos = ventaDetalle?.items.filter((i) => !i.anulado) ?? [];
  const itemsAnulados = ventaDetalle?.items.filter((i) => i.anulado) ?? [];

  // Anular una venta YA pagada devuelve el stock de todos sus productos —
  // por eso pide clave de supervisor igual que anular un ítem o cancelar una
  // venta antes de pagar (mismo modal, ModalConfirmarClave). Solo funciona
  // mientras la caja del día en que se hizo la venta siga abierta (lo valida
  // el servidor); para ventas de un día ya cerrado, el error explica que hay
  // que corregir el stock a mano en Inventario.
  async function confirmarAnularVenta(usuarioId: number, clave: string, motivo?: string) {
    if (!ventaDetalle) return;
    setError(null);
    await api.caja.cancelarVenta(ventaDetalle.id, { usuarioId, clave, motivo });
    const actualizada = await api.caja.obtenerVenta(ventaDetalle.id);
    setVentaDetalle(actualizada);
    setAnulandoVenta(false);
  }

  return (
    <div>
      <div className="no-imprimir">
        <h1>Buscar venta</h1>
        {error && <p className="error">{error}</p>}

        <form onSubmit={buscar} className="fila-inline">
          <label>
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <input
            type="number"
            placeholder="N° de venta (opcional)"
            value={numeroVenta}
            onChange={(e) => setNumeroVenta(e.target.value)}
          />
          <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
        </form>

        <table className="tabla">
          <thead>
            <tr>
              <th>N° venta</th>
              <th>Fecha</th>
              <th>Vendedor</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {resultados.map((v) => (
              <tr key={v.id}>
                <td>#{v.id}</td>
                <td>{new Date(v.fecha).toLocaleString("es-CL")}</td>
                <td>{v.usuario?.nombre ?? "—"}</td>
                <td>{formatoCLP(v.total)}</td>
                <td>
                  <button type="button" onClick={() => verDetalle(v.id)}>
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
            {resultados.length === 0 && (
              <tr>
                <td colSpan={5}>Sin resultados — prueba buscar por otra fecha o N° de venta.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ventaDetalle && (
        <div className="vale">
          <div className="no-imprimir fila-inline">
            <button type="button" onClick={imprimirVale}>
              Imprimir
            </button>
            {ventaDetalle.estado === "pagada" && (
              <button type="button" onClick={() => setAnulandoVenta(true)}>
                Anular venta
              </button>
            )}
          </div>
          {ventaDetalle.estado === "anulada" && (
            <p className="error no-imprimir">
              Venta anulada — {ventaDetalle.motivoAnulacion ?? "sin motivo especificado"}
              {ventaDetalle.usuarioAnulacion ? ` (autorizó: ${ventaDetalle.usuarioAnulacion.nombre})` : ""}
              {ventaDetalle.fechaAnulacion ? `, ${new Date(ventaDetalle.fechaAnulacion).toLocaleString("es-CL")}` : ""}
            </p>
          )}
          <h2>La Gran Carnicería</h2>
          <p>
            Venta #{ventaDetalle.id} — {new Date(ventaDetalle.fecha).toLocaleString("es-CL")}
          </p>
          <p>Vendedor: {ventaDetalle.usuario?.nombre ?? "—"}</p>
          {ventaDetalle.comentario && <p>Comentario: {ventaDetalle.comentario}</p>}
          {ventaDetalle.esDespacho && (
            <p>
              Despacho a {ventaDetalle.comuna?.nombre ?? "—"} ({formatoCLP(ventaDetalle.costoEnvio ?? 0)})
            </p>
          )}
          <table className="tabla tabla-vale">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant.</th>
                <th>Precio</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {itemsActivos.map((item) => (
                <tr key={item.id}>
                  <td>{item.producto.descripcion}</td>
                  <td>{item.cantidad}</td>
                  <td>{formatoCLP(item.precioUnitario)}</td>
                  <td>
                    {formatoCLP(item.subtotal)}
                    {item.descuentoTipo && (
                      <div className="ayuda">
                        desc. {item.descuentoTipo === "porcentaje" ? `${item.descuentoValor}%` : formatoCLP(item.descuentoValor ?? 0)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {itemsAnulados.length > 0 && (
            <div className="no-imprimir">
              <h3>Productos anulados</h3>
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Motivo</th>
                    <th>Anulado por</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsAnulados.map((item) => (
                    <tr key={item.id}>
                      <td>{item.producto.descripcion}</td>
                      <td>{item.cantidad}</td>
                      <td>{item.motivoAnulacion ?? "—"}</td>
                      <td>{item.usuarioAnulacion?.nombre ?? "—"}</td>
                      <td>{item.fechaAnulacion ? new Date(item.fechaAnulacion).toLocaleString("es-CL") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ventaDetalle.descuentoTipo && (
            <p>
              Subtotal: {formatoCLP(itemsActivos.reduce((s, i) => s + i.subtotal, 0))} · Descuento:{" "}
              {ventaDetalle.descuentoTipo === "porcentaje"
                ? `${ventaDetalle.descuentoValor}%`
                : formatoCLP(ventaDetalle.descuentoValor ?? 0)}
            </p>
          )}
          <h2>Total: {formatoCLP(ventaDetalle.total)}</h2>
          <h3>Pagos</h3>
          <ul>
            {ventaDetalle.pagos.map((p) => (
              <li key={p.id}>
                {etiquetaMedio[p.medio] ?? p.medio}
                {p.medio === "credito" ? ` (${p.clienteNombre})` : ""}: {formatoCLP(p.monto)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {anulandoVenta && (
        <ModalConfirmarClave
          titulo="Anular venta"
          descripcion="Se devuelve el stock de todos los productos de esta venta. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={["Cliente devolvió la compra", "Venta duplicada", "Error del cajero"]}
          onConfirmar={confirmarAnularVenta}
          onCancelar={() => setAnulandoVenta(false)}
        />
      )}
    </div>
  );
}

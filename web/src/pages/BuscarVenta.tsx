import { useEffect, useState } from "react";
import { api, formatoCLP, type Venta } from "../api";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { ValeVenta } from "../components/ValeVenta";
import { imprimirSilencioso as imprimirVale } from "../lib/imprimir";
import { useFiltroUrl } from "../hooks/useFiltroUrl";
import ModalAlerta from "../components/ModalAlerta";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BuscarVenta() {
  // En la URL, no en useState suelto — así "← Volver" recupera el mismo
  // filtro (y vuelve a buscar sola, ver el useEffect de abajo) al regresar
  // a esta pantalla (ver hooks/useFiltroUrl.ts).
  const [desde, setDesde] = useFiltroUrl("desde", fechaHace(7));
  const [hasta, setHasta] = useFiltroUrl("hasta", hoy());
  const [numeroVenta, setNumeroVenta] = useFiltroUrl("numeroVenta");
  const [resultados, setResultados] = useState<Venta[]>([]);
  const [ventaDetalle, setVentaDetalle] = useState<Venta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [anulandoVenta, setAnulandoVenta] = useState(false);

  async function buscarConFiltroActual() {
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

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    void buscarConFiltroActual();
  }

  // Busca sola al entrar a la pantalla (ej. al volver desde otra con la
  // flecha "← Volver") — antes se quedaba en blanco hasta apretar "Buscar"
  // a mano, incluso si ya venía con un filtro puesto desde la URL.
  useEffect(() => {
    void buscarConFiltroActual();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verDetalle(ventaId: number) {
    setError(null);
    try {
      const venta = await api.caja.obtenerVenta(ventaId);
      setVentaDetalle(venta);
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

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
        <ValeVenta venta={ventaDetalle} onImprimir={imprimirVale} onAnular={() => setAnulandoVenta(true)} />
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

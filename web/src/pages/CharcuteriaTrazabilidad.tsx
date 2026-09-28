import { useEffect, useState } from "react";
import { api, formatoCLP, type ItemCharcuteria, type LoteProduccion, type TrazabilidadItem, type TrazabilidadLote } from "../api";
import ModalAlerta from "../components/ModalAlerta";

export default function CharcuteriaTrazabilidad() {
  const [error, setError] = useState<string | null>(null);

  // Hacia atrás: lote → materia prima/insumos
  const [lotes, setLotes] = useState<LoteProduccion[]>([]);
  const [loteId, setLoteId] = useState("");
  const [trazaLote, setTrazaLote] = useState<TrazabilidadLote | null>(null);

  // Hacia adelante: materia prima → lotes/ventas
  const [items, setItems] = useState<ItemCharcuteria[]>([]);
  const [itemId, setItemId] = useState("");
  const [trazaItem, setTrazaItem] = useState<TrazabilidadItem | null>(null);

  useEffect(() => {
    api.charcuteria.lotes.listar().then(setLotes);
    api.charcuteria.items.listar({ tipoItem: "materia_prima" }).then(setItems);
  }, []);

  async function buscarLote() {
    if (!loteId) return;
    setError(null);
    try {
      setTrazaLote(await api.charcuteria.reportes.trazabilidadLote(Number(loteId)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function buscarItem() {
    if (!itemId) return;
    setError(null);
    try {
      setTrazaItem(await api.charcuteria.reportes.trazabilidadItem(Number(itemId)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Trazabilidad</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta">
        <h2>De un lote hacia su materia prima</h2>
        <div className="fila-inline">
          <select value={loteId} onChange={(e) => setLoteId(e.target.value)}>
            <option value="">— elegir lote —</option>
            {lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.codigo}
              </option>
            ))}
          </select>
          <button type="button" className="boton boton-primario" onClick={buscarLote}>
            Buscar
          </button>
        </div>

        {trazaLote && (
          <div>
            <p>
              <strong>{trazaLote.lote.codigo}</strong> — {trazaLote.lote.productoElaborado} (
              {new Date(trazaLote.lote.fechaElaboracion).toLocaleDateString("es-CL")})
            </p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Cantidad</th>
                  <th>Costo</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {trazaLote.insumos.map((i, idx) => (
                  <tr key={idx}>
                    <td>{i.item}</td>
                    <td>
                      {i.cantidad} {i.unidad === "gramos" ? "g" : "un."}
                    </td>
                    <td>{formatoCLP(i.costoUnitarioAlMomento)}</td>
                    <td>
                      {i.transferencia
                        ? `Transferencia de "${i.transferencia.productoOrigen}" (${i.transferencia.pluOrigen}), ${new Date(
                            i.transferencia.fecha
                          ).toLocaleDateString("es-CL")}`
                        : "Compra directa"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <strong>SKU generados:</strong>{" "}
              {trazaLote.skusGenerados.map((s) => `${s.sku} (${s.unidades} un.)`).join(", ") || "ninguno todavía"}
            </p>
          </div>
        )}
      </div>

      <div className="tarjeta">
        <h2>De una materia prima hacia sus lotes y ventas</h2>
        <div className="fila-inline">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">— elegir materia prima —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
              </option>
            ))}
          </select>
          <button type="button" className="boton boton-primario" onClick={buscarItem}>
            Buscar
          </button>
          {itemId && (
            <a className="boton" href={api.charcuteria.reportes.trazabilidadItemCsvUrl(Number(itemId))} target="_blank" rel="noreferrer">
              Exportar CSV
            </a>
          )}
        </div>

        {trazaItem && (
          <div>
            <h3>Transferencias que lo trajeron</h3>
            <ul>
              {trazaItem.transferencias.map((t, idx) => (
                <li key={idx}>
                  {new Date(t.fecha).toLocaleDateString("es-CL")} — {t.cantidad} kg de "{t.productoOrigen}" a{" "}
                  {formatoCLP(t.precioPorKg)}/kg
                </li>
              ))}
              {trazaItem.transferencias.length === 0 && <li>Sin transferencias registradas.</li>}
            </ul>

            <h3>Lotes que lo consumieron</h3>
            {trazaItem.lotesQueLoUsaron.map((l) => (
              <div key={l.loteId} className="tarjeta tarjeta-mini">
                <p>
                  <strong>{l.codigo}</strong> — {l.productoElaborado} · usó {l.cantidadUsada} g
                </p>
                <ul>
                  {l.ventas.map((v, idx) => (
                    <li key={idx}>
                      Venta #{v.ventaId} — {new Date(v.fecha).toLocaleDateString("es-CL")} — {v.producto} ×{v.cantidad}
                    </li>
                  ))}
                  {l.ventas.length === 0 && <li>Sin ventas todavía.</li>}
                </ul>
              </div>
            ))}
            {trazaItem.lotesQueLoUsaron.length === 0 && <p>Sin lotes que lo hayan usado todavía.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

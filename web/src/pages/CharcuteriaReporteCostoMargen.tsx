import { useEffect, useState } from "react";
import { api, formatoCLP, type ReporteCostoMargenLote } from "../api";
import ModalAlerta from "../components/ModalAlerta";

export default function CharcuteriaReporteCostoMargen() {
  const [lotes, setLotes] = useState<ReporteCostoMargenLote[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.charcuteria.reportes.costoMargen().then(setLotes).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Costo y margen por SKU y lote</h1>
      <p className="ayuda">Solo lotes terminados, envasados o cerrados — un lote en proceso todavía no tiene costo real que mostrar.</p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      {lotes.map((l) => (
        <div key={l.loteId} className="tarjeta">
          <h2>
            {l.codigo} — {l.productoElaborado}
          </h2>
          <p>
            <strong>Estado:</strong> {l.estado} · <strong>Peso salida:</strong> {l.pesoSalidaKg} kg ·{" "}
            <strong>Merma real:</strong> {l.mermaRealPct != null ? `${l.mermaRealPct}%` : "—"} (esperada:{" "}
            {l.mermaEsperadaPct != null ? `${Math.round(l.mermaEsperadaPct)}%` : "—"})
          </p>
          <p>
            <strong>Costo total del lote:</strong> {l.costoTotal != null ? formatoCLP(l.costoTotal) : "—"} ·{" "}
            <strong>Costo por kg elaborado:</strong> {l.costoPorKgElaborado != null ? formatoCLP(Math.round(l.costoPorKgElaborado)) : "—"}
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Formato</th>
                <th>Costo/unidad</th>
                <th>Precio venta</th>
                <th>Margen</th>
                <th>Margen real</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {l.skus.map((s) => (
                <tr key={s.skuId}>
                  <td>{s.nombre}</td>
                  <td>{s.formatoGramos} g</td>
                  <td>{s.costoPorUnidad != null ? formatoCLP(s.costoPorUnidad) : "—"}</td>
                  <td>{s.precioVenta != null ? formatoCLP(s.precioVenta) : "—"}</td>
                  <td>{s.margenPct != null ? `${s.margenPct.toFixed(1)}%` : "—"}</td>
                  <td>{s.margenRealPct != null ? `${s.margenRealPct.toFixed(1)}%` : "—"}</td>
                  <td>{s.saldoUnidades} un.</td>
                </tr>
              ))}
              {l.skus.length === 0 && (
                <tr>
                  <td colSpan={7}>Sin unidades envasadas todavía.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      {lotes.length === 0 && <p>Sin lotes terminados todavía.</p>}
    </div>
  );
}

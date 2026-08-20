import { CodigoBarras } from "./CodigoBarras";

interface Props {
  numero: string;
  producto: string;
  familia: string;
  procedencia?: string | null;
  fechaIngreso: string;
  pesoInicialKg: number;
  pesoEstimado: boolean;
  imprimiendo: boolean;
}

// Layout 100×50mm, portado del prototipo camara_actual_referencia.html que
// el usuario ya probó imprimiendo bien en su impresora térmica Gainscha.
// Solo la etiqueta con imprimiendo=true queda visible durante la impresión
// (ver ".etiqueta" / ".etiqueta.imprimir-ahora" en styles.css) — las demás
// quedan igual en pantalla, para poder revisarlas o reimprimirlas después.
export function EtiquetaCamara({
  numero,
  producto,
  familia,
  procedencia,
  fechaIngreso,
  pesoInicialKg,
  pesoEstimado,
  imprimiendo,
}: Props) {
  return (
    <div className={`etiqueta${imprimiendo ? " imprimir-ahora" : ""}`}>
      <h3>LA GRAN CARNICERÍA</h3>
      <div className="codigo">
        CAJA <span>{numero}</span>
      </div>
      <div className="fila-etiqueta producto">
        <b>{producto}</b>
        <span>{procedencia ? `${familia} · ${procedencia}` : familia}</span>
      </div>
      <div className="fila-etiqueta">
        <span>
          Ingreso: <b>{new Date(fechaIngreso).toLocaleDateString("es-CL")}</b>
        </span>
        <span>
          {pesoEstimado ? "Peso estimado" : "Peso"}: <b>{pesoInicialKg.toFixed(3)} kg</b>
        </span>
      </div>
      <CodigoBarras texto={numero} className="barcode" />
      <div className="numero-barra">{numero}</div>
    </div>
  );
}

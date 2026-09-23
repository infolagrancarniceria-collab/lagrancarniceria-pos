import { calcularMargen, calcularMargenReal } from "../api";

interface ParMargenProps {
  precio: number;
  costo: number | null;
}

// Recargo (sobre el costo) y margen real (sobre la venta neta) uno al lado
// del otro — son dos lentes del mismo número (ver comentario de
// calcularMargenReal en api.ts), así que se muestran siempre juntos en
// cualquier pantalla que hable de "margen", para no dejar la duda de cuál
// de los dos es el que se está mostrando.
export default function ParMargen({ precio, costo }: ParMargenProps) {
  const recargo = calcularMargen(precio, costo);
  const margenReal = calcularMargenReal(precio, costo);
  if (recargo == null || margenReal == null) return <span className="ayuda">—</span>;
  return (
    <span className="fila-inline">
      <span className={`margen-destacado ${recargo < 0 ? "margen-negativo" : ""}`}>
        <span className="margen-etiqueta">Recargo</span> {recargo.toFixed(1)}%
      </span>
      <span className={`margen-destacado ${margenReal < 0 ? "margen-negativo" : ""}`}>
        <span className="margen-etiqueta">Margen real</span> {margenReal.toFixed(1)}%
      </span>
    </span>
  );
}

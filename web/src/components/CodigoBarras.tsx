import { generarBarrasCode128 } from "../lib/code128";

interface Props {
  texto: string;
  className?: string;
}

export function CodigoBarras({ texto, className }: Props) {
  const { barras, anchoTotal } = generarBarrasCode128(texto);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${anchoTotal} 120`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-label="Código de barras"
    >
      {barras.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.ancho} height={120} fill="#000" />
      ))}
    </svg>
  );
}

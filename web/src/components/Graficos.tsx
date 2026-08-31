// Gráficos livianos en SVG puro — a pedido del usuario, para poder ver los
// informes de Reportes también como gráfico, sin agregar ninguna librería
// nueva (el sistema corre sin depender de internet, ver CLAUDE.md, así que
// cada dependencia nueva pesa en el instalador). Tres tipos: barras
// (horizontales, para nombres largos de producto/comuna), torta/dona (para
// desgloses por categoría, ej. motivo de salida) y línea (para evolución en
// el tiempo, ej. ventas por día).

export const PALETA_GRAFICOS = [
  "#9c2c1c",
  "#a9781f",
  "#1e7a3c",
  "#0b6e99",
  "#6a4fb3",
  "#a15c00",
  "#5a5a5a",
  "#b3261e",
];

interface DatoGrafico {
  etiqueta: string;
  valor: number;
  color?: string;
}

export function GraficoBarras({
  datos,
  color = "var(--color-primario)",
  formatoValor = (n: number) => String(n),
}: {
  datos: DatoGrafico[];
  color?: string;
  formatoValor?: (n: number) => string;
}) {
  if (datos.length === 0) return <p className="ayuda">Sin datos para graficar.</p>;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  return (
    <div className="grafico-barras">
      {datos.map((d) => (
        <div className="fila-barra" key={d.etiqueta}>
          <span className="etiqueta-barra" title={d.etiqueta}>
            {d.etiqueta}
          </span>
          <div className="pista-barra">
            <div
              className="barra"
              style={{ width: `${max ? (d.valor / max) * 100 : 0}%`, background: d.color ?? color }}
            />
          </div>
          <span className="valor-barra">{formatoValor(d.valor)}</span>
        </div>
      ))}
    </div>
  );
}

export function GraficoTorta({
  datos,
  formatoValor = (n: number) => String(n),
}: {
  datos: DatoGrafico[];
  formatoValor?: (n: number) => string;
}) {
  const total = datos.reduce((s, d) => s + d.valor, 0);
  if (datos.length === 0 || total <= 0) return <p className="ayuda">Sin datos para graficar.</p>;

  const radio = 40;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;
  const segmentos = datos.map((d, i) => {
    const largo = (d.valor / total) * circunferencia;
    const dashoffset = -acumulado;
    acumulado += largo;
    return { ...d, color: d.color ?? PALETA_GRAFICOS[i % PALETA_GRAFICOS.length], largo, dashoffset };
  });

  return (
    <div className="grafico-torta">
      <svg viewBox="0 0 100 100" className="torta-svg" role="img">
        <g transform="rotate(-90 50 50)">
          {segmentos.map((s) => (
            <circle
              key={s.etiqueta}
              cx="50"
              cy="50"
              r={radio}
              fill="none"
              stroke={s.color}
              strokeWidth="20"
              strokeDasharray={`${s.largo} ${circunferencia - s.largo}`}
              strokeDashoffset={s.dashoffset}
            />
          ))}
        </g>
      </svg>
      <ul className="leyenda-torta">
        {segmentos.map((s) => (
          <li key={s.etiqueta}>
            <span className="leyenda-color" style={{ background: s.color }} />
            {s.etiqueta}: <strong>{formatoValor(s.valor)}</strong>{" "}
            <span className="ayuda">({((s.valor / total) * 100).toFixed(1)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GraficoLinea({
  datos,
  color = "var(--color-primario)",
  formatoValor = (n: number) => String(n),
}: {
  datos: { etiqueta: string; valor: number }[];
  color?: string;
  formatoValor?: (n: number) => string;
}) {
  if (datos.length === 0) return <p className="ayuda">Sin datos para graficar.</p>;

  const ancho = 600;
  const alto = 200;
  const relleno = 34;
  const maxValor = Math.max(...datos.map((d) => d.valor), 1);
  const puntos = datos.map((d, i) => {
    const x = datos.length > 1 ? relleno + (i / (datos.length - 1)) * (ancho - 2 * relleno) : ancho / 2;
    const y = alto - relleno - (d.valor / maxValor) * (alto - 2 * relleno);
    return { x, y, ...d };
  });
  const pathD = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Con muchos días, se muestran solo algunas etiquetas del eje X (primera,
  // última y algunas del medio) para que no se amontonen unas sobre otras.
  const maxEtiquetas = 8;
  const paso = Math.max(1, Math.ceil(puntos.length / maxEtiquetas));

  return (
    <div className="grafico-linea">
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="linea-svg" role="img" preserveAspectRatio="xMidYMid meet">
        <line x1={relleno} y1={alto - relleno} x2={ancho - relleno} y2={alto - relleno} stroke="var(--color-borde)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" />
        {puntos.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
        ))}
        {puntos.map((p, i) =>
          i % paso === 0 || i === puntos.length - 1 ? (
            <text key={`et-${i}`} x={p.x} y={alto - relleno + 16} fontSize="10" textAnchor="middle" fill="var(--color-texto-suave)">
              {p.etiqueta}
            </text>
          ) : null
        )}
        <text x={relleno} y={relleno - 12} fontSize="10" fill="var(--color-texto-suave)">
          Máx: {formatoValor(maxValor)}
        </text>
      </svg>
    </div>
  );
}

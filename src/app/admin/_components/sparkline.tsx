"use client";

/**
 * Sparkline de una sola serie.
 *
 * Deliberadamente monocromática y en *small multiples*: un gráfico por métrica
 * en vez de varias series en un mismo eje. Mensajes, respuestas de IA y llamadas
 * viven en escalas muy distintas — meterlas juntas obligaría a dos ejes (que
 * miente sobre la relación entre las series) o aplastaría la más chica contra
 * el piso. Una serie por caja evita ambas cosas y no necesita leyenda: el título
 * la nombra.
 *
 * El color sale de `currentColor`, así que sigue los tokens del tema y funciona
 * igual en claro y en oscuro sin una paleta aparte.
 */
export function Sparkline({
  values,
  label,
  className,
  height = 36,
}: {
  values: number[];
  /** Se usa para el texto accesible; el título visible lo pone quien llama. */
  label: string;
  className?: string;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ height }} aria-hidden />;
  }

  const width = 100; // viewBox relativo: el SVG escala al ancho del contenedor
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  // y invertido: 0 arriba en SVG. Se deja 2px de aire arriba y abajo para que
  // el trazo de 2px no se corte contra el borde del viewBox.
  const pad = 2;
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2);

  const points = values.map((v, i) => `${i * step},${y(v)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={label}
    >
      <path d={area} fill="currentColor" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

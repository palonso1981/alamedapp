export const COMPARISON_BAR_MAX_PERCENT = 82;

/** Reserva espacio exterior para que el valor pueda acompañar al extremo de la
 * barra incluso cuando esta representa el máximo de la comparación. */
export function comparisonBarPercentage(value: number | null, maximum: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0 || maximum <= 0) return 0;
  return Math.min(COMPARISON_BAR_MAX_PERCENT, value / maximum * COMPARISON_BAR_MAX_PERCENT);
}

export function comparisonBarValueStyle(side: "left" | "right", percentage: number): { left?: string; right?: string } {
  const offset = `calc(${percentage}% + 0.35rem)`;
  return side === "left" ? { right: offset } : { left: offset };
}

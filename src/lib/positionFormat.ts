const POSITION_LABELS: Record<string, string> = {
  GOALKEEPER: "PORTERO",
  PORTERO: "PORTERO",
  FIXO: "CIERRE",
  CIERRE: "CIERRE",
  WINGER: "ALA",
  ALA: "ALA",
  PIVOT: "PÍVOT",
  "PÍVOT": "PÍVOT",
  UNIVERSAL: "UNIVERSAL",
};

/** Normaliza exclusivamente la presentación; nunca cambia el valor persistido. */
export function formatFutsalPosition(value?: string | null, fallback = "SIN POSICIÓN"): string {
  const source = value?.trim();
  if (!source) return fallback;
  return POSITION_LABELS[source.toLocaleUpperCase("es-ES")] ?? source;
}

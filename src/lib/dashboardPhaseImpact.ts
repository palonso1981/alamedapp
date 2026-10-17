export type PhaseOrderMode = "VOLUME" | "IMPACT";

export function phaseImpactDelta(volumePercentage: number | null, goalPercentage: number | null): number | null {
  return volumePercentage === null || goalPercentage === null ? null : goalPercentage - volumePercentage;
}

export function orderPhaseRows<T>(rows: readonly T[], mode: PhaseOrderMode, values: (row: T) => ReadonlyArray<{ volumePercentage: number | null; goalPercentage: number | null }>): T[] {
  const score = (row: T) => Math.max(0, ...values(row).map((value) => mode === "VOLUME"
    ? value.volumePercentage ?? 0
    : Math.abs(phaseImpactDelta(value.volumePercentage, value.goalPercentage) ?? 0)));
  return [...rows].sort((left, right) => score(right) - score(left));
}

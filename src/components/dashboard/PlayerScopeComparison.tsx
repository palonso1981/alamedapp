import { PlayerAnalysis } from "../../lib/dashboardAnalysis";

const value = (number: number | null) => number === null ? "N/D" : Number.isInteger(number) ? String(number) : number.toFixed(1).replace(".", ",");
const perMatch = (number: number, matches: number) => matches > 0 ? number / matches : null;

export function PlayerScopeComparison({ left, right }: { left: PlayerAnalysis; right: PlayerAnalysis }) {
  if (left.matches === right.matches) return null;
  const rows = [
    ["MIN/PARTIDO", left.averageMinutes, right.averageMinutes],
    ["GOLES/PARTIDO", left.goalsPerMatch, right.goalsPerMatch],
    ["ASIST./PARTIDO", left.assistsPerMatch, right.assistsPerMatch],
    ["REMATES/PARTIDO", left.ownThreatsPerMatch, right.ownThreatsPerMatch],
    ["PÉRDIDAS/PARTIDO", left.possessionLossesPerMatch, right.possessionLossesPerMatch],
    ["A PUERTA/PARTIDO", perMatch(left.ownOnTarget, left.matches), perMatch(right.ownOnTarget, right.matches)],
    ["CERCANOS/PARTIDO", perMatch(left.ownNear, left.matches), perMatch(right.ownNear, right.matches)],
    ["GF EN PISTA/PART.", perMatch(left.onCourt.goalsFor, left.matches), perMatch(right.onCourt.goalsFor, right.matches)],
    ["GC EN PISTA/PART.", perMatch(left.onCourt.goalsAgainst, left.matches), perMatch(right.onCourt.goalsAgainst, right.matches)],
    ["PTS EN PISTA/PART.", left.onCourtPointsPerMatch, right.onCourtPointsPerMatch],
    ["% CLAVE", left.keyMinutesPercentage, right.keyMinutesPercentage],
    ["% ORO", left.goldMinutesPercentage, right.goldMinutesPercentage],
  ] as const;
  return <section aria-label="Comparación primaria normalizada por partido" className="rounded-3xl border border-amber-900 bg-amber-950/20 p-4"><header className="mb-3 flex items-center justify-between gap-3"><strong className="text-cyan-200">{left.name}</strong><span className="text-center text-[9px] font-black text-amber-200">COMPARACIÓN HOMOGÉNEA · POR PARTIDO</span><strong className="text-right text-amber-200">{right.name}</strong></header><div className="grid gap-1 sm:grid-cols-2">{rows.map(([label, a, b]) => <div key={label} className="grid grid-cols-[1fr_8rem_1fr] items-center rounded-xl bg-slate-950 px-3 py-2"><strong className="text-right">{value(a)}</strong><span className="text-center text-[8px] font-black text-slate-500">{label}</span><strong>{value(b)}</strong></div>)}</div><p className="mt-2 text-[9px] text-slate-500">Los totales completos permanecen debajo como contexto descriptivo; no se usan como benchmark directo entre muestras de distinto tamaño.</p></section>;
}

import { DashboardReferencePreset, DashboardScopeV2 } from "../../lib/dashboardV2";

const REFERENCES: Record<DashboardReferencePreset, string> = { SEASON: "MEDIA TEMPORADA", HOME: "MEDIA LOCAL", AWAY: "MEDIA VISITANTE", WINS: "VICTORIAS", DRAWS: "EMPATES", LOSSES: "DERROTAS", P1: "MEDIA P1", P2: "MEDIA P2", FILTERED: "SELECCIÓN FILTRADA" };

export function scopeLabel(scope: DashboardScopeV2): string {
  const parts = [scope.venues.length === 1 ? scope.venues[0] === "HOME" ? "Local" : "Visitante" : null, scope.period === "ALL" ? null : `P${scope.period}`, scope.competitiveContext === "KEY" ? "Minutos clave" : scope.competitiveContext === "GOLD" ? "Minutos de oro" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Temporada completa";
}

export function comparisonRightLabel(scope: DashboardScopeV2, reference: DashboardReferencePreset): string {
  if (scope.rivals.length === 1) return scope.rivals[0].toUpperCase();
  if (scope.rivals.length > 1) return `${scope.rivals.length} RIVALES`;
  return REFERENCES[reference];
}

export function ComparisonHeader({ left = "CDA", right, scope }: { left?: string; right: string; scope: DashboardScopeV2 }) {
  return <div className="sticky top-28 z-20 rounded-2xl border border-slate-700 bg-slate-950/95 px-4 py-2 shadow-xl backdrop-blur sm:top-24"><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-black"><span className="truncate text-cyan-300">{left}</span><span className="text-[9px] text-slate-600">VS</span><span className="truncate text-right text-amber-200">{right}</span></div><p className="mt-0.5 text-center text-[9px] text-slate-500">{scopeLabel(scope)}</p></div>;
}

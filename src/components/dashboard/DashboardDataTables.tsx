"use client";

import { useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { buildDashboardPhaseDataRows, buildDashboardSetPieceDataRows, DashboardPhaseDataRow, HabitualMetric } from "../../lib/dashboardDataTables";
import { describeDistribution, MIN_MATCHES_FOR_HABITUAL_RANGE } from "../../lib/distributionStatistics";
import { buildDashboardV2, DashboardScopeV2, DashboardValueMode, filterDashboardMatchSelection, teamMetricValue } from "../../lib/dashboardV2";

type Analysis = ReturnType<typeof buildDashboardV2>;
type SortKey = "label" | "count" | "volumePercentage" | "goals" | "goalPercentage" | "impact";
const format = (value: number | null, suffix = "") => value === null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;
const range = (metric: HabitualMetric, suffix = "") => metric.range ? `${format(metric.range[0])}–${format(metric.range[1])}${suffix}` : `Sin muestra (${metric.stats.n}/${MIN_MATCHES_FOR_HABITUAL_RANGE})`;
const equivalent = (value: [number, number] | null, suffix = "") => value ? `${format(value[0])}–${format(value[1])}${suffix}` : "—";

function deviationClass(value: number | null, habitual: HabitualMetric, positiveHigh: boolean) {
  if (value === null || !habitual.range) return "";
  if (value > habitual.range[1]) return positiveHigh ? "text-emerald-300" : "text-rose-300";
  if (value < habitual.range[0]) return positiveHigh ? "text-rose-300" : "text-emerald-300";
  return "text-slate-200";
}

function phaseFilter(scope: DashboardScopeV2, row: DashboardPhaseDataRow): DashboardScopeV2 {
  if (row.key === "TOTAL") return scope;
  const value = row.key;
  return { ...scope, phases: scope.phases.length === 1 && scope.phases[0] === value ? [] : [value] };
}

function PhaseTable({ title, rows, scope, onScope, side }: { title: string; rows: DashboardPhaseDataRow[]; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; side: "FOR" | "AGAINST" }) {
  const [sort, setSort] = useState<SortKey>("count");
  const [descending, setDescending] = useState(true);
  const sorted = useMemo(() => {
    const body = rows.filter((row) => row.key !== "TOTAL"); const total = rows.find((row) => row.key === "TOTAL");
    body.sort((a, b) => { const left = sort === "label" ? a.label : a[sort] ?? -Infinity; const right = sort === "label" ? b.label : b[sort] ?? -Infinity; return (typeof left === "string" ? left.localeCompare(String(right), "es") : Number(left) - Number(right)) * (descending ? -1 : 1); });
    return total ? [...body, total] : body;
  }, [descending, rows, sort]);
  const heading = (key: SortKey, label: string) => <button type="button" onClick={() => { if (sort === key) setDescending((value) => !value); else { setSort(key); setDescending(true); } }} className="min-h-9 text-left text-[9px] font-black tracking-wide text-slate-300">{label}{sort === key ? descending ? " ↓" : " ↑" : ""}</button>;
  return <section className="rounded-3xl border border-slate-700 bg-slate-900 p-3"><h2 className={`mb-3 text-lg font-black ${side === "FOR" ? "text-cyan-200" : "text-rose-200"}`}>{title}</h2><div className="overflow-x-auto"><table data-dashboard-data-table={side} className="min-w-[1120px] w-full border-collapse text-[10px]"><thead className="sticky top-0 bg-slate-900"><tr className="border-b border-slate-700"><th className="sticky left-0 z-10 bg-slate-900 px-2">{heading("label", "FASE")}</th><th>{heading("count", side === "FOR" ? "REMATES" : "AMENAZAS")}</th><th>HAB. /PJ</th><th>{heading("volumePercentage", "% VOLUMEN")}</th><th>HAB. % VOL.</th><th>EQ. HABITUAL</th><th>{heading("goals", side === "FOR" ? "GOLES" : "GC")}</th><th>{heading("goalPercentage", side === "FOR" ? "% GOLES" : "% GC")}</th><th>HAB. % GOL</th><th>EQ. HAB. GOL</th><th>{heading("impact", "IMPACTO")}</th></tr></thead><tbody>{sorted.map((row) => { const active = row.key !== "TOTAL" && scope.phases.length === 1 && scope.phases[0] === row.key; return <tr key={row.key} onClick={() => row.key !== "TOTAL" && onScope(phaseFilter(scope, row))} className={`border-b border-slate-800 ${row.key === "TOTAL" ? "bg-slate-950 font-black" : "cursor-pointer hover:bg-slate-800/80"} ${active ? "ring-1 ring-inset ring-cyan-300" : ""}`}><th className="sticky left-0 bg-inherit px-2 py-3 text-left">{row.label}</th><td className={deviationClass(row.rawCount, row.countHabitual, side === "FOR")}>{format(row.count)}</td><td>{range(row.countHabitual)}</td><td>{format(row.volumePercentage, "%")}</td><td>{row.key === "TOTAL" ? "—" : range(row.volumeHabitual, "%")}</td><td>{equivalent(row.volumeEquivalent)}</td><td className={deviationClass(row.rawGoals, row.goalHabitual, side === "FOR")}>{format(row.goals)}</td><td>{format(row.goalPercentage, "%")}</td><td>{row.key === "TOTAL" ? "—" : range(row.goalHabitual, "%")}</td><td>{equivalent(row.goalEquivalent)}</td><td title={row.impactHabitual.range ? `Impacto habitual ${range(row.impactHabitual, " pp")}` : "Impacto habitual sin muestra suficiente"}>{row.impact !== null && row.impact > 0 ? "+" : ""}{format(row.impact, " pp")}</td></tr>; })}</tbody></table></div><p className="mt-2 text-[9px] text-slate-500">Impacto = % goles − % volumen. Toca una fase para aplicar/quitar el filtro canónico.</p></section>;
}

function SetPieceTable({ title, rows, scope, onScope }: { title: string; rows: ReturnType<typeof buildDashboardSetPieceDataRows>; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void }) {
  const phase = (key: "ALL" | "CORNER" | "KICK_IN") => key === "ALL" ? "SET_PIECE" as const : key === "CORNER" ? "SET_PIECE_CORNER" as const : "SET_PIECE_KICK_IN" as const;
  return <section className="rounded-3xl border border-amber-900/60 bg-amber-950/10 p-3"><h2 className="mb-3 text-lg font-black text-amber-200">{title}</h2><div className="overflow-x-auto"><table className="min-w-[1080px] w-full text-[10px]"><thead><tr className="border-b border-amber-900/50"><th className="px-2 text-left">TIPO</th><th>ABP</th><th>HAB. ABP/PJ</th><th>REMATE</th><th>% REMATE</th><th>HAB. %</th><th>EQ.</th><th>A PUERTA</th><th>% PUERTA</th><th>HAB. %</th><th>EQ.</th><th>GOL</th><th>% GOL</th><th>HAB. %</th><th>EQ.</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} onClick={() => { const value = phase(row.key); onScope({ ...scope, phases: scope.phases.length === 1 && scope.phases[0] === value ? [] : [value] }); }} className="cursor-pointer border-b border-amber-950 hover:bg-amber-950/30"><th className="px-2 py-3 text-left">{row.label}</th><td>{row.current.opportunities}</td><td>{range(row.opportunityHabitual)}</td><td>{row.current.withShot}</td><td>{format(row.shotPct, "%")}</td><td>{range(row.shotHabitual, "%")}</td><td>{equivalent(row.shotEquivalent)}</td><td>{row.current.withOnTarget}</td><td>{format(row.targetPct, "%")}</td><td>{range(row.targetHabitual, "%")}</td><td>{equivalent(row.targetEquivalent)}</td><td>{row.current.withGoal}</td><td>{format(row.goalPct, "%")}</td><td>{range(row.goalHabitual, "%")}</td><td>{equivalent(row.goalEquivalent)}</td></tr>)}</tbody></table></div><p className="mt-2 text-[9px] text-slate-500">TODAS = Córner + Banda cercana. Faltas, penaltis y dobles penaltis no entran en este universo.</p></section>;
}

interface SituationRow { key: string; label: string; current: number; perMatch: number | null; habitual: HabitualMetric; relevant: Array<{ id: string; label: string; value: number }>; }

export function DashboardDataTables({ analysis, referenceScope, allRecords, scope, onScope, mode }: { analysis: Analysis; referenceScope: DashboardScopeV2; allRecords: DashboardMatchRecord[]; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; mode: DashboardValueMode }) {
  const [situation, setSituation] = useState<SituationRow | null>(null);
  const referenceMatches = useMemo(() => filterDashboardMatchSelection(allRecords, referenceScope), [allRecords, referenceScope]);
  const referenceByMatch = useMemo(() => referenceMatches.map((record) => buildDashboardV2([record], { ...referenceScope, matchIds: [record.catalog.matchId] }).records), [referenceMatches, referenceScope]);
  const attack = useMemo(() => buildDashboardPhaseDataRows(analysis.records, referenceByMatch, "FOR", mode, analysis.rates.observedMinutes), [analysis, mode, referenceByMatch]);
  const defense = useMemo(() => buildDashboardPhaseDataRows(analysis.records, referenceByMatch, "AGAINST", mode, analysis.rates.observedMinutes), [analysis, mode, referenceByMatch]);
  const abpFor = useMemo(() => buildDashboardSetPieceDataRows(analysis.records, referenceByMatch, "FOR"), [analysis.records, referenceByMatch]);
  const abpAgainst = useMemo(() => buildDashboardSetPieceDataRows(analysis.records, referenceByMatch, "AGAINST"), [analysis.records, referenceByMatch]);
  const situations = useMemo<SituationRow[]>(() => {
    const single = referenceMatches.map((record) => ({ record, value: buildDashboardV2([record], { ...referenceScope, matchIds: [record.catalog.matchId] }) }));
    const build = (key: string, label: string, current: number, read: (value: Analysis) => number): SituationRow => { const values = single.map(({ value }) => read(value)); const stats = describeDistribution(values); return { key, label, current, perMatch: analysis.samples ? current / analysis.samples : null, habitual: { stats, range: stats.n >= MIN_MATCHES_FOR_HABITUAL_RANGE && stats.p25 !== null && stats.p75 !== null ? [stats.p25, stats.p75] : null }, relevant: single.map(({ record, value }) => ({ id: record.catalog.matchId, label: `${record.catalog.date} · ${record.catalog.opponent}`, value: read(value) })).filter((item) => item.value > 0) }; };
    return [
      build("losses", "PÉRDIDAS", teamMetricValue(analysis, "possessionLosses", "TOTALS") ?? 0, (value) => teamMetricValue(value, "possessionLosses", "TOTALS") ?? 0),
      build("key", "MINUTOS CLAVE", analysis.teamKeyMinutes, (value) => value.teamKeyMinutes),
      build("gold", "MINUTOS DE ORO", analysis.teamGoldMinutes, (value) => value.teamGoldMinutes),
      build("pj", "PORTERO-JUGADOR", analysis.flyingGoalkeeper.for.minutes + analysis.flyingGoalkeeper.against.minutes, (value) => value.flyingGoalkeeper.for.minutes + value.flyingGoalkeeper.against.minutes),
    ];
  }, [analysis, referenceMatches, referenceScope]);
  const tabular = useMemo(() => [["ATAQUE"], ["Fase", "Cantidad", "% volumen", "Goles", "% goles", "Impacto"], ...attack.map((row) => [row.label, format(row.count), format(row.volumePercentage), format(row.goals), format(row.goalPercentage), format(row.impact)]), [], ["DEFENSA"], ...defense.map((row) => [row.label, format(row.count), format(row.volumePercentage), format(row.goals), format(row.goalPercentage), format(row.impact)])], [attack, defense]);
  const copy = async () => navigator.clipboard.writeText(tabular.map((row) => row.join("\t")).join("\n"));
  const csv = () => { const content = tabular.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" })); link.download = `alamedapp-datos-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); };
  return <section className="space-y-5" aria-label="Datos del Dashboard"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[9px] font-black tracking-[.16em] text-cyan-300">MISMO SCOPE · MISMA VERDAD</p><h1 className="text-2xl font-black">DATOS</h1></div><div className="flex gap-2"><button type="button" onClick={() => void copy()} className="min-h-10 rounded-xl border border-slate-700 px-3 text-[9px] font-black">COPIAR TABLA</button><button type="button" onClick={csv} className="min-h-10 rounded-xl bg-emerald-800 px-3 text-[9px] font-black">EXPORTAR CSV</button></div></div>
    <PhaseTable title="ATAQUE" rows={attack} scope={scope} onScope={onScope} side="FOR"/><PhaseTable title="DEFENSA" rows={defense} scope={scope} onScope={onScope} side="AGAINST"/>
    <div className="grid gap-4 xl:grid-cols-2"><SetPieceTable title="ABP — A FAVOR" rows={abpFor} scope={scope} onScope={onScope}/><SetPieceTable title="ABP — EN CONTRA" rows={abpAgainst} scope={scope} onScope={onScope}/></div>
    <section className="rounded-3xl border border-indigo-800/70 bg-indigo-950/20 p-3"><h2 className="mb-3 text-lg font-black">SITUACIONES</h2><div className="overflow-x-auto"><table className="min-w-[680px] w-full text-[10px]"><thead><tr className="border-b border-indigo-900"><th className="text-left">SITUACIÓN</th><th>ACTUAL</th><th>/PJ</th><th>HABITUAL</th><th>PARTIDOS CON SITUACIÓN</th></tr></thead><tbody>{situations.map((row) => <tr key={row.key} onClick={() => setSituation(row)} className="cursor-pointer border-b border-indigo-950 hover:bg-indigo-950/40"><th className="py-3 text-left">{row.label}</th><td>{format(row.current)}</td><td>{format(row.perMatch)}</td><td>{range(row.habitual)}</td><td>{row.relevant.length}</td></tr>)}</tbody></table></div></section>
    {situation && <div role="dialog" aria-modal="true" aria-label={`Detalle ${situation.label}`} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-3" onClick={() => setSituation(null)}><section className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-indigo-600 bg-slate-900 p-4" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-xl font-black">{situation.label} · PARTIDO A PARTIDO</h2><button type="button" onClick={() => setSituation(null)} className="min-h-10 rounded-xl border border-slate-700 px-3 text-xs font-black">CERRAR</button></div><div className="mt-3 space-y-2">{situation.relevant.length ? situation.relevant.map((item) => <details key={item.id} className="rounded-xl bg-slate-950 p-3"><summary className="cursor-pointer font-black">{item.label} · {format(item.value)}</summary><p className="mt-2 text-xs text-slate-400">El detalle conserva el partido y el contexto filtrado. Los intervalos y eventos exactos permanecen trazables en RESUMEN y VÍDEOS.</p></details>) : <p className="text-slate-500">Sin partidos relevantes en este scope.</p>}</div></section></div>}
  </section>;
}

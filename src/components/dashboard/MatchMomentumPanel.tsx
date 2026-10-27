"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildMatchMomentum,
  buildMomentumTrendSeries,
  EMPTY_MOMENTUM_FILTERS,
  MatchMomentum,
  MOMENTUM_OUTCOME_COLORS,
  MomentumAction,
  MomentumBin,
  MomentumDanger,
  MomentumDangerFilter,
  MomentumFilters,
  MomentumPeriodFilter,
  MomentumTrendSeries,
  MomentumViewMode,
  momentumActionOpacity,
  momentumBinTotal,
  momentumExportHeading,
} from "../../lib/matchMomentum";
import { ThreatPhase } from "../../types";
import { CompactMultiSelect } from "../video/CompactMultiSelect";

const PHASES: Array<[ThreatPhase, string]> = [
  ["POSITIONAL", "Posicional"], ["TRANSITION", "Transición"],
  ["SET_PIECE_CORNER", "Córner"], ["SET_PIECE_FREE_KICK", "Falta"],
  ["SET_PIECE_KICK_IN", "Banda"], ["FLYING_GOALKEEPER", "P-J"],
  ["PENALTY", "Penalti"], ["DOUBLE_PENALTY", "Doble penalti"],
  ["UNSPECIFIED", "Sin fase"],
];
const PHASE_LABEL = Object.fromEntries(PHASES) as Record<ThreatPhase, string>;
const DANGERS: MomentumDanger[] = ["NORMAL", "NEAR", "HIGH", "GOAL"];
const OUTCOME_LABEL = { FUERA: "Fuera", PARADA: "Parada", GOL: "Gol", BLOQUEADO: "Bloqueado" } as const;

interface MatchOption {
  matchId: string;
  opponent: string;
  date: string;
}

export function MatchMomentumPanel({ records, referenceRecords, comparisonEnabled, matches, selectedMatchIds }: { records: DashboardMatchRecord[]; referenceRecords: DashboardMatchRecord[]; comparisonEnabled: boolean; matches: MatchOption[]; selectedMatchIds: string[] }) {
  const availableIds = useMemo(() => new Set(matches.map((match) => match.matchId)), [matches]);
  const defaultId = selectedMatchIds.length === 1 && availableIds.has(selectedMatchIds[0]) ? selectedMatchIds[0] : matches[0]?.matchId ?? "";
  const [matchId, setMatchId] = useState(defaultId);
  const [filters, setFilters] = useState<MomentumFilters>(EMPTY_MOMENTUM_FILTERS);
  const [viewMode, setViewMode] = useState<MomentumViewMode>("MATCH");
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (selectedMatchIds.length === 1 && availableIds.has(selectedMatchIds[0])) setMatchId(selectedMatchIds[0]);
    else if (!availableIds.has(matchId)) setMatchId(matches[0]?.matchId ?? "");
  }, [availableIds, matchId, matches, selectedMatchIds]);
  useEffect(() => { setSelectedBin(null); setFilters(EMPTY_MOMENTUM_FILTERS); }, [matchId]);
  useEffect(() => { if (!comparisonEnabled && viewMode === "COMPARISON") setViewMode("MATCH"); }, [comparisonEnabled, viewMode]);
  const record = records.find((candidate) => candidate.catalog.matchId === matchId);
  const primaryPeriod = filters.period === 2 ? 2 : 1;
  const effectiveFilters = useMemo(() => viewMode === "PERIOD_COMPARE" ? { ...filters, period: primaryPeriod as 1 | 2 } : filters, [filters, primaryPeriod, viewMode]);
  const momentum = useMemo(() => record ? buildMatchMomentum(record, effectiveFilters) : null, [effectiveFilters, record]);
  const trend = useMemo(() => {
    if (!record) return null;
    if (viewMode === "PERIOD_COMPARE") return buildMomentumTrendSeries([record], filters, primaryPeriod === 1 ? 2 : 1);
    if (viewMode === "COMPARISON" && comparisonEnabled) return buildMomentumTrendSeries(referenceRecords, filters, filters.period === "ALL" ? "MATCH" : filters.period);
    return null;
  }, [comparisonEnabled, filters, primaryPeriod, record, referenceRecords, viewMode]);
  const detail = momentum?.bins.find((bin) => bin.key === selectedBin) ?? null;
  if (!record || !momentum) return <section className="rounded-3xl border border-dashed border-slate-700 p-6 text-center text-slate-500"><b>MOMENTUM</b><p className="mt-1 text-xs">Selecciona un partido disponible para analizar su cronología sin mezclar partidos.</p></section>;
  const players = record.session.players.filter((player) => record.session.events.some((event) => event.type === "lineup_initialized" && event.squadPlayerIds.includes(player.id)));
  const exportImage = async () => {
    setExporting(true);
    try { await shareMomentumImage(momentum, effectiveFilters); } finally { setExporting(false); }
  };
  return <section data-match-momentum className="rounded-3xl border border-emerald-900/70 bg-slate-900 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-black tracking-[.18em] text-emerald-300">CRONOLOGÍA REAL · SIN SCORE ARTIFICIAL</p><h2 className="text-xl font-black sm:text-2xl">MOMENTUM</h2><p className="mt-1 text-xs text-slate-400">Cada bloque = una acción · color = resultado</p></div><button type="button" disabled={exporting} onClick={exportImage} className="min-h-11 rounded-xl border border-emerald-700 px-3 text-[10px] font-black text-emerald-200 disabled:opacity-50">{exporting ? "GENERANDO…" : "COMPARTIR / EXPORTAR IMAGEN"}</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-[9px] font-black text-slate-400">PARTIDO<select aria-label="Partido de Momentum" value={matchId} onChange={(event) => setMatchId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-800 px-3 text-xs text-white">{matches.map((match) => <option key={match.matchId} value={match.matchId}>{match.date} · {match.opponent}</option>)}</select></label>
      <CompactButtons label="VISTA" values={[["MATCH", "PARTIDO"], ["PERIOD_COMPARE", "P1 vs P2"], ["COMPARISON", "COMPARATIVA"]] as const} selected={viewMode} onSelect={(value) => { if (value !== "COMPARISON" || comparisonEnabled) setViewMode(value); }} disabledValue={comparisonEnabled ? undefined : "COMPARISON"}/>
      <CompactButtons label="PERIODO" values={[["ALL", "TODO"], [1, "P1"], [2, "P2"]] as const} selected={filters.period} onSelect={(period) => setFilters((current) => ({ ...current, period: period as MomentumPeriodFilter }))}/>
      <CompactButtons label="PELIGROSIDAD" values={[["ALL", "TODAS"], ["NEAR", "CERCANAS"], ["HIGH", "CERC A PUERTA"], ["GOAL", "GOL"]] as const} selected={filters.danger} onSelect={(danger) => setFilters((current) => ({ ...current, danger: danger as MomentumDangerFilter }))}/>
      <CompactMultiSelect label="JUGADORES" allLabel="TODOS LOS JUGADORES" values={filters.playerIds} options={players.map((player) => ({ value: player.id, label: `#${player.number} · ${player.name}` }))} onChange={(playerIds) => setFilters((current) => ({ ...current, playerIds }))}/>
    </div>
    <div className="mt-3 flex flex-wrap gap-1">{PHASES.map(([phase, label]) => <button type="button" key={phase} onClick={() => setFilters((current) => ({ ...current, phases: current.phases.includes(phase) ? current.phases.filter((item) => item !== phase) : [...current.phases, phase] }))} className={`min-h-9 rounded-lg border px-2 text-[9px] font-black ${filters.phases.includes(phase) ? "border-emerald-300 bg-emerald-300 text-slate-950" : "border-slate-700 text-slate-400"}`}>{label.toUpperCase()}</button>)}</div>
    {viewMode === "PERIOD_COMPARE" && <p className="mt-2 text-center text-[9px] text-slate-400">P{primaryPeriod} en bloques · P{primaryPeriod === 1 ? 2 : 1} como tendencia suavizada de 3 minutos.</p>}
    {viewMode === "COMPARISON" && <p className="mt-2 text-center text-[9px] text-slate-400">Contexto principal en bloques · comparativa global activa como tendencia media por partido.</p>}
    <MomentumChart momentum={momentum} trend={trend} viewMode={viewMode} primaryPeriod={primaryPeriod} selected={selectedBin} onSelect={setSelectedBin}/>
    <MomentumPresence momentum={momentum} viewMode={viewMode} primaryPeriod={primaryPeriod}/>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[9px] text-slate-400"><b className="text-white">RESULTADO</b>{(Object.keys(OUTCOME_LABEL) as Array<keyof typeof OUTCOME_LABEL>).map((outcome) => <span key={outcome} className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: MOMENTUM_OUTCOME_COLORS[outcome] }}/>{OUTCOME_LABEL[outcome]}{outcome === "GOL" ? " · G" : ""}</span>)}<span className="basis-full">CDA se representa arriba y rival abajo. La peligrosidad se mantiene mediante los filtros TOTAL, CERCANAS, A PUERTA y GOL.</span></div>
    {detail && <MomentumDetail bin={detail}/>}
  </section>;
}

function CompactButtons<T extends string | number>({ label, values, selected, onSelect, disabledValue }: { label: string; values: readonly (readonly [T, string])[]; selected: T; onSelect: (value: T) => void; disabledValue?: T }) {
  return <fieldset><legend className="mb-1 text-[9px] font-black text-slate-400">{label}</legend><div className="flex min-h-11 flex-wrap items-center gap-1 rounded-xl bg-slate-800 p-1">{values.map(([value, text]) => <button type="button" key={String(value)} disabled={disabledValue === value} title={disabledValue === value ? "Activa COMPARAR en el Dashboard" : undefined} onClick={() => onSelect(value)} className={`min-h-8 flex-1 rounded-lg px-2 text-[9px] font-black disabled:cursor-not-allowed disabled:opacity-35 ${selected === value ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}>{text}</button>)}</div></fieldset>;
}

function MomentumChart({ momentum, trend, viewMode, primaryPeriod, selected, onSelect }: { momentum: MatchMomentum; trend: MomentumTrendSeries | null; viewMode: MomentumViewMode; primaryPeriod: 1 | 2; selected: string | null; onSelect: (key: string) => void }) {
  const width = 1000; const height = 340; const left = 54; const right = 16; const axis = 170; const plotWidth = width - left - right;
  const displayDuration = viewMode === "PERIOD_COMPARE" ? periodDurationsForMomentum(momentum, primaryPeriod) : momentum.displayDuration;
  const trendMaximum = trend ? Math.max(0, ...trend.points.flatMap((point) => [point.FOR, point.AGAINST])) : 0;
  const scaleMax = Math.max(momentum.scaleMax, Math.ceil(trendMaximum), 1);
  const unit = 125 / scaleMax;
  const position = (minute: number) => left + (minute / Math.max(1, displayDuration)) * plotWidth;
  const binMinute = (bin: MomentumBin) => viewMode === "PERIOD_COMPARE" ? bin.minute : bin.globalMinute - momentum.displayStart;
  const barWidth = Math.max(4, Math.min(18, plotWidth / Math.max(1, displayDuration + 1) - 2));
  const tickStep = scaleMax <= 8 ? 1 : Math.ceil(scaleMax / 6);
  const ticks = Array.from({ length: Math.floor(scaleMax / tickStep) + 1 }, (_, index) => index * tickStep).filter((value) => value <= scaleMax);
  if (ticks.at(-1) !== scaleMax) ticks.push(scaleMax);
  const minuteTicks = Array.from({ length: Math.floor(displayDuration / 5) + 1 }, (_, index) => index * 5);
  if (minuteTicks.at(-1) !== displayDuration) minuteTicks.push(displayDuration);
  const showPeriodBoundary = viewMode !== "PERIOD_COMPARE" && momentum.displayStart === 0 && momentum.displayDuration === momentum.duration;
  return <div className="mt-4 overflow-x-auto"><svg data-momentum-chart data-momentum-view={viewMode} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Momentum temporal: remates CDA arriba y amenazas rival abajo" className="h-auto w-full min-w-[700px] rounded-2xl bg-slate-950">
    {ticks.map((tick) => <g key={tick}>{tick > 0 && <><line x1={left} x2={width - right} y1={axis - tick * unit} y2={axis - tick * unit} stroke="#334155" strokeWidth="1" opacity=".45"/><line x1={left} x2={width - right} y1={axis + tick * unit} y2={axis + tick * unit} stroke="#334155" strokeWidth="1" opacity=".45"/></>}<text x={left - 12} y={axis - tick * unit + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{tick}</text>{tick > 0 && <text x={left - 12} y={axis + tick * unit + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{tick}</text>}</g>)}
    <line x1={left} x2={width - right} y1={axis} y2={axis} stroke="#64748b" strokeWidth="2"/>
    {showPeriodBoundary && momentum.periodEnds.slice(0, -1).map((end) => <g key={end}><line x1={position(end)} x2={position(end)} y1="20" y2={height - 30} stroke="#94a3b8" strokeDasharray="6 6"/><text x={position(end)} y="16" textAnchor="middle" fill="#cbd5e1" fontSize="12" fontWeight="700">P1 / P2</text></g>)}
    {minuteTicks.map((minute) => <g key={minute}><line x1={position(minute)} x2={position(minute)} y1={axis - 4} y2={axis + 4} stroke="#94a3b8"/><text x={position(minute)} y={height - 10} textAnchor="middle" fill="#64748b" fontSize="11">{minute}&apos;</text></g>)}
    <text x="8" y="26" fill="#86efac" fontSize="12" fontWeight="800">REMATES CDA ↑</text><text x="8" y={height - 36} fill="#fda4af" fontSize="12" fontWeight="800">AMENAZAS RIVAL ↓</text>
    {trend && <MomentumTrendLine trend={trend} position={position} axis={axis} unit={unit}/>}
    {momentum.bins.map((bin) => <MomentumBar key={bin.key} bin={bin} x={position(binMinute(bin))} axis={axis} width={barWidth} unit={unit} selected={selected === bin.key} onSelect={() => onSelect(bin.key)}/>) }
  </svg>{momentum.actions.length === 0 && <p className="py-4 text-center text-xs text-slate-500">No hay acciones para estos filtros.</p>}</div>;
}

function periodDurationsForMomentum(momentum: MatchMomentum, period: 1 | 2): number {
  const start = period === 1 ? 0 : momentum.periodEnds[0] ?? 0;
  return Math.max(0, (momentum.periodEnds[period - 1] ?? momentum.duration) - start);
}

function MomentumTrendLine({ trend, position, axis, unit }: { trend: MomentumTrendSeries; position: (minute: number) => number; axis: number; unit: number }) {
  const points = (side: "FOR" | "AGAINST") => trend.points.map((point) => `${position(point.minute)},${axis + (side === "FOR" ? -1 : 1) * point[side] * unit}`).join(" ");
  return <g data-momentum-trend data-window={trend.window} data-smoothing={trend.smoothing} pointerEvents="none">
    <polyline points={points("FOR")} fill="none" stroke="#e2e8f0" strokeWidth="3" strokeDasharray="7 5" opacity=".8"/>
    <polyline points={points("AGAINST")} fill="none" stroke="#94a3b8" strokeWidth="3" strokeDasharray="7 5" opacity=".8"/>
  </g>;
}

function MomentumBar({ bin, x, axis, width, unit, selected, onSelect }: { bin: MomentumBin; x: number; axis: number; width: number; unit: number; selected: boolean; onSelect: () => void }) {
  let top = axis; let bottom = axis;
  const actionBlock = (action: MomentumAction, index: number) => {
    const y = action.side === "FOR" ? top - unit : bottom;
    if (action.side === "FOR") top -= unit; else bottom += unit;
    return <g key={action.eventId} data-momentum-action={action.eventId} data-outcome={action.outcome} data-side={action.side} opacity={momentumActionOpacity(action)}>
      <rect x={x - width / 2} y={y} width={width} height={unit} fill={MOMENTUM_OUTCOME_COLORS[action.outcome]} stroke="#020617" strokeWidth=".75"/>
      {action.outcome === "GOL" && <text x={x} y={y + unit / 2 + Math.min(3, unit / 4)} textAnchor="middle" fill="white" fontSize={Math.max(6, Math.min(9, unit * .65))} fontWeight="900">G</text>}
      <title>{`${index + 1}. ${OUTCOME_LABEL[action.outcome]} · ${action.highlighted ? "jugadores coinciden" : "fuera de presencia seleccionada"}`}</title>
    </g>;
  };
  const pieces = (["FOR", "AGAINST"] as const).flatMap((side) => bin.actions.filter((action) => action.side === side).map(actionBlock));
  return <g role="button" tabIndex={0} aria-label={`P${bin.period} minuto ${bin.minute}: ${momentumBinTotal(bin, "FOR")} remates CDA, ${momentumBinTotal(bin, "AGAINST")} amenazas rival`} onMouseEnter={onSelect} onFocus={onSelect} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} className="cursor-pointer"><rect x={x - Math.max(10, width) / 2} y="20" width={Math.max(10, width)} height="290" fill="transparent"/>{pieces}{selected && <rect x={x - width / 2 - 3} y={top - 3} width={width + 6} height={bottom - top + 6} fill="none" stroke="#f8fafc" strokeWidth="2" rx="2"/>}</g>;
}

function MomentumPresence({ momentum, viewMode, primaryPeriod }: { momentum: MatchMomentum; viewMode: MomentumViewMode; primaryPeriod: 1 | 2 }) {
  if (momentum.selectedPlayerNames.length === 0) return null;
  const duration = viewMode === "PERIOD_COMPARE" ? periodDurationsForMomentum(momentum, primaryPeriod) : momentum.displayDuration;
  const offset = momentum.displayStart;
  const intervals = momentum.sharedIntervals.flatMap((interval) => {
    const start = Math.max(0, interval.start - offset);
    const end = Math.min(duration, interval.end - offset);
    return end > start ? [{ start, end }] : [];
  });
  const label = momentum.selectedPlayerNames.length === 1 ? momentum.selectedPlayerNames[0].toUpperCase() : `JUNTOS · ${momentum.selectedPlayerNames.length}`;
  return <div data-momentum-presence className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2" title={momentum.selectedPlayerNames.join(" · ")}><b className="text-[9px] text-emerald-200">{label}</b><div className="relative h-3 overflow-hidden rounded-full bg-slate-800">{intervals.map((interval, index) => <i key={`${interval.start}-${interval.end}-${index}`} className="absolute inset-y-0 rounded-full bg-emerald-400" style={{ left: `${interval.start / Math.max(1, duration) * 100}%`, width: `${(interval.end - interval.start) / Math.max(1, duration) * 100}%` }}/>)}</div></div>;
}

function MomentumDetail({ bin }: { bin: MomentumBin }) {
  return <div data-momentum-detail className="mt-3 rounded-2xl border border-emerald-700/70 bg-slate-950 p-3 text-xs"><b className="text-sm">MIN {bin.minute} · P{bin.period}</b><div className="mt-2 grid gap-2 sm:grid-cols-2"><MomentumSideDetail label="CDA" noun="remates" counts={bin.FOR}/><MomentumSideDetail label="RIVAL" noun="amenazas" counts={bin.AGAINST}/></div><p className="mt-2 text-slate-400">Fase: {bin.phases.map((phase) => PHASE_LABEL[phase]).join(" · ") || "N/D"}</p></div>;
}

function MomentumSideDetail({ label, noun, counts }: { label: string; noun: string; counts: Record<MomentumDanger, number> }) {
  const total = DANGERS.reduce((sum, danger) => sum + counts[danger], 0);
  return <div className="rounded-xl bg-slate-900 p-3"><b className={label === "CDA" ? "text-emerald-300" : "text-rose-300"}>{label}</b><strong className="mt-1 block text-lg">{total} {noun}</strong><span className="text-slate-400">{counts.NEAR} cercanas · {counts.HIGH} cerc a puerta · {counts.GOAL} goles</span></div>;
}

function formatDuration(minutes: number): string {
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1).replace(".", ",")} min`;
}

async function shareMomentumImage(momentum: MatchMomentum, filters: MomentumFilters): Promise<void> {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 720;
  const context = canvas.getContext("2d"); if (!context) throw new Error("No se pudo generar la imagen.");
  context.fillStyle = "#020617"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f8fafc"; context.font = "800 34px system-ui"; context.fillText("APP ALAM · MOMENTUM", 54, 58);
  context.fillStyle = "#a7f3d0"; context.font = "700 22px system-ui"; context.fillText(momentumExportHeading(momentum, filters), 54, 96);
  const shared = momentum.selectedPlayerNames.length > 0 ? ` · juntos ${formatDuration(momentum.sharedMinutes)}` : "";
  context.fillStyle = "#94a3b8"; context.font = "16px system-ui"; context.fillText(`${momentum.date} · CDA ${momentum.score.for}-${momentum.score.against} ${momentum.opponent}${shared} · ${momentum.actions.length} acciones`, 54, 126);
  const left = 78; const right = 1140; const axis = 370; const plot = right - left; const unit = 165 / momentum.scaleMax; const x = (minute: number) => left + (minute - momentum.displayStart) / Math.max(1, momentum.displayDuration) * plot;
  const tickStep = momentum.scaleMax <= 8 ? 1 : Math.ceil(momentum.scaleMax / 6);
  const ticks = Array.from({ length: Math.floor(momentum.scaleMax / tickStep) + 1 }, (_, index) => index * tickStep).filter((value) => value <= momentum.scaleMax);
  if (ticks.at(-1) !== momentum.scaleMax) ticks.push(momentum.scaleMax);
  context.font = "13px system-ui"; context.textAlign = "right";
  for (const tick of ticks) { context.fillStyle = "#94a3b8"; context.fillText(String(tick), left - 12, axis - tick * unit + 4); if (tick > 0) context.fillText(String(tick), left - 12, axis + tick * unit + 4); if (tick > 0) { context.strokeStyle = "#334155"; context.globalAlpha = .45; context.lineWidth = 1; context.beginPath(); context.moveTo(left, axis - tick * unit); context.lineTo(right, axis - tick * unit); context.moveTo(left, axis + tick * unit); context.lineTo(right, axis + tick * unit); context.stroke(); context.globalAlpha = 1; } }
  context.textAlign = "left";
  context.strokeStyle = "#64748b"; context.lineWidth = 2; context.beginPath(); context.moveTo(left, axis); context.lineTo(right, axis); context.stroke();
  for (const end of momentum.periodEnds.slice(0, -1).filter((value) => value > momentum.displayStart && value < momentum.displayStart + momentum.displayDuration)) { context.setLineDash([6, 6]); context.beginPath(); context.moveTo(x(end), 170); context.lineTo(x(end), 570); context.stroke(); context.setLineDash([]); }
  const barWidth = Math.max(5, Math.min(18, plot / Math.max(1, momentum.displayDuration + 1) - 2));
  for (const bin of momentum.bins) { let top = axis; let bottom = axis; for (const side of ["FOR", "AGAINST"] as const) for (const action of bin.actions.filter((item) => item.side === side)) { const y = side === "FOR" ? top - unit : bottom; if (side === "FOR") top -= unit; else bottom += unit; context.globalAlpha = momentumActionOpacity(action); context.fillStyle = MOMENTUM_OUTCOME_COLORS[action.outcome]; context.fillRect(x(bin.globalMinute) - barWidth / 2, y, barWidth, unit); if (action.outcome === "GOL") { context.globalAlpha = 1; context.fillStyle = "#fff"; context.font = "900 9px system-ui"; context.textAlign = "center"; context.fillText("G", x(bin.globalMinute), y + unit / 2 + 3); context.textAlign = "left"; } } }
  context.globalAlpha = 1; context.fillStyle = "#86efac"; context.font = "700 16px system-ui"; context.fillText("REMATES CDA ↑", 54, 166); context.fillStyle = "#fda4af"; context.fillText("AMENAZAS RIVAL ↓", 54, 568);
  context.font = "12px system-ui"; context.fillStyle = "#94a3b8"; for (let minute = 0; minute <= momentum.displayDuration; minute += 5) { context.textAlign = "center"; context.fillText(`${minute}'`, x(momentum.displayStart + minute), 588); } context.textAlign = "left";
  let legendX = 54; context.font = "12px system-ui"; for (const outcome of Object.keys(OUTCOME_LABEL) as Array<keyof typeof OUTCOME_LABEL>) { context.fillStyle = MOMENTUM_OUTCOME_COLORS[outcome]; context.fillRect(legendX, 610, 12, 12); context.fillStyle = "#cbd5e1"; context.fillText(`${OUTCOME_LABEL[outcome]}${outcome === "GOL" ? " · G" : ""}`, legendX + 18, 621); legendX += 150; }
  context.fillStyle = "#94a3b8"; context.font = "13px system-ui"; context.fillText("Cada bloque representa una acción real. CDA arriba y rival abajo.", 54, 660); context.fillText("El color representa el resultado; la peligrosidad se controla mediante los filtros.", 54, 686);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar la imagen.")), "image/png"));
  const file = new File([blob], `momentum-${momentum.matchId}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Momentum · ${momentum.opponent}` }); return; }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

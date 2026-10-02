"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildMatchMomentum,
  EMPTY_MOMENTUM_FILTERS,
  MatchMomentum,
  MOMENTUM_COLORS,
  MomentumBin,
  MomentumDanger,
  MomentumDangerFilter,
  MomentumFilters,
  MomentumPeriodFilter,
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
const DANGER_LABEL: Record<MomentumDanger, string> = { NORMAL: "Normal", NEAR: "Cercana", HIGH: "Cerc a puerta", GOAL: "Gol" };

interface MatchOption {
  matchId: string;
  opponent: string;
  date: string;
}

export function MatchMomentumPanel({ records, matches, selectedMatchIds }: { records: DashboardMatchRecord[]; matches: MatchOption[]; selectedMatchIds: string[] }) {
  const availableIds = useMemo(() => new Set(matches.map((match) => match.matchId)), [matches]);
  const defaultId = selectedMatchIds.length === 1 && availableIds.has(selectedMatchIds[0]) ? selectedMatchIds[0] : matches[0]?.matchId ?? "";
  const [matchId, setMatchId] = useState(defaultId);
  const [filters, setFilters] = useState<MomentumFilters>(EMPTY_MOMENTUM_FILTERS);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (selectedMatchIds.length === 1 && availableIds.has(selectedMatchIds[0])) setMatchId(selectedMatchIds[0]);
    else if (!availableIds.has(matchId)) setMatchId(matches[0]?.matchId ?? "");
  }, [availableIds, matchId, matches, selectedMatchIds]);
  useEffect(() => { setSelectedBin(null); setFilters(EMPTY_MOMENTUM_FILTERS); }, [matchId]);
  const record = records.find((candidate) => candidate.catalog.matchId === matchId);
  const momentum = useMemo(() => record ? buildMatchMomentum(record, filters) : null, [filters, record]);
  const detail = momentum?.bins.find((bin) => bin.key === selectedBin) ?? null;
  if (!record || !momentum) return <section className="rounded-3xl border border-dashed border-slate-700 p-6 text-center text-slate-500"><b>MOMENTUM</b><p className="mt-1 text-xs">Selecciona un partido disponible para analizar su cronología sin mezclar partidos.</p></section>;
  const players = record.session.players.filter((player) => record.session.events.some((event) => event.type === "lineup_initialized" && event.squadPlayerIds.includes(player.id)));
  const exportImage = async () => {
    setExporting(true);
    try { await shareMomentumImage(momentum, filters); } finally { setExporting(false); }
  };
  return <section data-match-momentum className="rounded-3xl border border-emerald-900/70 bg-slate-900 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-black tracking-[.18em] text-emerald-300">CRONOLOGÍA REAL · SIN SCORE ARTIFICIAL</p><h2 className="text-xl font-black sm:text-2xl">MOMENTUM</h2><p className="mt-1 text-xs text-slate-400">Altura = acciones · intensidad = peligrosidad</p></div><button type="button" disabled={exporting} onClick={exportImage} className="min-h-11 rounded-xl border border-emerald-700 px-3 text-[10px] font-black text-emerald-200 disabled:opacity-50">{exporting ? "GENERANDO…" : "COMPARTIR / EXPORTAR IMAGEN"}</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-[9px] font-black text-slate-400">PARTIDO<select aria-label="Partido de Momentum" value={matchId} onChange={(event) => setMatchId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-800 px-3 text-xs text-white">{matches.map((match) => <option key={match.matchId} value={match.matchId}>{match.date} · {match.opponent}</option>)}</select></label>
      <CompactButtons label="PERIODO" values={[["ALL", "TODO"], [1, "P1"], [2, "P2"]] as const} selected={filters.period} onSelect={(period) => setFilters((current) => ({ ...current, period: period as MomentumPeriodFilter }))}/>
      <CompactButtons label="PELIGROSIDAD" values={[["ALL", "TODAS"], ["NEAR", "CERCANAS"], ["HIGH", "CERC A PUERTA"], ["GOAL", "GOL"]] as const} selected={filters.danger} onSelect={(danger) => setFilters((current) => ({ ...current, danger: danger as MomentumDangerFilter }))}/>
      <CompactMultiSelect label="JUGADORES" allLabel="TODOS LOS JUGADORES" values={filters.playerIds} options={players.map((player) => ({ value: player.id, label: `#${player.number} · ${player.name}` }))} onChange={(playerIds) => setFilters((current) => ({ ...current, playerIds }))}/>
    </div>
    <div className="mt-3 flex flex-wrap gap-1">{PHASES.map(([phase, label]) => <button type="button" key={phase} onClick={() => setFilters((current) => ({ ...current, phases: current.phases.includes(phase) ? current.phases.filter((item) => item !== phase) : [...current.phases, phase] }))} className={`min-h-9 rounded-lg border px-2 text-[9px] font-black ${filters.phases.includes(phase) ? "border-emerald-300 bg-emerald-300 text-slate-950" : "border-slate-700 text-slate-400"}`}>{label.toUpperCase()}</button>)}</div>
    {filters.playerIds.length > 0 && <p className="mt-3 rounded-xl bg-slate-950/70 px-3 py-2 text-xs text-emerald-200"><b>{momentum.selectedPlayerNames.join(" + ")}</b> · juntos {formatDuration(momentum.sharedMinutes)}. El resto del partido permanece visible y atenuado.</p>}
    <MomentumChart momentum={momentum} selected={selectedBin} onSelect={setSelectedBin}/>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[9px] text-slate-400"><b className="text-white">PELIGROSIDAD</b>{(["FOR", "AGAINST"] as const).flatMap((side) => DANGERS.map((danger) => <span key={`${side}-${danger}`} className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: MOMENTUM_COLORS[side][danger] }}/>{side === "FOR" ? "CDA" : "Rival"} · {DANGER_LABEL[danger]}</span>))}<span className="basis-full">Cercana: acción originada en zona próxima a portería. · Cerc a puerta: acción cercana que además va a portería. · Gol: finalización en gol. · Más intensidad de color = mayor peligrosidad.</span></div>
    {detail && <MomentumDetail bin={detail}/>} 
  </section>;
}

function CompactButtons<T extends string | number>({ label, values, selected, onSelect }: { label: string; values: readonly (readonly [T, string])[]; selected: T; onSelect: (value: T) => void }) {
  return <fieldset><legend className="mb-1 text-[9px] font-black text-slate-400">{label}</legend><div className="flex min-h-11 flex-wrap items-center gap-1 rounded-xl bg-slate-800 p-1">{values.map(([value, text]) => <button type="button" key={String(value)} onClick={() => onSelect(value)} className={`min-h-8 flex-1 rounded-lg px-2 text-[9px] font-black ${selected === value ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}>{text}</button>)}</div></fieldset>;
}

function MomentumChart({ momentum, selected, onSelect }: { momentum: MatchMomentum; selected: string | null; onSelect: (key: string) => void }) {
  const width = 1000; const height = 340; const left = 54; const right = 16; const axis = 170; const plotWidth = width - left - right; const unit = 125 / momentum.scaleMax;
  const position = (minute: number) => left + ((minute - momentum.displayStart) / Math.max(1, momentum.displayDuration)) * plotWidth;
  const barWidth = Math.max(4, Math.min(18, plotWidth / Math.max(1, momentum.displayDuration + 1) - 2));
  const tickStep = momentum.scaleMax <= 8 ? 1 : Math.ceil(momentum.scaleMax / 6);
  const ticks = Array.from({ length: Math.floor(momentum.scaleMax / tickStep) + 1 }, (_, index) => index * tickStep).filter((value) => value <= momentum.scaleMax);
  if (ticks.at(-1) !== momentum.scaleMax) ticks.push(momentum.scaleMax);
  const minuteTicks = Array.from({ length: Math.floor(momentum.displayDuration / 5) + 1 }, (_, index) => index * 5);
  if (minuteTicks.at(-1) !== momentum.displayDuration) minuteTicks.push(momentum.displayDuration);
  return <div className="mt-4 overflow-x-auto"><svg data-momentum-chart viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Momentum temporal: remates CDA arriba y amenazas rival abajo" className="h-auto w-full min-w-[700px] rounded-2xl bg-slate-950">
    {ticks.map((tick) => <g key={tick}>{tick > 0 && <><line x1={left} x2={width - right} y1={axis - tick * unit} y2={axis - tick * unit} stroke="#334155" strokeWidth="1" opacity=".45"/><line x1={left} x2={width - right} y1={axis + tick * unit} y2={axis + tick * unit} stroke="#334155" strokeWidth="1" opacity=".45"/></>}<text x={left - 12} y={axis - tick * unit + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{tick}</text>{tick > 0 && <text x={left - 12} y={axis + tick * unit + 4} textAnchor="end" fill="#94a3b8" fontSize="11">{tick}</text>}</g>)}
    <line x1={left} x2={width - right} y1={axis} y2={axis} stroke="#64748b" strokeWidth="2"/>
    {momentum.periodEnds.slice(0, -1).filter((end) => end > momentum.displayStart && end < momentum.displayStart + momentum.displayDuration).map((end) => <g key={end}><line x1={position(end)} x2={position(end)} y1="20" y2={height - 30} stroke="#94a3b8" strokeDasharray="6 6"/><text x={position(end)} y="16" textAnchor="middle" fill="#cbd5e1" fontSize="12" fontWeight="700">P1 / P2</text></g>)}
    {minuteTicks.map((minute) => <g key={minute}><line x1={position(momentum.displayStart + minute)} x2={position(momentum.displayStart + minute)} y1={axis - 4} y2={axis + 4} stroke="#94a3b8"/><text x={position(momentum.displayStart + minute)} y={height - 10} textAnchor="middle" fill="#64748b" fontSize="11">{minute}&apos;</text></g>)}
    <text x="8" y="26" fill="#86efac" fontSize="12" fontWeight="800">REMATES CDA ↑</text><text x="8" y={height - 36} fill="#fda4af" fontSize="12" fontWeight="800">AMENAZAS RIVAL ↓</text>
    {momentum.bins.map((bin) => <MomentumBar key={bin.key} bin={bin} x={position(bin.globalMinute)} axis={axis} width={barWidth} unit={unit} selected={selected === bin.key} onSelect={() => onSelect(bin.key)}/>) }
  </svg>{momentum.actions.length === 0 && <p className="py-4 text-center text-xs text-slate-500">No hay acciones para estos filtros.</p>}</div>;
}

function MomentumBar({ bin, x, axis, width, unit, selected, onSelect }: { bin: MomentumBin; x: number; axis: number; width: number; unit: number; selected: boolean; onSelect: () => void }) {
  let top = axis; let bottom = axis;
  const pieces = (["FOR", "AGAINST"] as const).flatMap((side) => DANGERS.flatMap((danger) => {
    const count = bin[side][danger]; if (!count) return [];
    const height = count * unit;
    const y = side === "FOR" ? top - height : bottom;
    if (side === "FOR") top -= height; else bottom += height;
    return [<rect key={`${side}-${danger}`} x={x - width / 2} y={y} width={width} height={height} fill={MOMENTUM_COLORS[side][danger]} opacity={bin.highlighted ? 1 : .2}/>];
  }));
  return <g role="button" tabIndex={0} aria-label={`P${bin.period} minuto ${bin.minute}: ${momentumBinTotal(bin, "FOR")} remates CDA, ${momentumBinTotal(bin, "AGAINST")} amenazas rival`} onMouseEnter={onSelect} onFocus={onSelect} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} className="cursor-pointer"><rect x={x - Math.max(10, width) / 2} y="20" width={Math.max(10, width)} height="290" fill="transparent"/>{pieces}{selected && <rect x={x - width / 2 - 3} y={top - 3} width={width + 6} height={bottom - top + 6} fill="none" stroke="#f8fafc" strokeWidth="2" rx="2"/>}</g>;
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
  for (const bin of momentum.bins) { let top = axis; let bottom = axis; for (const side of ["FOR", "AGAINST"] as const) for (const danger of DANGERS) { const count = bin[side][danger]; if (!count) continue; const h = count * unit; context.globalAlpha = bin.highlighted ? 1 : .2; context.fillStyle = MOMENTUM_COLORS[side][danger]; if (side === "FOR") { top -= h; context.fillRect(x(bin.globalMinute) - barWidth / 2, top, barWidth, h); } else { context.fillRect(x(bin.globalMinute) - barWidth / 2, bottom, barWidth, h); bottom += h; } } }
  context.globalAlpha = 1; context.fillStyle = "#86efac"; context.font = "700 16px system-ui"; context.fillText("REMATES CDA ↑", 54, 166); context.fillStyle = "#fda4af"; context.fillText("AMENAZAS RIVAL ↓", 54, 568);
  context.font = "12px system-ui"; context.fillStyle = "#94a3b8"; for (let minute = 0; minute <= momentum.displayDuration; minute += 5) { context.textAlign = "center"; context.fillText(`${minute}'`, x(momentum.displayStart + minute), 588); } context.textAlign = "left";
  let legendX = 54; context.font = "12px system-ui"; for (const side of ["FOR", "AGAINST"] as const) for (const danger of DANGERS) { context.fillStyle = MOMENTUM_COLORS[side][danger]; context.fillRect(legendX, 610, 12, 12); context.fillStyle = "#cbd5e1"; context.fillText(`${side === "FOR" ? "CDA" : "Rival"} ${DANGER_LABEL[danger]}`, legendX + 18, 621); legendX += danger === "HIGH" ? 158 : 130; }
  context.fillStyle = "#94a3b8"; context.font = "13px system-ui"; context.fillText("Cercana: acción originada en zona próxima a portería. · Cerc a puerta: cercana que además va a portería.", 54, 660); context.fillText("Gol: finalización en gol. · Más intensidad de color = mayor peligrosidad. · La altura representa cantidades.", 54, 686);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar la imagen.")), "image/png"));
  const file = new File([blob], `momentum-${momentum.matchId}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Momentum · ${momentum.opponent}` }); return; }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import {
  buildMatchMomentum,
  EMPTY_MOMENTUM_FILTERS,
  MatchMomentum,
  MomentumBin,
  MomentumDanger,
  MomentumDangerFilter,
  MomentumFilters,
  MomentumPeriodFilter,
  momentumBinTotal,
  momentumExportHeading,
} from "../../lib/matchMomentum";
import { ThreatPhase } from "../../types";

const PHASES: Array<[ThreatPhase, string]> = [
  ["POSITIONAL", "Posicional"], ["TRANSITION", "Transición"],
  ["SET_PIECE_CORNER", "Córner"], ["SET_PIECE_FREE_KICK", "Falta"],
  ["SET_PIECE_KICK_IN", "Banda"], ["FLYING_GOALKEEPER", "P-J"],
  ["PENALTY", "Penalti"], ["DOUBLE_PENALTY", "Doble penalti"],
  ["UNSPECIFIED", "Sin fase"],
];
const PHASE_LABEL = Object.fromEntries(PHASES) as Record<ThreatPhase, string>;
const DANGERS: MomentumDanger[] = ["NORMAL", "NEAR", "HIGH", "GOAL"];
const DANGER_LABEL: Record<MomentumDanger, string> = { NORMAL: "Normal", NEAR: "Cercana", HIGH: "Alto peligro", GOAL: "Gol" };
const COLORS: Record<"FOR" | "AGAINST", Record<MomentumDanger, string>> = {
  FOR: { NORMAL: "#14532d", NEAR: "#16a34a", HIGH: "#4ade80", GOAL: "#dcfce7" },
  AGAINST: { NORMAL: "#7f1d1d", NEAR: "#dc2626", HIGH: "#fb7185", GOAL: "#ffe4e6" },
};

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
  const updatePlayers = (playerId: string) => setFilters((current) => ({ ...current, playerIds: current.playerIds.includes(playerId) ? current.playerIds.filter((id) => id !== playerId) : [...current.playerIds, playerId] }));
  const exportImage = async () => {
    setExporting(true);
    try { await shareMomentumImage(momentum, filters); } finally { setExporting(false); }
  };
  return <section data-match-momentum className="rounded-3xl border border-emerald-900/70 bg-slate-900 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[9px] font-black tracking-[.18em] text-emerald-300">CRONOLOGÍA REAL · SIN SCORE ARTIFICIAL</p><h2 className="text-xl font-black sm:text-2xl">MOMENTUM</h2><p className="mt-1 text-xs text-slate-400">Altura = acciones · intensidad = peligrosidad</p></div><button type="button" disabled={exporting} onClick={exportImage} className="min-h-11 rounded-xl border border-emerald-700 px-3 text-[10px] font-black text-emerald-200 disabled:opacity-50">{exporting ? "GENERANDO…" : "COMPARTIR / EXPORTAR IMAGEN"}</button></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-[9px] font-black text-slate-400">PARTIDO<select aria-label="Partido de Momentum" value={matchId} onChange={(event) => setMatchId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-800 px-3 text-xs text-white">{matches.map((match) => <option key={match.matchId} value={match.matchId}>{match.date} · {match.opponent}</option>)}</select></label>
      <CompactButtons label="PERIODO" values={[["ALL", "TODO"], [1, "P1"], [2, "P2"]] as const} selected={filters.period} onSelect={(period) => setFilters((current) => ({ ...current, period: period as MomentumPeriodFilter }))}/>
      <CompactButtons label="PELIGROSIDAD" values={[["ALL", "TODAS"], ["NEAR", "CERCANAS"], ["HIGH", "ALTO PELIGRO"], ["GOAL", "GOLES"]] as const} selected={filters.danger} onSelect={(danger) => setFilters((current) => ({ ...current, danger: danger as MomentumDangerFilter }))}/>
      <details className="relative"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl bg-slate-800 px-3 text-[10px] font-black"><span>JUGADORES</span><span className="text-emerald-300">{filters.playerIds.length || "TODOS"}</span></summary><div className="absolute right-0 z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">{players.map((player) => <label key={player.id} className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs hover:bg-slate-800"><input type="checkbox" checked={filters.playerIds.includes(player.id)} onChange={() => updatePlayers(player.id)}/><span>#{player.number} · {player.name}</span></label>)}</div></details>
    </div>
    <div className="mt-3 flex flex-wrap gap-1">{PHASES.map(([phase, label]) => <button type="button" key={phase} onClick={() => setFilters((current) => ({ ...current, phases: current.phases.includes(phase) ? current.phases.filter((item) => item !== phase) : [...current.phases, phase] }))} className={`min-h-9 rounded-lg border px-2 text-[9px] font-black ${filters.phases.includes(phase) ? "border-emerald-300 bg-emerald-300 text-slate-950" : "border-slate-700 text-slate-400"}`}>{label.toUpperCase()}</button>)}</div>
    {filters.playerIds.length > 0 && <p className="mt-3 rounded-xl bg-slate-950/70 px-3 py-2 text-xs text-emerald-200"><b>{momentum.selectedPlayerNames.join(" + ")}</b> · juntos {formatDuration(momentum.sharedMinutes)}. El resto del partido permanece visible y atenuado.</p>}
    <MomentumChart momentum={momentum} selected={selectedBin} onSelect={setSelectedBin}/>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[9px] text-slate-400"><b className="text-white">LEYENDA</b>{(["FOR", "AGAINST"] as const).flatMap((side) => DANGERS.map((danger) => <span key={`${side}-${danger}`} className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLORS[side][danger] }}/>{side === "FOR" ? "CDA" : "Rival"} · {DANGER_LABEL[danger]}</span>))}<span className="basis-full">Cercana: origen en zona próxima a portería (Z1–Z3). Alto peligro: cercana + a portería. Mayor intensidad = mayor peligrosidad.</span></div>
    {detail && <MomentumDetail bin={detail}/>} 
  </section>;
}

function CompactButtons<T extends string | number>({ label, values, selected, onSelect }: { label: string; values: readonly (readonly [T, string])[]; selected: T; onSelect: (value: T) => void }) {
  return <fieldset><legend className="mb-1 text-[9px] font-black text-slate-400">{label}</legend><div className="flex min-h-11 flex-wrap items-center gap-1 rounded-xl bg-slate-800 p-1">{values.map(([value, text]) => <button type="button" key={String(value)} onClick={() => onSelect(value)} className={`min-h-8 flex-1 rounded-lg px-2 text-[9px] font-black ${selected === value ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}>{text}</button>)}</div></fieldset>;
}

function MomentumChart({ momentum, selected, onSelect }: { momentum: MatchMomentum; selected: string | null; onSelect: (key: string) => void }) {
  const width = 1000; const height = 340; const left = 36; const right = 16; const axis = 170; const plotWidth = width - left - right; const max = Math.max(1, ...momentum.bins.flatMap((bin) => [momentumBinTotal(bin, "FOR"), momentumBinTotal(bin, "AGAINST")])); const unit = 130 / max;
  const position = (minute: number) => left + (minute / Math.max(1, momentum.duration)) * plotWidth;
  const barWidth = Math.max(4, Math.min(18, plotWidth / Math.max(1, momentum.duration + 1) - 2));
  return <div className="mt-4"><svg data-momentum-chart viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Momentum temporal: remates CDA arriba y amenazas rival abajo" className="h-auto w-full rounded-2xl bg-slate-950">
    <line x1={left} x2={width - right} y1={axis} y2={axis} stroke="#64748b" strokeWidth="2"/>
    {momentum.periodEnds.slice(0, -1).map((end) => <g key={end}><line x1={position(end)} x2={position(end)} y1="20" y2={height - 30} stroke="#94a3b8" strokeDasharray="6 6"/><text x={position(end)} y="16" textAnchor="middle" fill="#cbd5e1" fontSize="12" fontWeight="700">P1 / P2</text></g>)}
    {Array.from({ length: Math.floor(momentum.duration / 5) + 1 }, (_, index) => index * 5).map((minute) => <g key={minute}><line x1={position(minute)} x2={position(minute)} y1={axis - 4} y2={axis + 4} stroke="#94a3b8"/><text x={position(minute)} y={height - 10} textAnchor="middle" fill="#64748b" fontSize="11">{minute}&apos;</text></g>)}
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
    return [<rect key={`${side}-${danger}`} x={x - width / 2} y={y} width={width} height={height} fill={COLORS[side][danger]} opacity={bin.highlighted ? 1 : .2}/>];
  }));
  return <g role="button" tabIndex={0} aria-label={`P${bin.period} minuto ${bin.minute}: ${momentumBinTotal(bin, "FOR")} remates CDA, ${momentumBinTotal(bin, "AGAINST")} amenazas rival`} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} className="cursor-pointer"><rect x={x - Math.max(10, width) / 2} y="20" width={Math.max(10, width)} height="290" fill="transparent"/>{pieces}{selected && <rect x={x - width / 2 - 3} y={top - 3} width={width + 6} height={bottom - top + 6} fill="none" stroke="#f8fafc" strokeWidth="2" rx="2"/>}</g>;
}

function MomentumDetail({ bin }: { bin: MomentumBin }) {
  const near = bin.FOR.NEAR + bin.AGAINST.NEAR; const high = bin.FOR.HIGH + bin.AGAINST.HIGH; const goals = bin.FOR.GOAL + bin.AGAINST.GOAL;
  return <div className="mt-3 grid gap-2 rounded-2xl border border-slate-700 bg-slate-950 p-3 text-xs sm:grid-cols-6"><b>P{bin.period} · min {bin.minute}</b><span>Remates <b>{momentumBinTotal(bin, "FOR")}</b></span><span>Amenazas <b>{momentumBinTotal(bin, "AGAINST")}</b></span><span>Cercanas <b>{near}</b></span><span>Alto peligro <b>{high}</b></span><span>Goles <b>{goals}</b></span><span className="sm:col-span-6 text-slate-400">Fase: {bin.phases.map((phase) => PHASE_LABEL[phase]).join(" · ") || "N/D"}</span></div>;
}

function formatDuration(minutes: number): string {
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1).replace(".", ",")} min`;
}

async function shareMomentumImage(momentum: MatchMomentum, filters: MomentumFilters): Promise<void> {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 675;
  const context = canvas.getContext("2d"); if (!context) throw new Error("No se pudo generar la imagen.");
  context.fillStyle = "#020617"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f8fafc"; context.font = "800 34px system-ui"; context.fillText("APP ALAM · MOMENTUM", 54, 58);
  context.fillStyle = "#a7f3d0"; context.font = "700 22px system-ui"; context.fillText(momentumExportHeading(momentum, filters), 54, 96);
  const shared = momentum.selectedPlayerNames.length > 0 ? ` · juntos ${formatDuration(momentum.sharedMinutes)}` : "";
  context.fillStyle = "#94a3b8"; context.font = "16px system-ui"; context.fillText(`${momentum.date} · CDA ${momentum.score.for}-${momentum.score.against} ${momentum.opponent}${shared}`, 54, 126);
  const left = 60; const right = 1140; const axis = 365; const plot = right - left; const max = Math.max(1, ...momentum.bins.flatMap((bin) => [momentumBinTotal(bin, "FOR"), momentumBinTotal(bin, "AGAINST")])); const unit = 190 / max; const x = (minute: number) => left + minute / Math.max(1, momentum.duration) * plot;
  context.strokeStyle = "#64748b"; context.lineWidth = 2; context.beginPath(); context.moveTo(left, axis); context.lineTo(right, axis); context.stroke();
  for (const end of momentum.periodEnds.slice(0, -1)) { context.setLineDash([6, 6]); context.beginPath(); context.moveTo(x(end), 150); context.lineTo(x(end), 585); context.stroke(); context.setLineDash([]); }
  const barWidth = Math.max(5, Math.min(18, plot / Math.max(1, momentum.duration + 1) - 2));
  for (const bin of momentum.bins) { let top = axis; let bottom = axis; for (const side of ["FOR", "AGAINST"] as const) for (const danger of DANGERS) { const count = bin[side][danger]; if (!count) continue; const h = count * unit; context.globalAlpha = bin.highlighted ? 1 : .2; context.fillStyle = COLORS[side][danger]; if (side === "FOR") { top -= h; context.fillRect(x(bin.globalMinute) - barWidth / 2, top, barWidth, h); } else { context.fillRect(x(bin.globalMinute) - barWidth / 2, bottom, barWidth, h); bottom += h; } } }
  context.globalAlpha = 1; context.fillStyle = "#86efac"; context.font = "700 16px system-ui"; context.fillText("REMATES CDA ↑", 54, 170); context.fillStyle = "#fda4af"; context.fillText("AMENAZAS RIVAL ↓", 54, 610);
  context.fillStyle = "#94a3b8"; context.font = "14px system-ui"; context.fillText("Cercana: Z1–Z3 · Alto peligro: cercana + a portería · Mayor intensidad = mayor peligrosidad", 54, 646);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo generar la imagen.")), "image/png"));
  const file = new File([blob], `momentum-${momentum.matchId}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Momentum · ${momentum.opponent}` }); return; }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

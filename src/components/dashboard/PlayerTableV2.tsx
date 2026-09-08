"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PlayerAnalysis } from "../../lib/dashboardAnalysis";
import { DashboardValueMode, PlayerScore, playerMetricValue, SortDirection, squadAverage, stableSortByMetric } from "../../lib/dashboardV2";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";
import { formatFutsalPosition } from "../../lib/positionFormat";

type View = "GENERAL" | "ON_COURT" | "DANGER" | "CONTEXT" | "DISCIPLINE";
type Column = "matches" | "minutes" | "avgMinutes" | "goals" | "assists" | "threats" | "points" | "plusMinus" | "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "threatBalance" | "onTargetFor" | "onTargetAgainst" | "onTargetBalance" | "nearFor" | "nearAgainst" | "nearBalance" | "keyMinutes" | "keyPercentage" | "goldMinutes" | "goldPercentage" | "foulsCommitted" | "foulsReceived" | "criticalCommitted" | "criticalReceived" | "score";

const format = (value: number | null) => value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

function Header({ id, label, column, direction, onSort }: { id: Column; label: string; column: Column; direction: SortDirection; onSort: (id: Column) => void }) {
  return <button type="button" onClick={() => onSort(id)} className="min-h-10 text-right text-[9px] font-black text-slate-400" aria-label={`Ordenar por ${label}`}>{label} {column === id ? direction === "asc" ? "↑" : "↓" : "↕"}</button>;
}

export function PlayerTableV2({ players, scores, mode, detailQuery }: { players: PlayerAnalysis[]; scores: PlayerScore[]; mode: DashboardValueMode; detailQuery: string }) {
  const [view, setView] = useState<View>("GENERAL");
  const [column, setColumn] = useState<Column>("minutes");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const scoreMap = useMemo(() => new Map(scores.map((score) => [score.playerId, score])), [scores]);
  const metric = (player: PlayerAnalysis, selectedColumn = column): number | null => selectedColumn === "score" ? scoreMap.get(player.playerId)?.score ?? null : metricForColumn(player, selectedColumn, mode);
  const sorted = stableSortByMetric(players, metric, direction);
  const sort = (next: Column) => {
    if (next === column) setDirection((current) => current === "desc" ? "asc" : "desc");
    else { setColumn(next); setDirection("desc"); }
  };
  const shown = view === "GENERAL"
    ? (["matches", "minutes", "avgMinutes", "goals", "assists", "threats", "score"] as Column[])
    : view === "ON_COURT" ? (["minutes", "goalsFor", "goalsAgainst", "plusMinus", "threatsFor", "threatsAgainst", "threatBalance", "points"] as Column[])
      : view === "DANGER" ? (["minutes", "onTargetFor", "onTargetAgainst", "onTargetBalance", "nearFor", "nearAgainst", "nearBalance"] as Column[])
        : view === "CONTEXT" ? (["minutes", "keyMinutes", "keyPercentage", "goldMinutes", "goldPercentage", "points"] as Column[])
          : (["minutes", "foulsCommitted", "foulsReceived", "criticalCommitted", "criticalReceived"] as Column[]);
  const labels: Record<Column, string> = { matches: "PJ", minutes: "MIN", avgMinutes: "MIN/PART.", goals: "G", assists: "ASIST.", threats: "REM.", points: "PTS PISTA", plusMinus: "DIF. GOLES", goalsFor: "GF", goalsAgainst: "GC", threatsFor: "REM. EQ.", threatsAgainst: "AMEN.", threatBalance: "BAL. REM/AME", onTargetFor: "REM. PUERTA", onTargetAgainst: "AME. PUERTA", onTargetBalance: "BAL. PUERTA", nearFor: "REM. CERCA", nearAgainst: "AME. CERCA", nearBalance: "BAL. CERCA", keyMinutes: "MIN. CLAVE", keyPercentage: "% CLAVE", goldMinutes: "MIN. ORO", goldPercentage: "% ORO", foulsCommitted: "FC", foulsReceived: "FR", criticalCommitted: "FC 5+", criticalReceived: "FR 5+", score: "SCORE" };
  const averages = new Map(shown.map((id) => [id, squadAverage(players, (player) => metric(player, id))]));
  const eligiblePlayers = players.filter((player) => player.minutes > 0).length;
  return <section>
    <div className="mb-3 flex gap-2 overflow-x-auto">{(["GENERAL", "ON_COURT", "DANGER", "CONTEXT", "DISCIPLINE"] as View[]).map((item) => <button type="button" key={item} onClick={() => setView(item)} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${view === item ? "bg-cyan-300 text-slate-950" : "bg-slate-800 text-slate-400"}`}>{item === "ON_COURT" ? "EN PISTA" : item === "DANGER" ? "A PUERTA / CERCA" : item === "CONTEXT" ? "CLAVE / ORO" : item === "DISCIPLINE" ? "DISCIPLINA" : "GENERAL"}</button>)}</div>
    <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
      <div style={{ minWidth: `${300 + shown.length * 82}px` }}>
        <div className="grid items-center gap-3 border-b border-slate-700 px-4 py-1" style={{ gridTemplateColumns: `minmax(15rem,1fr) repeat(${shown.length},minmax(4.5rem,auto))` }}><span className="text-[9px] font-black text-slate-500">JUGADOR</span>{shown.map((id) => <Header key={id} id={id} label={labels[id]} column={column} direction={direction} onSort={sort} />)}</div>
        <div data-squad-average className="grid min-h-14 items-center gap-3 border-b border-amber-800/60 bg-amber-950/30 px-4 py-2" style={{ gridTemplateColumns: `minmax(15rem,1fr) repeat(${shown.length},minmax(4.5rem,auto))` }} title="Media de los jugadores con participación válida dentro del contexto y filtros seleccionados."><span><strong className="block text-xs text-amber-200">MEDIA PLANTILLA</strong><small className="text-[9px] text-slate-400">{eligiblePlayers} jugadores · min &gt; 0</small></span>{shown.map((id) => { const average = averages.get(id)!; return <span key={id} className="text-right text-sm font-black text-amber-100" title={`N=${average.validValues} valores válidos`}>{format(average.value)}</span>; })}</div>
        {sorted.map((player) => <Link key={player.playerId} href={`/dashboard/jugador/${encodeURIComponent(player.playerId)}?${detailQuery}`} className="grid min-h-16 items-center gap-3 border-b border-slate-800 px-4 py-2 last:border-0 hover:bg-slate-800/70" style={{ gridTemplateColumns: `minmax(15rem,1fr) repeat(${shown.length},minmax(4.5rem,auto))` }}>
          <span className="flex min-w-0 items-center gap-3"><PlayerPhotoCard player={{ id: player.playerId, name: player.name, number: player.number, photoUrl: player.photoUrl }} className="h-11 w-11 shrink-0 rounded-full"/><span className="min-w-0"><strong className="block truncate">#{player.number} · {player.name}</strong><small className="text-[9px] text-slate-500">{formatFutsalPosition(player.position, "N/D")}{player.lowSample ? " · MUESTRA BAJA" : ""}</small></span></span>
          {shown.map((id) => <span key={id} className="text-right text-sm font-black">{format(metric(player, id))}</span>)}
        </Link>)}
      </div>
    </div>
    <p className="mt-2 text-[10px] text-slate-500">PTS EN PISTA: resultado obtenido considerando únicamente los minutos en los que el jugador estuvo en pista. No implica causalidad. SCORE ALAM es experimental.</p>
  </section>;
}

function metricForColumn(player: PlayerAnalysis, column: Column, mode: DashboardValueMode): number | null {
  const normalize = (total: number, per40Value?: number | null) => mode === "TOTALS" ? total : mode === "PER_MATCH" ? player.matches > 0 ? total / player.matches : null : per40Value ?? (player.minutes > 0 ? total / player.minutes * 40 : null);
  if (column === "matches") return player.matches;
  if (column === "avgMinutes") return player.averageMinutes;
  if (column === "plusMinus") return normalize(player.onCourt.goalDifference, player.onCourt.goalDifference40);
  if (column === "goalsFor") return normalize(player.onCourt.goalsFor, player.onCourt.goalsFor40);
  if (column === "goalsAgainst") return normalize(player.onCourt.goalsAgainst, player.onCourt.goalsAgainst40);
  if (column === "keyMinutes") return mode === "PER_MATCH" ? player.keyMinutesPerMatch : player.keyMinutes;
  if (column === "goldMinutes") return mode === "PER_MATCH" ? player.goldMinutesPerMatch : player.goldMinutes;
  if (column === "threatsFor") return mode === "PER_40" ? player.onCourt.threatsFor40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsFor / player.matches : player.onCourt.threatsFor;
  if (column === "threatsAgainst") return mode === "PER_40" ? player.onCourt.threatsAgainst40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsAgainst / player.matches : player.onCourt.threatsAgainst;
  if (column === "threatBalance") return normalize(player.onCourt.threatsFor - player.onCourt.threatsAgainst, player.onCourt.threatDifference40);
  if (column === "onTargetFor") return normalize(player.onCourt.threatsForOnTarget);
  if (column === "onTargetAgainst") return normalize(player.onCourt.threatsAgainstOnTarget);
  if (column === "onTargetBalance") return normalize(player.onCourt.threatsForOnTarget - player.onCourt.threatsAgainstOnTarget);
  if (column === "nearFor") return normalize(player.onCourt.threatsForNear);
  if (column === "nearAgainst") return normalize(player.onCourt.threatsAgainstNear);
  if (column === "nearBalance") return normalize(player.onCourt.threatsForNear - player.onCourt.threatsAgainstNear);
  if (column === "keyPercentage") return player.keyMinutesPercentage;
  if (column === "goldPercentage") return player.goldMinutesPercentage;
  if (column === "score") return null;
  return playerMetricValue(player, column, mode);
}

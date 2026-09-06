"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { PlayerAnalysis } from "../../lib/dashboardAnalysis";
import { DashboardValueMode, PlayerScore, playerMetricValue, SortDirection, stableSortByMetric } from "../../lib/dashboardV2";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";

type View = "GENERAL" | "ON_COURT" | "DISCIPLINE";
type Column = "matches" | "minutes" | "avgMinutes" | "goals" | "assists" | "threats" | "points" | "plusMinus" | "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "keyMinutes" | "goldMinutes" | "foulsCommitted" | "foulsReceived" | "criticalCommitted" | "criticalReceived" | "score";

const format = (value: number | null) => value === null ? "N/D" : Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

function Header({ id, label, column, direction, onSort }: { id: Column; label: string; column: Column; direction: SortDirection; onSort: (id: Column) => void }) {
  return <button type="button" onClick={() => onSort(id)} className="min-h-10 text-right text-[9px] font-black text-slate-400" aria-label={`Ordenar por ${label}`}>{label} {column === id ? direction === "asc" ? "↑" : "↓" : "↕"}</button>;
}

export function PlayerTableV2({ players, scores, mode, detailQuery }: { players: PlayerAnalysis[]; scores: PlayerScore[]; mode: DashboardValueMode; detailQuery: string }) {
  const [view, setView] = useState<View>("GENERAL");
  const [column, setColumn] = useState<Column>("minutes");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const scoreMap = useMemo(() => new Map(scores.map((score) => [score.playerId, score])), [scores]);
  const metric = (player: PlayerAnalysis): number | null => {
    if (column === "matches") return player.matches;
    if (column === "avgMinutes") return player.averageMinutes;
    if (column === "plusMinus") return player.onCourt.goalDifference;
    if (column === "goalsFor") return player.onCourt.goalsFor;
    if (column === "goalsAgainst") return player.onCourt.goalsAgainst;
    if (column === "keyMinutes") return mode === "PER_MATCH" ? player.keyMinutesPerMatch : player.keyMinutes;
    if (column === "goldMinutes") return mode === "PER_MATCH" ? player.goldMinutesPerMatch : player.goldMinutes;
    if (column === "threatsFor") return mode === "PER_40" ? player.onCourt.threatsFor40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsFor / player.matches : player.onCourt.threatsFor;
    if (column === "threatsAgainst") return mode === "PER_40" ? player.onCourt.threatsAgainst40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsAgainst / player.matches : player.onCourt.threatsAgainst;
    if (column === "score") return scoreMap.get(player.playerId)?.score ?? null;
    return playerMetricValue(player, column, mode);
  };
  const sorted = stableSortByMetric(players, metric, direction);
  const sort = (next: Column) => {
    if (next === column) setDirection((current) => current === "desc" ? "asc" : "desc");
    else { setColumn(next); setDirection("desc"); }
  };
  const shown = view === "GENERAL"
    ? (["matches", "minutes", "avgMinutes", "goals", "assists", "threats", "score"] as Column[])
    : view === "ON_COURT"
      ? (["minutes", "goalsFor", "goalsAgainst", "plusMinus", "threatsFor", "threatsAgainst", "points", "keyMinutes", "goldMinutes"] as Column[])
      : (["minutes", "foulsCommitted", "foulsReceived", "criticalCommitted", "criticalReceived"] as Column[]);
  const labels: Record<Column, string> = { matches: "PJ", minutes: "MIN", avgMinutes: "MIN/PART.", goals: "G", assists: "ASIST.", threats: "REM.", points: "PTS PISTA", plusMinus: "DIF. GOLES", goalsFor: "GF", goalsAgainst: "GC", threatsFor: "REM. EQ.", threatsAgainst: "AMEN.", keyMinutes: "MIN. CLAVE", goldMinutes: "MIN. ORO", foulsCommitted: "FC", foulsReceived: "FR", criticalCommitted: "FC 5+", criticalReceived: "FR 5+", score: "SCORE" };
  return <section>
    <div className="mb-3 flex gap-2 overflow-x-auto">{(["GENERAL", "ON_COURT", "DISCIPLINE"] as View[]).map((item) => <button type="button" key={item} onClick={() => setView(item)} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${view === item ? "bg-cyan-300 text-slate-950" : "bg-slate-800 text-slate-400"}`}>{item === "ON_COURT" ? "EN PISTA" : item === "DISCIPLINE" ? "DISCIPLINA" : "GENERAL"}</button>)}</div>
    <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
      <div style={{ minWidth: `${300 + shown.length * 82}px` }}>
        <div className="grid items-center gap-3 border-b border-slate-700 px-4 py-1" style={{ gridTemplateColumns: `minmax(15rem,1fr) repeat(${shown.length},minmax(4.5rem,auto))` }}><span className="text-[9px] font-black text-slate-500">JUGADOR</span>{shown.map((id) => <Header key={id} id={id} label={labels[id]} column={column} direction={direction} onSort={sort} />)}</div>
        {sorted.map((player) => <Link key={player.playerId} href={`/dashboard/jugador/${encodeURIComponent(player.playerId)}?${detailQuery}`} className="grid min-h-16 items-center gap-3 border-b border-slate-800 px-4 py-2 last:border-0 hover:bg-slate-800/70" style={{ gridTemplateColumns: `minmax(15rem,1fr) repeat(${shown.length},minmax(4.5rem,auto))` }}>
          <span className="flex min-w-0 items-center gap-3"><PlayerPhotoCard player={{ id: player.playerId, name: player.name, number: player.number, photoUrl: player.photoUrl }} className="h-11 w-11 shrink-0 rounded-full"/><span className="min-w-0"><strong className="block truncate">#{player.number} · {player.name}</strong><small className="text-[9px] text-slate-500">{player.position ?? "N/D"}{player.lowSample ? " · MUESTRA BAJA" : ""}</small></span></span>
          {shown.map((id) => <span key={id} className="text-right text-sm font-black">{format(id === "score" ? scoreMap.get(player.playerId)?.score ?? null : metricForColumn(player, id, mode))}</span>)}
        </Link>)}
      </div>
    </div>
    <p className="mt-2 text-[10px] text-slate-500">PTS EN PISTA: resultado obtenido considerando únicamente los minutos en los que el jugador estuvo en pista. No implica causalidad. SCORE ALAM es experimental.</p>
  </section>;
}

function metricForColumn(player: PlayerAnalysis, column: Column, mode: DashboardValueMode): number | null {
  if (column === "matches") return player.matches;
  if (column === "avgMinutes") return player.averageMinutes;
  if (column === "plusMinus") return player.onCourt.goalDifference;
  if (column === "goalsFor") return player.onCourt.goalsFor;
  if (column === "goalsAgainst") return player.onCourt.goalsAgainst;
  if (column === "keyMinutes") return mode === "PER_MATCH" ? player.keyMinutesPerMatch : player.keyMinutes;
  if (column === "goldMinutes") return mode === "PER_MATCH" ? player.goldMinutesPerMatch : player.goldMinutes;
  if (column === "threatsFor") return mode === "PER_40" ? player.onCourt.threatsFor40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsFor / player.matches : player.onCourt.threatsFor;
  if (column === "threatsAgainst") return mode === "PER_40" ? player.onCourt.threatsAgainst40 : mode === "PER_MATCH" && player.matches > 0 ? player.onCourt.threatsAgainst / player.matches : player.onCourt.threatsAgainst;
  if (column === "score") return null;
  return playerMetricValue(player, column, mode);
}

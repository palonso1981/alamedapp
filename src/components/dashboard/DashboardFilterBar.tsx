"use client";

import { MatchCatalogEntry } from "../../lib/matchCatalog";
import {
  DashboardPhaseFilter,
  DashboardReferencePreset,
  DashboardScopeV2,
  DashboardValueMode,
} from "../../lib/dashboardV2";
import { Season, TeamProfile, ThreatOutcome } from "../../types";

const PHASES: Array<[DashboardPhaseFilter, string]> = [
  ["POSITIONAL", "Posicional"], ["TRANSITION", "Transición"], ["SET_PIECE", "ABP"],
  ["SET_PIECE_CORNER", "Córner"], ["SET_PIECE_KICK_IN", "Banda cercana"],
  ["SET_PIECE_FREE_KICK", "Falta"], ["FLYING_GOALKEEPER", "P-J"],
  ["PENALTY", "Penalti"], ["DOUBLE_PENALTY", "Doble penalti"],
];
const ZONES = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"] as const;

function toggle<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function MultiButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-9 rounded-xl px-3 text-[10px] font-black ${active ? "bg-cyan-300 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>{children}</button>;
}

export interface DashboardFilterBarProps {
  clubName: string;
  clubs?: Array<{ clubId: string; name: string }>;
  onClub?: (clubId: string) => void;
  scope: DashboardScopeV2;
  teams: TeamProfile[];
  seasons: Season[];
  matches: MatchCatalogEntry[];
  rivals: string[];
  players?: Array<{ playerId: string; name: string }>;
  goalkeepers?: Array<{ playerId: string; name: string }>;
  referencePreset: DashboardReferencePreset;
  mode: DashboardValueMode;
  onScope: (scope: DashboardScopeV2) => void;
  onReferencePreset: (preset: DashboardReferencePreset) => void;
  onMode: (mode: DashboardValueMode) => void;
  onRefresh?: () => void;
  fixture?: boolean;
}

export function DashboardFilterBar({ clubName, clubs = [], onClub, scope, teams, seasons, matches, rivals, players = [], goalkeepers = [], referencePreset, mode, onScope, onReferencePreset, onMode, onRefresh, fixture }: DashboardFilterBarProps) {
  const patch = (changes: Partial<DashboardScopeV2>) => onScope({ ...scope, ...changes });
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (scope.period !== "ALL") chips.push({ key: "period", label: `P${scope.period}`, clear: () => patch({ period: "ALL" }) });
  scope.matchIds.forEach((id) => chips.push({ key: `m-${id}`, label: matches.find((match) => match.matchId === id)?.opponent ?? id, clear: () => patch({ matchIds: scope.matchIds.filter((item) => item !== id) }) }));
  scope.rivals.forEach((rival) => chips.push({ key: `r-${rival}`, label: rival, clear: () => patch({ rivals: scope.rivals.filter((item) => item !== rival) }) }));
  scope.venues.forEach((venue) => chips.push({ key: venue, label: venue === "HOME" ? "Local" : "Visitante", clear: () => patch({ venues: scope.venues.filter((item) => item !== venue) }) }));
  scope.results.forEach((result) => chips.push({ key: result, label: result === "WIN" ? "Victoria" : result === "DRAW" ? "Empate" : "Derrota", clear: () => patch({ results: scope.results.filter((item) => item !== result) }) }));
  scope.phases.forEach((phase) => chips.push({ key: phase, label: PHASES.find(([key]) => key === phase)?.[1] ?? phase, clear: () => patch({ phases: scope.phases.filter((item) => item !== phase) }) }));
  scope.originZones.forEach((zone) => chips.push({ key: zone, label: zone, clear: () => patch({ originZones: scope.originZones.filter((item) => item !== zone) }) }));
  scope.targetZones.forEach((zone) => chips.push({ key: `target-${zone}`, label: `Portería ${zone.replaceAll("_", " ")}`, clear: () => patch({ targetZones: scope.targetZones.filter((item) => item !== zone) }) }));
  scope.outcomes.forEach((outcome) => chips.push({ key: outcome, label: outcome, clear: () => patch({ outcomes: scope.outcomes.filter((item) => item !== outcome) }) }));
  if (scope.outcomeGroup === "ON_TARGET") chips.push({ key: "on-target", label: "A puerta", clear: () => patch({ outcomeGroup: "ALL" }) });
  if (scope.originDistance !== "ALL") chips.push({ key: "distance", label: scope.originDistance === "NEAR" ? "Zona cercana" : "Zona lejana", clear: () => patch({ originDistance: "ALL" }) });
  if (scope.competitiveContext !== "ALL") chips.push({ key: "context", label: scope.competitiveContext === "KEY" ? "Minutos clave" : "Minutos de oro", clear: () => patch({ competitiveContext: "ALL" }) });
  scope.playerIds.forEach((id) => chips.push({ key: `player-${id}`, label: players.find((player) => player.playerId === id)?.name ?? id, clear: () => patch({ playerIds: scope.playerIds.filter((item) => item !== id) }) }));
  scope.goalkeeperIds.forEach((id) => chips.push({ key: `keeper-${id}`, label: `Portero ${goalkeepers.find((keeper) => keeper.playerId === id)?.name ?? id}`, clear: () => patch({ goalkeeperIds: scope.goalkeeperIds.filter((item) => item !== id) }) }));
  const clearAll = () => patch({ matchIds: [], period: "ALL", venues: [], results: [], rivals: [], phases: [], playerIds: [], goalkeeperIds: [], originZones: [], targetZones: [], outcomes: [], outcomeGroup: "ALL", originDistance: "ALL", competitiveContext: "ALL" });

  return <section className="sticky top-0 z-30 rounded-b-3xl border border-t-0 border-slate-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur sm:top-2 sm:rounded-3xl sm:border-t">
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {fixture || !onClub ? <span className="shrink-0 rounded-xl bg-cyan-950 px-3 py-2 text-[10px] font-black text-cyan-200">{fixture ? "FIXTURE LOCAL" : clubName}</span> : <select aria-label="Club" value={scope.clubId} onChange={(event) => onClub(event.target.value)} className="min-h-10 min-w-36 rounded-xl bg-cyan-950 px-3 text-[10px] font-black text-cyan-100">{clubs.map((club) => <option key={club.clubId} value={club.clubId}>{club.name}</option>)}</select>}
      <select aria-label="Equipo" value={scope.teamId} onChange={(event) => { const teamId = event.target.value; patch({ teamId, seasonId: seasons.find((season) => season.teamId === teamId && season.current)?.seasonId ?? seasons.find((season) => season.teamId === teamId)?.seasonId ?? "", matchIds: [] }); }} className="min-h-10 min-w-36 rounded-xl bg-slate-800 px-3 text-xs font-black">
        {!fixture && teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.name}</option>)}
        {fixture && <option value={scope.teamId}>Senior A · Fixture</option>}
      </select>
      <select aria-label="Temporada" value={scope.seasonId} onChange={(event) => patch({ seasonId: event.target.value, matchIds: [] })} className="min-h-10 min-w-32 rounded-xl bg-slate-800 px-3 text-xs font-black">
        {!fixture && seasons.filter((season) => season.teamId === scope.teamId).map((season) => <option key={season.seasonId} value={season.seasonId}>{season.label}</option>)}
        {fixture && <option value={scope.seasonId}>2026-27</option>}
      </select>
      <select aria-label="Partido" value={scope.matchIds.length === 1 ? scope.matchIds[0] : "ALL"} onChange={(event) => patch({ matchIds: event.target.value === "ALL" ? [] : [event.target.value] })} className="min-h-10 min-w-44 rounded-xl bg-slate-800 px-3 text-xs font-black">
        <option value="ALL">Todos los partidos</option>
        {matches.map((match) => <option key={match.matchId} value={match.matchId}>{match.date} · {match.opponent}</option>)}
      </select>
      {(["ALL", 1, 2] as const).map((period) => <MultiButton key={period} active={scope.period === period} onClick={() => patch({ period })}>{period === "ALL" ? "TODO" : `P${period}`}</MultiButton>)}
      {onRefresh && <button type="button" onClick={onRefresh} className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-slate-700 text-lg" aria-label="Actualizar datos">↻</button>}
    </div>
    <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[9px] font-black tracking-[.16em] text-slate-500">ANALIZO</span>
        {chips.length === 0 ? <span className="text-xs text-slate-400">Temporada completa</span> : chips.map((chip) => <button key={chip.key} type="button" onClick={chip.clear} className="shrink-0 rounded-full border border-cyan-800 bg-cyan-950/60 px-3 py-1.5 text-[10px] font-bold text-cyan-100">{chip.label} ×</button>)}
        {chips.length > 1 && <button type="button" onClick={clearAll} className="shrink-0 text-[10px] font-black text-slate-500">LIMPIAR</button>}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[9px] font-black tracking-[.16em] text-slate-500">COMPARO</span>
        <select aria-label="Referencia" value={referencePreset} onChange={(event) => onReferencePreset(event.target.value as DashboardReferencePreset)} className="min-h-9 rounded-xl bg-amber-950/70 px-3 text-[10px] font-black text-amber-100">
          <option value="SEASON">Media temporada</option><option value="HOME">Media local</option><option value="AWAY">Media visitante</option><option value="WINS">Victorias</option><option value="DRAWS">Empates</option><option value="LOSSES">Derrotas</option><option value="P1">Media P1</option><option value="P2">Media P2</option><option value="FILTERED">Selección filtrada</option>
        </select>
        <div className="flex rounded-xl bg-slate-900 p-1">{(["TOTALS", "PER_MATCH", "PER_40"] as DashboardValueMode[]).map((item) => <button key={item} type="button" onClick={() => onMode(item)} className={`min-h-8 rounded-lg px-2 text-[9px] font-black ${mode === item ? "bg-white text-slate-950" : "text-slate-500"}`}>{item === "TOTALS" ? "TOTALES" : item === "PER_MATCH" ? "POR PARTIDO" : "POR 40"}</button>)}</div>
      </div>
    </div>
    <details className="mt-2 rounded-2xl bg-slate-900/80 px-3 py-2">
      <summary className="cursor-pointer text-[10px] font-black text-slate-400">FILTROS AVANZADOS · {chips.length}</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">SEDE · RESULTADO</span>{(["HOME", "AWAY"] as const).map((value) => <MultiButton key={value} active={scope.venues.includes(value)} onClick={() => patch({ venues: toggle(scope.venues, value) })}>{value === "HOME" ? "LOCAL" : "VISITANTE"}</MultiButton>)}{(["WIN", "DRAW", "LOSS"] as const).map((value) => <MultiButton key={value} active={scope.results.includes(value)} onClick={() => patch({ results: toggle(scope.results, value) })}>{value === "WIN" ? "VICTORIA" : value === "DRAW" ? "EMPATE" : "DERROTA"}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">RIVALES · OR DENTRO DE LA DIMENSIÓN</span>{rivals.map((rival) => <MultiButton key={rival} active={scope.rivals.includes(rival)} onClick={() => patch({ rivals: toggle(scope.rivals, rival) })}>{rival}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">PARTIDOS · SELECCIÓN MÚLTIPLE</span>{matches.map((match) => <MultiButton key={match.matchId} active={scope.matchIds.includes(match.matchId)} onClick={() => patch({ matchIds: toggle(scope.matchIds, match.matchId) })}>{match.date.slice(5)} · {match.opponent}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">FASE</span>{PHASES.map(([value, label]) => <MultiButton key={value} active={scope.phases.includes(value)} onClick={() => patch({ phases: toggle(scope.phases, value) })}>{label}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">ORIGEN · RESULTADO</span>{ZONES.map((value) => <MultiButton key={value} active={scope.originZones.includes(value)} onClick={() => patch({ originZones: toggle(scope.originZones, value) })}>{value}</MultiButton>)}{(["GOL", "PARADA", "FUERA"] as ThreatOutcome[]).map((value) => <MultiButton key={value} active={scope.outcomes.includes(value)} onClick={() => patch({ outcomes: toggle(scope.outcomes, value) })}>{value}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">AGRUPACIONES OBJETIVAS</span><MultiButton active={scope.originDistance === "NEAR"} onClick={() => patch({ originDistance: scope.originDistance === "NEAR" ? "ALL" : "NEAR" })}>ZONA CERCANA</MultiButton><MultiButton active={scope.originDistance === "FAR"} onClick={() => patch({ originDistance: scope.originDistance === "FAR" ? "ALL" : "FAR" })}>ZONA LEJANA</MultiButton><MultiButton active={scope.outcomeGroup === "ON_TARGET"} onClick={() => patch({ outcomeGroup: scope.outcomeGroup === "ON_TARGET" ? "ALL" : "ON_TARGET", outcomes: [] })}>A PUERTA</MultiButton></div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">CONTEXTO TEMPORAL</span>{(["ALL", "KEY", "GOLD"] as const).map((value) => <MultiButton key={value} active={scope.competitiveContext === value} onClick={() => patch({ competitiveContext: value })}>{value === "ALL" ? "TODOS" : value === "KEY" ? "MINUTOS CLAVE" : "MINUTOS DE ORO"}</MultiButton>)}</div>
        {(players.length > 0 || goalkeepers.length > 0) && <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">JUGADOR / PORTERO · CUANDO LA MÉTRICA ES COMPATIBLE</span>{players.map((player) => <MultiButton key={player.playerId} active={scope.playerIds.includes(player.playerId)} onClick={() => patch({ playerIds: toggle(scope.playerIds, player.playerId) })}>{player.name}</MultiButton>)}{goalkeepers.map((keeper) => <MultiButton key={`gk-${keeper.playerId}`} active={scope.goalkeeperIds.includes(keeper.playerId)} onClick={() => patch({ goalkeeperIds: toggle(scope.goalkeeperIds, keeper.playerId) })}>🥅 {keeper.name}</MultiButton>)}</div>}
      </div>
    </details>
  </section>;
}

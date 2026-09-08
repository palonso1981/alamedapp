"use client";

import { ReactNode } from "react";
import {
  DashboardPhaseFilter,
  DashboardReferencePreset,
  DashboardScopeV2,
  DashboardValueMode,
} from "../../lib/dashboardV2";
import { Season, TeamProfile, ThreatOutcome } from "../../types";
import { SearchableMatchCombobox } from "./SearchableMatchCombobox";
import { SearchableMatch } from "../../lib/dashboardSelectors";

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
  matches: SearchableMatch[];
  rivals: string[];
  players?: Array<{ playerId: string; name: string }>;
  goalkeepers?: Array<{ playerId: string; name: string }>;
  referencePreset: DashboardReferencePreset;
  referenceScope: DashboardScopeV2;
  mode: DashboardValueMode;
  onScope: (scope: DashboardScopeV2) => void;
  onReferencePreset: (preset: DashboardReferencePreset) => void;
  onReferenceScope: (scope: DashboardScopeV2) => void;
  onMode: (mode: DashboardValueMode) => void;
  onRefresh?: () => void;
  fixture?: boolean;
  comparison?: ReactNode;
}

export function DashboardFilterBar({ clubName, clubs = [], onClub, scope, teams, seasons, matches, rivals, players = [], goalkeepers = [], referencePreset, referenceScope, mode, onScope, onReferencePreset, onReferenceScope, onMode, onRefresh, fixture, comparison }: DashboardFilterBarProps) {
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
  if (scope.playingState !== "ALL") chips.push({ key: "pj-state", label: scope.playingState === "PJ_CDA" ? "PJ CDA" : "PJ rival", clear: () => patch({ playingState: "ALL" }) });
  scope.playerIds.forEach((id) => chips.push({ key: `player-${id}`, label: players.find((player) => player.playerId === id)?.name ?? id, clear: () => patch({ playerIds: scope.playerIds.filter((item) => item !== id) }) }));
  scope.goalkeeperIds.forEach((id) => chips.push({ key: `keeper-${id}`, label: `Portero ${goalkeepers.find((keeper) => keeper.playerId === id)?.name ?? id}`, clear: () => patch({ goalkeeperIds: scope.goalkeeperIds.filter((item) => item !== id) }) }));
  const clearAll = () => patch({ matchIds: [], period: "ALL", venues: [], results: [], rivals: [], phases: [], playerIds: [], goalkeeperIds: [], originZones: [], targetZones: [], outcomes: [], outcomeGroup: "ALL", originDistance: "ALL", competitiveContext: "ALL", playingState: "ALL" });

  return <><div data-dashboard-sticky-context className="sticky top-16 z-30 overflow-hidden rounded-b-3xl border border-t-0 border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur sm:rounded-3xl"><section className="p-3">
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
      <select aria-label="Competición" value={scope.competition} onChange={(event) => patch({ competition: event.target.value as DashboardScopeV2["competition"], matchIds: [] })} className="min-h-10 min-w-32 rounded-xl bg-indigo-950 px-3 text-xs font-black text-indigo-100"><option value="LEAGUE">Liga</option><option value="CUP">Copa</option><option value="FRIENDLY">Amistoso</option><option value="OTHER">Otra</option><option value="ALL">Todas</option><option value="UNSPECIFIED">Sin clasificar</option></select>
      <SearchableMatchCombobox matches={matches} value={scope.matchIds.length === 1 ? scope.matchIds[0] : ""} onChange={(matchId) => { const selected = matches.find((match) => match.matchId === matchId); patch({ matchIds: matchId ? [matchId] : [], competition: selected?.competitionType ?? scope.competition }); }}/>
      <select aria-label="Portero funcional" value={scope.goalkeeperIds.length === 1 ? scope.goalkeeperIds[0] : "ALL"} onChange={(event) => patch({ goalkeeperIds: event.target.value === "ALL" ? [] : [event.target.value] })} className="min-h-10 min-w-40 rounded-xl bg-sky-950 px-3 text-xs font-black text-sky-100"><option value="ALL">Todos los porteros</option>{goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>🥅 {keeper.name}</option>)}</select>
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
          <optgroup label="Preset"><option value="SEASON">Media temporada</option><option value="HOME">Media local</option><option value="AWAY">Media visitante</option><option value="WINS">Victorias</option><option value="DRAWS">Empates</option><option value="LOSSES">Derrotas</option><option value="P1">Media P1</option><option value="P2">Media P2</option><option value="FILTERED">Selección filtrada</option></optgroup><optgroup label="Flexible"><option value="MATCH">Partido concreto</option><option value="CUSTOM">Referencia personalizada</option></optgroup>
        </select>
        <div className="flex rounded-xl bg-slate-900 p-1">{(["TOTALS", "PER_MATCH", "PER_40"] as DashboardValueMode[]).map((item) => <button key={item} type="button" onClick={() => onMode(item)} className={`min-h-8 rounded-lg px-2 text-[9px] font-black ${mode === item ? "bg-white text-slate-950" : "text-slate-500"}`}>{item === "TOTALS" ? "TOTALES" : item === "PER_MATCH" ? "POR PARTIDO" : "POR 40"}</button>)}</div>
      </div>
    </div>
    </section>{comparison}</div>{(referencePreset === "MATCH" || referencePreset === "CUSTOM") && <ReferenceBuilder preset={referencePreset} scope={referenceScope} analysis={scope} matches={matches} rivals={rivals} onChange={onReferenceScope}/>}<details data-dashboard-advanced-filters className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2">
      <summary className="cursor-pointer text-[10px] font-black text-slate-400">FILTROS AVANZADOS · {chips.length}</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">SEDE · RESULTADO</span>{(["HOME", "AWAY"] as const).map((value) => <MultiButton key={value} active={scope.venues.includes(value)} onClick={() => patch({ venues: toggle(scope.venues, value) })}>{value === "HOME" ? "LOCAL" : "VISITANTE"}</MultiButton>)}{(["WIN", "DRAW", "LOSS"] as const).map((value) => <MultiButton key={value} active={scope.results.includes(value)} onClick={() => patch({ results: toggle(scope.results, value) })}>{value === "WIN" ? "VICTORIA" : value === "DRAW" ? "EMPATE" : "DERROTA"}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">RIVALES · OR DENTRO DE LA DIMENSIÓN</span>{rivals.map((rival) => <MultiButton key={rival} active={scope.rivals.includes(rival)} onClick={() => patch({ rivals: toggle(scope.rivals, rival) })}>{rival}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">FASE</span>{PHASES.map(([value, label]) => <MultiButton key={value} active={scope.phases.includes(value)} onClick={() => patch({ phases: toggle(scope.phases, value) })}>{label}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">ORIGEN · RESULTADO</span>{ZONES.map((value) => <MultiButton key={value} active={scope.originZones.includes(value)} onClick={() => patch({ originZones: toggle(scope.originZones, value) })}>{value}</MultiButton>)}{(["GOL", "PARADA", "FUERA"] as ThreatOutcome[]).map((value) => <MultiButton key={value} active={scope.outcomes.includes(value)} onClick={() => patch({ outcomes: toggle(scope.outcomes, value) })}>{value}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">AGRUPACIONES OBJETIVAS</span><MultiButton active={scope.originDistance === "NEAR"} onClick={() => patch({ originDistance: scope.originDistance === "NEAR" ? "ALL" : "NEAR" })}>ZONA CERCANA</MultiButton><MultiButton active={scope.originDistance === "FAR"} onClick={() => patch({ originDistance: scope.originDistance === "FAR" ? "ALL" : "FAR" })}>ZONA LEJANA</MultiButton><MultiButton active={scope.outcomeGroup === "ON_TARGET"} onClick={() => patch({ outcomeGroup: scope.outcomeGroup === "ON_TARGET" ? "ALL" : "ON_TARGET", outcomes: [] })}>A PUERTA</MultiButton></div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">CONTEXTO TEMPORAL</span>{(["ALL", "KEY", "GOLD"] as const).map((value) => <MultiButton key={value} active={scope.competitiveContext === value} onClick={() => patch({ competitiveContext: value })}>{value === "ALL" ? "TODOS" : value === "KEY" ? "MINUTOS CLAVE" : "MINUTOS DE ORO"}</MultiButton>)}</div>
        <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">ESTADO P-J · INTERSECTA CON EL CONTEXTO TEMPORAL</span>{(["ALL", "PJ_CDA", "PJ_RIVAL"] as const).map((value) => <MultiButton key={value} active={scope.playingState === value} onClick={() => patch({ playingState: value })}>{value === "ALL" ? "TODOS" : value === "PJ_CDA" ? "PJ CDA" : "PJ RIVAL"}</MultiButton>)}</div>
        {(players.length > 0 || goalkeepers.length > 0) && <div className="flex flex-wrap gap-2"><span className="w-full text-[9px] font-black text-slate-500">JUGADOR / PORTERO · CUANDO LA MÉTRICA ES COMPATIBLE</span>{players.map((player) => <MultiButton key={player.playerId} active={scope.playerIds.includes(player.playerId)} onClick={() => patch({ playerIds: toggle(scope.playerIds, player.playerId) })}>{player.name}</MultiButton>)}{goalkeepers.map((keeper) => <MultiButton key={`gk-${keeper.playerId}`} active={scope.goalkeeperIds.includes(keeper.playerId)} onClick={() => patch({ goalkeeperIds: toggle(scope.goalkeeperIds, keeper.playerId) })}>🥅 {keeper.name}</MultiButton>)}</div>}
      </div>
    </details></>;
}

function ReferenceBuilder({ preset, scope, analysis, matches, rivals, onChange }: { preset: DashboardReferencePreset; scope: DashboardScopeV2; analysis: DashboardScopeV2; matches: SearchableMatch[]; rivals: string[]; onChange: (scope: DashboardScopeV2) => void }) {
  const patch = (changes: Partial<DashboardScopeV2>) => onChange({ ...scope, clubId: analysis.clubId, teamId: analysis.teamId, seasonId: analysis.seasonId, ...changes });
  if (preset === "MATCH") return <section data-reference-builder className="rounded-2xl border border-amber-900/70 bg-amber-950/20 p-3"><span className="mb-2 block text-[9px] font-black tracking-[.15em] text-amber-300">PARTIDO DE REFERENCIA</span><SearchableMatchCombobox matches={matches} value={scope.matchIds.length === 1 ? scope.matchIds[0] : ""} allLabel="Elige un partido" onChange={(matchId) => { const selected = matches.find((match) => match.matchId === matchId); patch({ matchIds: matchId ? [matchId] : [], competition: selected?.competitionType ?? analysis.competition, rivals: [], venues: [], results: [] }); }}/>{analysis.matchIds.length === 1 && scope.matchIds[0] === analysis.matchIds[0] && <p className="mt-2 text-[10px] text-amber-200">Estás comparando el mismo partido.</p>}</section>;
  return <details open data-reference-builder className="rounded-2xl border border-amber-900/70 bg-amber-950/20 p-3"><summary className="cursor-pointer text-[10px] font-black text-amber-200">REFERENCIA PERSONALIZADA · {scope.rivals.length === 1 ? `VS ${scope.rivals[0]}` : scope.rivals.length > 1 ? `${scope.rivals.length} RIVALES` : scope.competition}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <label className="text-[9px] font-black text-slate-400">COMPETICIÓN<select aria-label="Competición de referencia" value={scope.competition} onChange={(event) => patch({ competition: event.target.value as DashboardScopeV2["competition"], matchIds: [] })} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-xs text-white"><option value="LEAGUE">Liga</option><option value="CUP">Copa</option><option value="FRIENDLY">Amistoso</option><option value="OTHER">Otra</option><option value="ALL">Todas · explícito</option></select></label>
    <label className="text-[9px] font-black text-slate-400">SEDE<select aria-label="Sede de referencia" value={scope.venues[0] ?? "ALL"} onChange={(event) => patch({ venues: event.target.value === "ALL" ? [] : [event.target.value as "HOME" | "AWAY"] })} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-xs text-white"><option value="ALL">Todas</option><option value="HOME">Local</option><option value="AWAY">Visitante</option></select></label>
    <label className="text-[9px] font-black text-slate-400">RESULTADO<select aria-label="Resultado de referencia" value={scope.results[0] ?? "ALL"} onChange={(event) => patch({ results: event.target.value === "ALL" ? [] : [event.target.value as "WIN" | "DRAW" | "LOSS"] })} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-xs text-white"><option value="ALL">Todos</option><option value="WIN">Victorias</option><option value="DRAW">Empates</option><option value="LOSS">Derrotas</option></select></label>
    <label className="text-[9px] font-black text-slate-400">PERIODO<select aria-label="Periodo de referencia" value={scope.period} onChange={(event) => patch({ period: event.target.value === "ALL" ? "ALL" : Number(event.target.value) as 1 | 2 })} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-xs text-white"><option value="ALL">Todo</option><option value="1">P1</option><option value="2">P2</option></select></label>
    <label className="text-[9px] font-black text-slate-400">ESTADO P-J<select aria-label="Estado P-J de referencia" value={scope.playingState} onChange={(event) => patch({ playingState: event.target.value as DashboardScopeV2["playingState"] })} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-xs text-white"><option value="ALL">Todos</option><option value="PJ_CDA">PJ CDA</option><option value="PJ_RIVAL">PJ rival</option></select></label>
  </div><fieldset className="mt-3"><legend className="text-[9px] font-black text-slate-400">RIVALES</legend><div className="mt-1 flex max-h-28 flex-wrap gap-2 overflow-y-auto">{rivals.map((rival) => <MultiButton key={rival} active={scope.rivals.includes(rival)} onClick={() => patch({ rivals: toggle(scope.rivals, rival), matchIds: [] })}>{rival}</MultiButton>)}</div></fieldset><fieldset className="mt-3"><legend className="text-[9px] font-black text-slate-400">FASE · CUANDO APLICA</legend><div className="mt-1 flex flex-wrap gap-2">{PHASES.map(([phase, label]) => <MultiButton key={phase} active={scope.phases.includes(phase)} onClick={() => patch({ phases: toggle(scope.phases, phase) })}>{label}</MultiButton>)}</div></fieldset></details>;
}

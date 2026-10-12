"use client";
import { DashboardCombinations } from "./DashboardCombinations";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../app/AppHeader";
import { DashboardFilterBar } from "./DashboardFilterBar";
import { GoalZoneGrid, PitchZoneGrid } from "./AnalysisVisuals";
import { PlayerTableV2 } from "./PlayerTableV2";
import { GoalThreatMap, PitchThreatMap } from "./ThreatMaps";
import { ComparisonHeader, comparisonRightLabel } from "./ComparisonHeader";
import { EventTracePanel, TraceablePoint } from "./EventTracePanel";
import { dashboardMapPointTitle } from "../../lib/dashboardTrace";
import { withCurrentPlayerIdentity } from "../../lib/dashboardIdentity";
import { EvolutionChart } from "./EvolutionChart";
import { GoalkeeperAnalysisColumn } from "./GoalkeeperAnalysisColumn";
import { DashboardMatchRecord, DASHBOARD_PHASES } from "../../lib/dashboardAnalytics";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../lib/dashboardFixture";
import { listMatchCatalog, matchCatalogClubId, visibleMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { buildDashboardV2, buildPlayerScores, comparisonEnabledFromSearchParams, dashboardActiveFilterCount, DashboardArea, DashboardReferencePreset, DashboardScopeV2, DashboardValueMode, defaultDashboardCompetition, emptyDashboardScope, filterDashboardMatchSelection, hasDashboardScopeSearchParams, matchCompetition, mergeDashboardSearchParams, normalizeDashboardArea, normalizeDashboardCount, phaseImpactShare, referenceScopeForPreset, scopeFromSearchParams, teamMetricValue, teamThreatProfile } from "../../lib/dashboardV2";
import { replayMatch } from "../../lib/matchEngine";
import { useTeamStore } from "../../store/useTeamStore";
import { ThreatPhase } from "../../types";
import { dashboardVideoHref, dashboardVideoItems, DashboardVideoOverride } from "../../lib/dashboardVideoContext";
import { MatchMomentumPanel } from "./MatchMomentumPanel";
import { SetPieceFunnel } from "./SetPieceFunnel";
import { HabitualRange } from "./HabitualRange";
import { MetricScale } from "./MetricScale";
import { dashboardMetricDistribution, DashboardDistributionMetric } from "../../lib/dashboardDistribution";
import { describeDistribution, sharedMetricMaximum } from "../../lib/distributionStatistics";
import { aggregateGoalkeepers } from "../../lib/dashboardAnalysis";
import { phaseImpactDelta } from "../../lib/dashboardPhaseImpact";
import { deriveCompetitiveProjection } from "../../lib/dashboardCompetitiveContext";
import { periodDurations, periodOffsets } from "../../lib/matchMomentum";
import { isActiveMatchEvent } from "../../lib/matchEngine";
import { DashboardDataTables } from "./DashboardDataTables";

const AREAS: Array<[DashboardArea, string]> = [["SUMMARY", "RESUMEN"], ["DATA", "DATOS"], ["PLAYERS", "JUGADORES"], ["GOALKEEPERS", "PORTEROS"], ["COMBINATIONS", "COMBINACIONES"], ["MAPS", "MAPAS / ZONAS"]];
const PHASE_LABEL: Record<ThreatPhase, string> = { POSITIONAL: "POSICIONAL", TRANSITION: "TRANSICIÓN", SET_PIECE_CORNER: "CÓRNER", SET_PIECE_FREE_KICK: "FALTA", SET_PIECE_KICK_IN: "BANDA", FLYING_GOALKEEPER: "P-J", PENALTY: "PENALTI", DOUBLE_PENALTY: "DOBLE PENALTI", UNSPECIFIED: "SIN FASE" };
const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;
const toggle = <T extends string>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
type Analysis = ReturnType<typeof buildDashboardV2>;
type GoalkeeperEvolutionMetric = "minutes" | "threatsAgainst" | "threatsAgainst40" | "saves" | "savePercentage" | "goalsAgainst" | "shots" | "goals" | "assists" | "losses" | "fouls" | "cards";
const GOALKEEPER_EVOLUTION_OPTIONS: Array<[GoalkeeperEvolutionMetric, string]> = [["minutes", "MINUTOS"], ["threatsAgainst", "AMENAZAS"], ["threatsAgainst40", "AMENAZAS /40"], ["saves", "PARADAS"], ["savePercentage", "% PARADA"], ["goalsAgainst", "GOLES RECIBIDOS"], ["shots", "REMATES"], ["goals", "GOLES"], ["assists", "ASISTENCIAS"], ["losses", "PÉRDIDAS"], ["fouls", "FALTAS"], ["cards", "TARJETAS"]];

function goalkeeperMetricValue(analysis: Analysis, playerId: string, metric: GoalkeeperEvolutionMetric): number | null {
  const keeper = analysis.goalkeepers.find((item) => item.playerId === playerId);
  if (!keeper || keeper.minutes <= 0) return null;
  if (["minutes", "threatsAgainst", "threatsAgainst40", "saves", "savePercentage", "goalsAgainst"].includes(metric)) return keeper[metric as "minutes" | "threatsAgainst" | "threatsAgainst40" | "saves" | "savePercentage" | "goalsAgainst"];
  const player = analysis.players.find((item) => item.playerId === playerId);
  if (!player) return 0;
  return metric === "shots" ? player.ownThreats : metric === "goals" ? player.goals : metric === "assists" ? player.assists : metric === "losses" ? player.possessionLosses : metric === "fouls" ? player.foulsCommitted : player.yellowCards + player.redCards;
}

function GoalkeeperGroupedEvolution({ records, scope, keepers, metric, onMatch }: { records: DashboardMatchRecord[]; scope: DashboardScopeV2; keepers: Analysis["goalkeepers"]; metric: GoalkeeperEvolutionMetric; onMatch: (matchId: string) => void }) {
  const groups = records.map((record) => { const analysis = buildDashboardV2([record], { ...scope, matchIds: [record.catalog.matchId], goalkeeperIds: [] }); return { record, values: keepers.map((keeper) => ({ keeper, value: goalkeeperMetricValue(analysis, keeper.playerId, metric) })).filter((item): item is { keeper: typeof keepers[number]; value: number } => item.value !== null) }; }).filter((group) => group.values.length > 0);
  const maximum = Math.max(1, ...groups.flatMap((group) => group.values.map((item) => item.value)));
  return <section className="rounded-3xl border border-slate-700 bg-slate-900 p-3" aria-label="Evolución global de porteros"><p className="mb-3 text-[9px] font-black text-slate-500">BARRAS AGRUPADAS POR PARTIDO · SOLO PORTEROS CON MINUTOS</p><div className="overflow-x-auto"><div className="flex min-w-max items-end gap-4">{groups.map(({ record, values }) => <button type="button" key={record.catalog.matchId} onClick={() => onMatch(record.catalog.matchId)} className="w-32 shrink-0 text-left"><div className="flex h-36 items-end justify-center gap-1 rounded-xl bg-slate-950 p-2">{values.map(({ keeper, value }, index) => <span key={keeper.playerId} title={`${keeper.name}: ${format(value)}`} className={`w-7 rounded-t ${index % 3 === 0 ? "bg-cyan-400" : index % 3 === 1 ? "bg-amber-300" : "bg-violet-400"}`} style={{ height: `${Math.max(4, value / maximum * 100)}%` }}><b className="block -translate-y-4 text-center text-[8px] text-white">{format(value)}</b></span>)}</div><strong className="mt-2 block truncate text-[9px]">{record.catalog.opponent}</strong><span className="text-[8px] text-slate-500">{record.catalog.date}</span></button>)}</div></div>{groups.length === 0 && <p className="text-xs text-slate-500">Sin porteros con minutos en este scope.</p>}</section>;
}

function readLocalRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

function SectionTitle({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return <div className="mb-4">{eyebrow && <p className="text-[9px] font-black tracking-[.18em] text-cyan-300">{eyebrow}</p>}<h2 className="text-xl font-black sm:text-2xl">{children}</h2></div>;
}

function DashboardVideoLink({ records, scope, override, label = "VÍDEOS" }: { records: DashboardMatchRecord[]; scope: DashboardScopeV2; override?: DashboardVideoOverride; label?: string }) {
  const items = useMemo(() => dashboardVideoItems(records, scope, override), [records, scope, override]);
  const href = useMemo(() => dashboardVideoHref(scope, override), [scope, override]);
  if (!items.length) return null;
  return <Link target="_blank" rel="noreferrer" href={href} className="inline-flex min-h-9 items-center rounded-xl bg-violet-950 px-3 text-[10px] font-black text-violet-200">🎬 {label} · {items.length}</Link>;
}

type DashboardFamily = "context" | "attack" | "defense" | "setPiece" | "discipline";

const FAMILY_STYLE: Record<DashboardFamily, { icon: string; label: string; frame: string; accent: string; card: string }> = {
  context: { icon: "◫", label: "CONTEXTO / RESULTADO", frame: "border-indigo-800/80 bg-indigo-950/20", accent: "text-indigo-200", card: "border-l-indigo-400" },
  attack: { icon: "↗", label: "ATAQUE", frame: "border-cyan-800/80 bg-cyan-950/20", accent: "text-cyan-200", card: "border-l-cyan-400" },
  defense: { icon: "◆", label: "DEFENSA", frame: "border-violet-800/80 bg-violet-950/20", accent: "text-violet-200", card: "border-l-violet-400" },
  setPiece: { icon: "⌟", label: "BALÓN PARADO", frame: "border-amber-800/80 bg-amber-950/20", accent: "text-amber-200", card: "border-l-amber-400" },
  discipline: { icon: "▮", label: "DISCIPLINA", frame: "border-fuchsia-800/80 bg-fuchsia-950/20", accent: "text-fuchsia-200", card: "border-l-fuchsia-400" },
};

function FamilySection({ family, title, eyebrow, children }: { family: DashboardFamily; title?: string; eyebrow?: string; children: React.ReactNode }) {
  const style = FAMILY_STYLE[family];
  return <section data-dashboard-family={family} className={`rounded-3xl border p-3 sm:p-4 ${style.frame}`}>
    <div className="mb-4 flex items-center gap-3">
      <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-current/30 bg-slate-950/70 text-xl ${style.accent}`}>{style.icon}</span>
      <div>{eyebrow && <p className={`text-[9px] font-black tracking-[.16em] ${style.accent}`}>{eyebrow}</p>}<h2 className="text-lg font-black sm:text-xl">{title ?? style.label}</h2></div>
    </div>
    {children}
  </section>;
}

type TeamEvolutionMetric = "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "shotsOnTarget" | "shotsOnTargetPct" | "threatsOnTarget" | "threatsOnTargetPct" | "shotsNear" | "threatsNear" | "savePercentage" | "possessionLosses" | "keyMinutes" | "goldMinutes";
const TEAM_EVOLUTION: Array<[TeamEvolutionMetric, string]> = [["goalsFor", "GF"], ["goalsAgainst", "GC"], ["threatsFor", "REMATES"], ["threatsAgainst", "AMENAZAS"], ["shotsOnTarget", "REM. A PUERTA"], ["shotsOnTargetPct", "% REM. A PUERTA"], ["threatsOnTarget", "AMEN. A PUERTA"], ["threatsOnTargetPct", "% AMEN. A PUERTA"], ["shotsNear", "REM. CERCANOS"], ["threatsNear", "AMEN. CERCANAS"], ["savePercentage", "% PARADA"], ["possessionLosses", "PÉRDIDAS"], ["keyMinutes", "MIN. CLAVE"], ["goldMinutes", "MIN. ORO"]];

function trendValue(item: Analysis["trends"][number], metric: TeamEvolutionMetric): number | null {
  if (metric === "shotsOnTargetPct") return item.threatsFor ? item.shotsOnTarget / item.threatsFor * 100 : null;
  if (metric === "threatsOnTargetPct") return item.threatsAgainst ? item.threatsOnTarget / item.threatsAgainst * 100 : null;
  return item[metric];
}

function TeamEvolution({ analysis, reference, referenceLabel, scope, onScope }: { analysis: Analysis; reference?: Analysis; referenceLabel: string; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void }) {
  const [metric, setMetric] = useState<TeamEvolutionMetric>("threatsFor");
  const values = (reference?.trends ?? []).map((item) => trendValue(item, metric)).filter((value): value is number => value !== null);
  const referenceValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return <div><div className="mb-3 flex justify-end"><select aria-label="Métrica de evolución" value={metric} onChange={(event) => setMetric(event.target.value as TeamEvolutionMetric)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{TEAM_EVOLUTION.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><EvolutionChart points={analysis.trends.map((item) => ({ id: item.matchId, label: item.opponent, detail: `${item.date} · ${item.venue === "HOME" ? "Local" : "Visitante"} · ${item.goalsFor}-${item.goalsAgainst}`, value: trendValue(item, metric) }))} reference={referenceValue} referenceLabel={referenceLabel} selectedIds={scope.matchIds} onSelect={(point) => onScope({ ...scope, matchIds: scope.matchIds.length === 1 && scope.matchIds[0] === point.id ? [] : [point.id] })}/></div>;
}

export function DashboardV2Page({ canViewIndividualAnalytics = true }: { canViewIndividualAnalytics?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const registryReady = useTeamStore((state) => state.registryReady);
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const clubIds = useTeamStore((state) => state.clubIds);
  const setCurrentClub = useTeamStore((state) => state.setCurrentClub);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const fixture = searchParams.get("fixture") === "1";
  const [records, setRecords] = useState<DashboardMatchRecord[]>([]);
  const [scope, setScope] = useState<DashboardScopeV2>(() => emptyDashboardScope());
  const [referenceScope, setReferenceScope] = useState<DashboardScopeV2>(() => emptyDashboardScope());
  const [referencePreset, setReferencePreset] = useState<DashboardReferencePreset>("SEASON");
  const [mode, setMode] = useState<DashboardValueMode>("TOTALS");
  const [area, setArea] = useState<DashboardArea>("SUMMARY");
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<TraceablePoint | null>(null);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => {
    if (!registryReady || ready) return;
    if (!fixture) ensureTeam(currentClubId);
    const activeWorkspace = fixture ? undefined : useTeamStore.getState().teams[currentClubId];
    const teamId = activeWorkspace?.teams.find((team) => team.active && !team.archivedAt && !team.deletedAt)?.teamId ?? "";
    const seasonId = activeWorkspace?.seasons.find((season) => season.teamId === teamId && season.current && season.active && !season.archivedAt && !season.deletedAt)?.seasonId ?? activeWorkspace?.seasons.find((season) => season.teamId === teamId && season.active)?.seasonId ?? "";
    const fallback = emptyDashboardScope(fixture ? DASHBOARD_FIXTURE_CLUB_ID : currentClubId, fixture ? DASHBOARD_FIXTURE_TEAM_ID : teamId, fixture ? DASHBOARD_FIXTURE_SEASON_ID : seasonId);
    const params = new URLSearchParams(searchParams.toString());
    const loadedRecords = fixture ? buildDashboardFixture() : readLocalRecords();
    const parsedScope = scopeFromSearchParams(params, "a", fallback);
    if (!params.has("aCompetition")) parsedScope.competition = defaultDashboardCompetition(loadedRecords, parsedScope);
    setRecords(loadedRecords);
    setScope(parsedScope);
    const preset = (params.get("reference") as DashboardReferencePreset) ?? "SEASON";
    setReferencePreset(preset);
    setReferenceScope(hasDashboardScopeSearchParams(params, "r") ? scopeFromSearchParams(params, "r", referenceScopeForPreset(parsedScope, preset)) : referenceScopeForPreset(parsedScope, preset));
    setMode((params.get("mode") as DashboardValueMode) ?? "TOTALS");
    setArea(normalizeDashboardArea(params.get("area")));
    setComparisonEnabled(comparisonEnabledFromSearchParams(params));
    setReady(true);
  }, [currentClubId, ensureTeam, fixture, ready, registryReady, searchParams]);

  const teams = useMemo(() => workspace?.teams.filter((team) => team.active && !team.archivedAt && !team.deletedAt) ?? [], [workspace]);
  const seasons = useMemo(() => workspace?.seasons.filter((season) => season.active && !season.archivedAt && !season.deletedAt) ?? [], [workspace]);
  const resolvedRecords = useMemo(
    () => fixture ? records : withCurrentPlayerIdentity(records, workspace?.players ?? []),
    [fixture, records, workspace?.players],
  );
  const clubs = clubIds.map((clubId) => useTeamStore.getState().teams[clubId]?.club).filter((club): club is NonNullable<typeof club> => Boolean(club && club.active && !club.archivedAt && !club.deletedAt));
  useEffect(() => {
    if (!ready || fixture || scope.clubId === currentClubId) return;
    const teamId = teams[0]?.teamId ?? "";
    const seasonId = seasons.find((season) => season.teamId === teamId && season.current)?.seasonId ?? seasons.find((season) => season.teamId === teamId)?.seasonId ?? "";
    setScope((current) => ({ ...emptyDashboardScope(currentClubId, teamId, seasonId), period: current.period }));
    setRecords(readLocalRecords());
  }, [currentClubId, fixture, ready, scope.clubId, seasons, teams]);
  const matches = useMemo(() => visibleMatchCatalog(resolvedRecords.map((record) => record.catalog), scope.includeArchived).filter((match) => matchCatalogClubId(match) === scope.clubId && match.teamId === scope.teamId && match.seasonId === scope.seasonId).map((match) => { const record = resolvedRecords.find((item) => item.catalog.matchId === match.matchId); const score = record ? replayMatch(record.session.players, record.session.events).score : null; const competitionType = record ? matchCompetition(record) : undefined; return { ...match, matchday: record?.session.preparation?.matchday, competitionType, competitionLabel: competitionType ? ({ LEAGUE: "Liga", CUP: "Copa", FRIENDLY: "Amistoso", OTHER: "Otra", UNSPECIFIED: "Sin clasificar" } as const)[competitionType] : undefined, scoreLabel: score ? `${score.for}-${score.against}` : undefined }; }).sort((a, b) => b.date.localeCompare(a.date)), [resolvedRecords, scope.clubId, scope.includeArchived, scope.seasonId, scope.teamId]);
  const rivals = useMemo(() => Array.from(new Set(matches.map((match) => match.opponent))).sort(), [matches]);
  const analysis = useMemo(() => buildDashboardV2(resolvedRecords, scope), [resolvedRecords, scope]);
  const goalkeeperOverview = useMemo(() => buildDashboardV2(resolvedRecords, { ...scope, goalkeeperIds: [] }), [resolvedRecords, scope]);
  const reference = useMemo(() => buildDashboardV2(resolvedRecords, referenceScope), [resolvedRecords, referenceScope]);
  const naturalGoalkeepers = useMemo(() => new Set((workspace?.players ?? []).filter((player) => player.primaryPosition === "GOALKEEPER").map((player) => player.playerId)), [workspace?.players]);
  const fieldPlayers = useMemo(() => analysis.players.filter((player) => fixture ? player.position !== "PORTERO" : !naturalGoalkeepers.has(player.playerId)), [analysis.players, fixture, naturalGoalkeepers]);
  const scores = useMemo(() => buildPlayerScores(fieldPlayers), [fieldPlayers]);
  const videoCount = useMemo(() => dashboardVideoItems(resolvedRecords, scope).length, [resolvedRecords, scope]);
  const videoHref = useMemo(() => dashboardVideoHref(scope), [scope]);

  useEffect(() => {
    if (!ready || referencePreset === "CUSTOM" || referencePreset === "MATCH") return;
    setReferenceScope(referenceScopeForPreset(scope, referencePreset));
  }, [ready, referencePreset, scope]);
  function changeReferencePreset(preset: DashboardReferencePreset) {
    setReferencePreset(preset);
    if (preset === "MATCH" || (preset === "CUSTOM" && referencePreset !== "CUSTOM")) setReferenceScope(referenceScopeForPreset(scope, preset));
    else if (preset !== "CUSTOM") setReferenceScope(referenceScopeForPreset(scope, preset));
  }

  useEffect(() => {
    if (!ready) return;
    const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area, comparisonEnabled }, new URLSearchParams(searchParams.toString()));
    if (query !== searchParams.toString()) router.replace(`/dashboard?${query}`, { scroll: false });
  }, [area, comparisonEnabled, mode, ready, referencePreset, referenceScope, router, scope, searchParams]);

  const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area, comparisonEnabled }, new URLSearchParams(fixture ? "fixture=1" : ""));
  const selectedKeeperName = scope.goalkeeperIds.length === 1 ? goalkeeperOverview.goalkeepers.find((keeper) => keeper.playerId === scope.goalkeeperIds[0])?.name.toUpperCase() ?? "PORTERO" : "GLOBAL";

  return <div className="min-h-screen overflow-x-clip bg-slate-950 text-white"><div className="sticky top-0 z-40"><AppHeader title="Dashboard V2" clubId={fixture ? undefined : currentClubId} actions={<><Link href={`/dashboard/jugadas?${query}`} className="grid min-h-10 place-items-center rounded-lg bg-red-950 px-3 text-[10px] font-black text-red-300">▶ JUGADAS</Link>{videoCount > 0 && <Link target="_blank" rel="noreferrer" href={videoHref} className="grid min-h-10 place-items-center rounded-lg bg-violet-950 px-3 text-[10px] font-black text-violet-200">🎬 VER VÍDEOS ({videoCount})</Link>}</>} /></div><main className="mx-auto max-w-7xl space-y-6 p-3 pb-16 sm:p-5">
    <DashboardFilterBar clubName={workspace?.club.name ?? "Club"} clubs={clubs} onClub={setCurrentClub} scope={scope} referenceScope={referenceScope} teams={teams} seasons={seasons} matches={matches} rivals={rivals} players={fieldPlayers} goalkeepers={goalkeeperOverview.goalkeepers} referencePreset={referencePreset} mode={mode} onScope={setScope} onReferenceScope={setReferenceScope} onReferencePreset={changeReferencePreset} onMode={setMode} fixedPer40={area === "COMBINATIONS"} comparisonEnabled={area !== "COMBINATIONS" && comparisonEnabled} onComparisonEnabled={setComparisonEnabled} onRefresh={() => setRecords(fixture ? buildDashboardFixture() : readLocalRecords())} fixture={fixture} comparison={<ComparisonHeader left={area === "GOALKEEPERS" ? selectedKeeperName : "CDA"} right={area === "GOALKEEPERS" ? "PORTERÍA CDA" : comparisonRightLabel(referenceScope, referencePreset, matches.find((match) => match.matchId === referenceScope.matchIds[0])?.opponent)} scope={scope}/>} />
    <nav ref={navigationRef} aria-label="Secciones del Dashboard" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-2 shadow-xl">{AREAS.filter(([key]) => key !== "COMBINATIONS" || canViewIndividualAnalytics).map(([key, label]) => <button key={key} type="button" onClick={() => setArea(key)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${area === key ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>{label}</button>)}</nav>
    <StickyDashboardNav anchor={navigationRef} area={area} canViewIndividualAnalytics={canViewIndividualAnalytics} filterCount={dashboardActiveFilterCount(scope)} scope={scope} matches={matches} videoHref={videoHref} videoCount={videoCount} mode={mode} onMode={setMode} onArea={setArea} onScope={setScope}/>
    {!ready ? <p className="p-10 text-center text-slate-500">Preparando análisis…</p> : area === "COMBINATIONS" ? <DashboardCombinations rosterPlayers={fixture ? undefined : workspace?.players} records={resolvedRecords} scope={scope} canViewIndividualAnalytics={canViewIndividualAnalytics} /> : analysis.analytics.matches === 0 ? <Empty /> : <>{area === "SUMMARY" && <Summary analysis={analysis} reference={reference} mode={mode} comparisonEnabled={comparisonEnabled} scope={scope} onScope={setScope} referenceScope={referenceScope} allRecords={resolvedRecords} momentumRecords={resolvedRecords} momentumMatches={matches} />}{area === "DATA" && <DashboardDataTables analysis={analysis} referenceScope={referenceScope} allRecords={resolvedRecords} scope={scope} onScope={setScope} mode={mode}/>} {area === "PLAYERS" && <><div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle eyebrow="PORTEROS NATURALES EN SU ANÁLISIS ESPECÍFICO">JUGADORES</SectionTitle><DashboardVideoLink records={resolvedRecords} scope={scope} label="VÍDEOS DEL SCOPE"/></div><PlayerTableV2 analysis={analysis} players={fieldPlayers} scores={scores} mode={mode} detailQuery={query} /></>}{area === "GOALKEEPERS" && <Goalkeepers analysis={analysis} overview={goalkeeperOverview} query={query} onPoint={setSelectedPoint} scope={scope} onScope={setScope} mode={mode} allRecords={resolvedRecords} />}{area === "MAPS" && <Maps analysis={analysis} scope={scope} onScope={setScope} onPoint={setSelectedPoint} allRecords={resolvedRecords} />}</>}
  </main>{selectedPoint && <EventTracePanel records={analysis.records} point={selectedPoint} onClose={() => setSelectedPoint(null)} returnTo={`/dashboard?${query}#maps`}/>}</div>;
}

function StickyDashboardNav({ anchor, area, canViewIndividualAnalytics, filterCount, scope, matches, videoHref, videoCount, mode, onMode, onArea, onScope }: { anchor: React.RefObject<HTMLElement | null>; area: DashboardArea; canViewIndividualAnalytics: boolean; filterCount: number; scope: DashboardScopeV2; matches: Array<{ matchId: string; opponent: string }>; videoHref: string; videoCount: number; mode: DashboardValueMode; onMode: (mode: DashboardValueMode) => void; onArea: (area: DashboardArea) => void; onScope: (scope: DashboardScopeV2) => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 64), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [anchor]);
  const openFilters = () => {
    const y = window.scrollY;
    const details = document.getElementById("dashboard-advanced-filters") as HTMLDetailsElement | null;
    if (details) details.open = true;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  };
  if (!visible) return null;
  const competition = scope.competition === "ALL" ? "TODAS" : scope.competition === "LEAGUE" ? "LIGA" : scope.competition === "CUP" ? "COPA" : scope.competition === "FRIENDLY" ? "AMISTOSO" : scope.competition;
  const matchContext = scope.matchIds.length === 0 ? "TODOS" : scope.matchIds.length === 1 ? matches.find((match) => match.matchId === scope.matchIds[0])?.opponent ?? "1 PARTIDO" : `${scope.matchIds.length} PARTIDOS`;
  const badges: Array<{ key: string; label: string; clear: () => void }> = [];
  if (scope.period !== "ALL") badges.push({ key: "period", label: `P${scope.period}`, clear: () => onScope({ ...scope, period: "ALL" }) });
  scope.rivals.forEach((value) => badges.push({ key: `rival-${value}`, label: value, clear: () => onScope({ ...scope, rivals: scope.rivals.filter((item) => item !== value) }) }));
  scope.phases.forEach((value) => badges.push({ key: `phase-${value}`, label: PHASE_LABEL[value as ThreatPhase] ?? value, clear: () => onScope({ ...scope, phases: scope.phases.filter((item) => item !== value) }) }));
  scope.outcomes.forEach((value) => badges.push({ key: `outcome-${value}`, label: value, clear: () => onScope({ ...scope, outcomes: scope.outcomes.filter((item) => item !== value) }) }));
  scope.playerIds.forEach((value) => badges.push({ key: `player-${value}`, label: "JUGADOR", clear: () => onScope({ ...scope, playerIds: scope.playerIds.filter((item) => item !== value) }) }));
  scope.goalkeeperIds.forEach((value) => badges.push({ key: `goalkeeper-${value}`, label: "PORTERO", clear: () => onScope({ ...scope, goalkeeperIds: scope.goalkeeperIds.filter((item) => item !== value) }) }));
  scope.threatSides.forEach((value) => badges.push({ key: `side-${value}`, label: value === "FOR" ? "CDA" : "RIVAL", clear: () => onScope({ ...scope, threatSides: scope.threatSides.filter((item) => item !== value) }) }));
  if (scope.competitiveContext !== "ALL") badges.push({ key: "competitive", label: scope.competitiveContext === "KEY" ? "MIN. CLAVE" : "MIN. ORO", clear: () => onScope({ ...scope, competitiveContext: "ALL" }) });
  if (scope.playingState !== "ALL") badges.push({ key: "playing", label: scope.playingState.replace("_", " "), clear: () => onScope({ ...scope, playingState: "ALL" }) });
  if (scope.scoreState !== "ALL") badges.push({ key: "score", label: scope.scoreState, clear: () => onScope({ ...scope, scoreState: "ALL" }) });
  scope.originZones.forEach((value) => badges.push({ key: `origin-${value}`, label: `ORIGEN ${value}`, clear: () => onScope({ ...scope, originZones: scope.originZones.filter((item) => item !== value) }) }));
  scope.targetZones.forEach((value) => badges.push({ key: `target-${value}`, label: `DESTINO ${value}`, clear: () => onScope({ ...scope, targetZones: scope.targetZones.filter((item) => item !== value) }) }));
  scope.venues.forEach((value) => badges.push({ key: `venue-${value}`, label: value === "HOME" ? "LOCAL" : "VISITANTE", clear: () => onScope({ ...scope, venues: scope.venues.filter((item) => item !== value) }) }));
  scope.results.forEach((value) => badges.push({ key: `result-${value}`, label: value, clear: () => onScope({ ...scope, results: scope.results.filter((item) => item !== value) }) }));
  scope.keeperBodyParts.forEach((value) => badges.push({ key: `body-${value}`, label: `CUERPO ${value}`, clear: () => onScope({ ...scope, keeperBodyParts: scope.keeperBodyParts.filter((item) => item !== value) }) }));
  scope.saveOutcomes.forEach((value) => badges.push({ key: `save-${value}`, label: value, clear: () => onScope({ ...scope, saveOutcomes: scope.saveOutcomes.filter((item) => item !== value) }) }));
  if (scope.outcomeGroup !== "ALL") badges.push({ key: "outcomeGroup", label: "A PUERTA", clear: () => onScope({ ...scope, outcomeGroup: "ALL" }) });
  if (scope.originDistance !== "ALL") badges.push({ key: "distance", label: scope.originDistance === "NEAR" ? "CERCA" : "LEJOS", clear: () => onScope({ ...scope, originDistance: "ALL" }) });
  if (scope.setPieceTraceability !== "ALL_CLASSIFIED") badges.push({ key: "traceability", label: "ABP TRAZABLE", clear: () => onScope({ ...scope, setPieceTraceability: "ALL_CLASSIFIED" }) });
  return <div data-dashboard-compact-sticky className="fixed inset-x-0 top-20 z-30 mx-auto flex min-h-[52px] max-w-7xl items-stretch border-y border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur sm:top-16">
    <div className="flex min-w-0 shrink items-center gap-1 overflow-x-auto border-r border-slate-800 px-2 text-[9px] font-black text-slate-400"><span className="hidden shrink-0 lg:inline">{competition} · {matchContext}</span>{badges.slice(0, 2).map((badge) => <button type="button" title="Quitar filtro" onClick={badge.clear} key={badge.key} className="shrink-0 rounded-full bg-cyan-950 px-2 py-1 text-cyan-200">{badge.label} ×</button>)}{badges.length > 2 && <button type="button" onClick={openFilters} className="shrink-0 text-amber-200">+{badges.length - 2}</button>}</div>
    <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-1.5">{AREAS.filter(([key]) => key !== "COMBINATIONS" || canViewIndividualAnalytics).map(([key, label]) => <button key={key} type="button" onClick={() => onArea(key)} className={`shrink-0 rounded-lg px-3 text-[10px] font-black ${area === key ? "bg-cyan-300 text-slate-950" : "text-slate-300"}`}>{label}</button>)}</div>
    <div className="hidden shrink-0 items-center gap-1 border-l border-slate-700 px-1 md:flex">{(["TOTALS", "PER_MATCH", "PER_40"] as const).map((value) => <button type="button" key={value} onClick={() => onMode(value)} className={`rounded-lg px-2 py-2 text-[8px] font-black ${mode === value ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}>{value === "TOTALS" ? "TOTAL" : value === "PER_MATCH" ? "PJ" : "x40"}</button>)}</div>
    {videoCount > 0 && <Link target="_blank" rel="noreferrer" href={videoHref} className="grid shrink-0 place-items-center border-l border-slate-700 bg-violet-950 px-3 text-[10px] font-black text-violet-200">VÍDEOS · {videoCount}</Link>}
    <button type="button" onClick={openFilters} className={`shrink-0 border-l border-slate-700 px-3 text-[10px] font-black ${filterCount ? "bg-amber-950 text-amber-200" : "bg-slate-900 text-slate-300"}`}>FILTROS{filterCount ? ` · ${filterCount}` : ""}</button>
  </div>;
}

function Empty() {
  return <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong className="text-xl">Sin datos para esta intersección</strong><p className="mt-2 text-sm text-slate-500">Retira un filtro o usa el fixture poblado sin persistencia.</p><Link href="/dashboard?fixture=1" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950">ABRIR FIXTURE POBLADO</Link></section>;
}

function DuelRow({ label, own, rival, ownPct, rivalPct, ownReference, rivalReference, ownPctReference, rivalPctReference, records, habitualScope, mode, ownMetric, rivalMetric, comparisonEnabled }: { label: string; own: number | null; rival: number | null; ownPct?: number | null; rivalPct?: number | null; ownReference?: number | null; rivalReference?: number | null; ownPctReference?: number | null; rivalPctReference?: number | null; records: DashboardMatchRecord[]; habitualScope: DashboardScopeV2; mode: DashboardValueMode; ownMetric: DashboardDistributionMetric; rivalMetric: DashboardDistributionMetric; comparisonEnabled: boolean }) {
  const difference = own === null || rival === null ? null : own - rival;
  const ownDistribution = dashboardMetricDistribution(records, habitualScope, ownMetric, mode);
  const rivalDistribution = dashboardMetricDistribution(records, habitualScope, rivalMetric, mode);
  const ownScaleValue = ownPct === undefined ? own : ownPct;
  const rivalScaleValue = rivalPct === undefined ? rival : rivalPct;
  const ownScaleReference = ownPct === undefined ? ownReference : ownPctReference;
  const rivalScaleReference = rivalPct === undefined ? rivalReference : rivalPctReference;
  const maximum = sharedMetricMaximum(ownScaleValue, rivalScaleValue, ownScaleReference, rivalScaleReference, ownDistribution.stats.max, rivalDistribution.stats.max);
  const suffix = ownPct === undefined ? "" : "%";
  return <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] items-center gap-2 border-t border-slate-800 py-3 first:border-0">
    <div className="relative min-w-0"><div className="flex items-baseline justify-end gap-2"><span className="text-[10px] font-black text-cyan-300">{ownPct === undefined ? "" : format(ownPct, "%")}</span><strong className="text-2xl text-cyan-100">{format(own)}</strong></div><MetricScale value={ownScaleValue} reference={comparisonEnabled ? ownScaleReference : undefined} stats={ownDistribution.stats} maximum={maximum} side="left" suffix={suffix}/></div>
    <div className="text-center"><span className="block text-[9px] font-black tracking-wide text-slate-400">{label}</span><strong className="mt-0.5 block text-sm text-white">Dif. {difference !== null && difference > 0 ? "+" : ""}{format(difference)}</strong></div>
    <div className="relative min-w-0"><div className="flex items-baseline gap-2"><strong className="text-2xl text-rose-100">{format(rival)}</strong><span className="text-[10px] font-black text-rose-300">{rivalPct === undefined ? "" : format(rivalPct, "%")}</span></div><MetricScale value={rivalScaleValue} reference={comparisonEnabled ? rivalScaleReference : undefined} stats={rivalDistribution.stats} maximum={maximum} side="right" suffix={suffix}/></div>
  </div>;
}

function Summary({ analysis, reference, mode, comparisonEnabled, scope, onScope, referenceScope, allRecords, momentumRecords, momentumMatches }: { analysis: Analysis; reference: Analysis; mode: DashboardValueMode; comparisonEnabled: boolean; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; referenceScope: DashboardScopeV2; allRecords: DashboardMatchRecord[]; momentumRecords: DashboardMatchRecord[]; momentumMatches: Array<{ matchId: string; opponent: string; date: string }> }) {
  const events = analysis.records.flatMap((record) => record.session.events);
  const referenceEvents = reference.records.flatMap((record) => record.session.events);
  const own = teamThreatProfile(events, "FOR");
  const rival = teamThreatProfile(events, "AGAINST");
  const ownRef = teamThreatProfile(referenceEvents, "FOR");
  const rivalRef = teamThreatProfile(referenceEvents, "AGAINST");
  const normalized = (value: number) => normalizeDashboardCount(value, mode, analysis.samples, analysis.rates.observedMinutes);
  const normalizedRef = (value: number) => normalizeDashboardCount(value, mode, reference.samples, reference.rates.observedMinutes);
  const goalsFor = normalized(own.goals);
  const goalsAgainst = normalized(rival.goals);
  const goalDifference = goalsFor === null || goalsAgainst === null ? null : goalsFor - goalsAgainst;
  const pending = own.pendingReview + rival.pendingReview;
  const losses = teamMetricValue(analysis, "possessionLosses", mode);
  const key = buildDashboardV2(allRecords, { ...scope, competitiveContext: "KEY" });
  const gold = buildDashboardV2(allRecords, { ...scope, competitiveContext: "GOLD" });
  const situationRows = (kind: "LOSSES" | "KEY" | "GOLD" | "PJ_CDA" | "PJ_RIVAL") => filterDashboardMatchSelection(allRecords, scope).map((record) => {
    const competitiveContext = kind === "KEY" || kind === "GOLD" ? kind : scope.competitiveContext;
    const playingState = kind === "PJ_CDA" || kind === "PJ_RIVAL" ? kind : scope.playingState;
    const localScope = { ...scope, matchIds: [record.catalog.matchId], competitiveContext, playingState };
    const single = buildDashboardV2([record], localScope);
    const projection = deriveCompetitiveProjection(record.session, scope.period, competitiveContext, scope.goalkeeperIds, playingState, scope.scoreState);
    const offsets = periodOffsets(periodDurations(record.session));
    const intervals = projection.intervals.reduce<Array<{ period: number; start: number; end: number }>>((merged, interval) => {
      const start = interval.start - (offsets[interval.period - 1] ?? 0); const end = interval.end - (offsets[interval.period - 1] ?? 0);
      const previous = merged.at(-1);
      if (previous && previous.period === interval.period && Math.abs(previous.end - start) < .001) previous.end = end;
      else merged.push({ period: interval.period, start, end });
      return merged;
    }, []);
    const selectedEvents = record.session.events.filter((event) => isActiveMatchEvent(event) && (kind === "LOSSES" || projection.eventIds.has(event.id)));
    const threats = selectedEvents.filter((event) => event.type === "threat_recorded");
    return {
      id: record.catalog.matchId, opponent: record.catalog.opponent, date: record.catalog.date,
      matchday: record.session.preparation?.matchday,
      minutes: projection.observed,
      intervals,
      losses: teamMetricValue(single, "possessionLosses", "TOTALS") ?? 0,
      remates: threats.filter((event) => event.type === "threat_recorded" && event.side === "FOR").length,
      amenazas: threats.filter((event) => event.type === "threat_recorded" && event.side === "AGAINST").length,
      goles: threats.filter((event) => event.type === "threat_recorded" && event.outcome === "GOL").length,
    };
  });
  const contextCard = (label: string, value: Analysis, expanded?: React.ReactNode) => {
    const profileFor = teamThreatProfile(value.records.flatMap((record) => record.session.events), "FOR");
    const profileAgainst = teamThreatProfile(value.records.flatMap((record) => record.session.events), "AGAINST");
    const minutes = label.includes("ORO") ? value.teamGoldMinutes : value.teamKeyMinutes;
    return <SituationCard label={label} primary={format(minutes, " min")} detail={<><p>{value.samples} partidos · {value.samples ? format(minutes / value.samples, " min/partido") : "N/D"}</p><p>{profileAgainst.total} amenazas · {profileFor.total} remates · {profileFor.goals + profileAgainst.goals} goles</p></>} expanded={expanded}/>;
  };
  return <>
    <section data-dashboard-context-strip className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-indigo-800/70 bg-indigo-950/30 px-4 py-2 text-sm"><b>{analysis.samples} {analysis.samples === 1 ? "partido" : "partidos"}</b><span className="text-slate-500">·</span><b>{format(analysis.rates.observedMinutes, " min")}</b><span className="text-slate-500">·</span><b className="text-cyan-200">GF {format(goalsFor)}</b><span>—</span><b className="text-rose-200">{format(goalsAgainst)} GC</b><span className="text-slate-500">·</span><b>{goalDifference !== null && goalDifference > 0 ? "+" : ""}{format(goalDifference)}</b>{pending > 0 && <span className="text-amber-300">? {pending}</span>}</section>
    <section data-dashboard-duel className="rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4"><div className="grid grid-cols-[1fr_6.5rem_1fr] text-[10px] font-black tracking-[.12em]"><span className="text-right text-cyan-300">CDA · REM</span><span className="text-center text-slate-500">DIF.</span><span className="text-rose-300">AME · RIVAL</span></div>
      <DuelRow label="REM / AME" own={normalized(own.total)} rival={normalized(rival.total)} ownReference={normalizedRef(ownRef.total)} rivalReference={normalizedRef(rivalRef.total)} records={allRecords} habitualScope={referenceScope} mode={mode} ownMetric="threatsFor" rivalMetric="threatsAgainst" comparisonEnabled={comparisonEnabled}/>
      <DuelRow label="FUERA" own={normalized(own.outside)} rival={normalized(rival.outside)} ownPct={own.outsidePercentage} rivalPct={rival.outsidePercentage} ownPctReference={ownRef.outsidePercentage} rivalPctReference={rivalRef.outsidePercentage} records={allRecords} habitualScope={referenceScope} mode={mode} ownMetric="FOR.outsidePct" rivalMetric="AGAINST.outsidePct" comparisonEnabled={comparisonEnabled}/>
      <DuelRow label="A PUERTA" own={normalized(own.onTarget)} rival={normalized(rival.onTarget)} ownPct={own.onTargetPercentage} rivalPct={rival.onTargetPercentage} ownPctReference={ownRef.onTargetPercentage} rivalPctReference={rivalRef.onTargetPercentage} records={allRecords} habitualScope={referenceScope} mode={mode} ownMetric="FOR.onTargetPct" rivalMetric="AGAINST.onTargetPct" comparisonEnabled={comparisonEnabled}/>
      <DuelRow label="PARADAS" own={normalized(rival.saves)} rival={normalized(own.saves)} ownPct={rival.goalkeeperSavePercentage} rivalPct={own.goalkeeperSavePercentage} ownPctReference={rivalRef.goalkeeperSavePercentage} rivalPctReference={ownRef.goalkeeperSavePercentage} records={allRecords} habitualScope={referenceScope} mode={mode} ownMetric="AGAINST.savePct" rivalMetric="FOR.savePct" comparisonEnabled={comparisonEnabled}/>
      <DuelRow label="GOLES" own={goalsFor} rival={goalsAgainst} ownPct={own.conversionPercentage} rivalPct={rival.conversionPercentage} ownReference={normalizedRef(ownRef.goals)} rivalReference={normalizedRef(rivalRef.goals)} ownPctReference={ownRef.conversionPercentage} rivalPctReference={rivalRef.conversionPercentage} records={allRecords} habitualScope={referenceScope} mode={mode} ownMetric="FOR.conversionPct" rivalMetric="AGAINST.conversionPct" comparisonEnabled={comparisonEnabled}/>
    </section>
    <MatchMomentumPanel records={momentumRecords} matches={momentumMatches} selectedMatchIds={scope.matchIds}/>
    <FamilySection family="setPiece" title="RENDIMIENTO ABP" eyebrow="OPORTUNIDAD → REMATE → PUERTA → GOL"><SetPieceFunnel records={analysis.records} referenceRecords={reference.records}/></FamilySection>
    <PhaseImpact analysis={analysis} reference={reference} scope={scope} referenceScope={referenceScope} allRecords={allRecords} comparisonEnabled={comparisonEnabled}/>
    <FamilySection family="context" title="SITUACIONES" eyebrow="CONTEXTO PROPIO · TOCA PARA PROFUNDIZAR"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <SituationCard label="PÉRDIDAS" primary={format(losses)} detail={<><HabitualRange records={allRecords} scope={referenceScope} metric="possessionLosses" mode={mode} value={losses}/><p className="mt-2">Actual {format(losses)} · permanece disponible en Evolución.</p></>} expanded={<SituationBreakdown rows={situationRows("LOSSES")} kind="LOSSES"/>}/>
      {contextCard("MINUTOS CLAVE", key, <SituationBreakdown rows={situationRows("KEY")} kind="TIME"/>)}{contextCard("MINUTOS DE ORO", gold, <SituationBreakdown rows={situationRows("GOLD")} kind="TIME"/>)}
      <SituationCard label="PORTERO-JUGADOR" primary={`${format(analysis.flyingGoalkeeper.for.minutes)} / ${format(analysis.flyingGoalkeeper.against.minutes)} min`} detail={<><p>CDA: {analysis.flyingGoalkeeper.for.threatsFor} remates · {analysis.flyingGoalkeeper.for.threatsAgainst} amenazas · {analysis.flyingGoalkeeper.for.goalsFor + analysis.flyingGoalkeeper.for.goalsAgainst} goles</p><p>Rival: {analysis.flyingGoalkeeper.against.threatsFor} remates · {analysis.flyingGoalkeeper.against.threatsAgainst} amenazas · {analysis.flyingGoalkeeper.against.goalsFor + analysis.flyingGoalkeeper.against.goalsAgainst} goles</p></>} expanded={<><p className="font-black text-cyan-200">P-J CDA</p><SituationBreakdown rows={situationRows("PJ_CDA")} kind="TIME"/><p className="mt-2 font-black text-rose-200">P-J RIVAL</p><SituationBreakdown rows={situationRows("PJ_RIVAL")} kind="TIME"/></>}/>
    </div></FamilySection>
    <FamilySection family="context" title="EVOLUCIÓN" eyebrow="CONTEXTO TEMPORAL · TOCA PARA FILTRAR"><TeamEvolution analysis={analysis} reference={comparisonEnabled ? reference : undefined} referenceLabel="MEDIA" scope={scope} onScope={onScope}/></FamilySection>
  </>;
}

function SituationBreakdown({ rows, kind }: { rows: Array<{ id: string; opponent: string; date: string; matchday?: number; minutes: number; intervals: Array<{ period: number; start: number; end: number }>; losses: number; remates: number; amenazas: number; goles: number }>; kind: "LOSSES" | "TIME" }) {
  return <div className="space-y-2">{rows.map((row) => <article key={row.id} className="rounded-xl bg-slate-950 p-2"><b className="text-white">{row.matchday ? `J${row.matchday} · ` : ""}{row.opponent}</b><span className="ml-2 text-slate-500">{row.date}</span><p>{kind === "LOSSES" ? `${row.losses} pérdidas` : `${format(row.minutes, " min")} · ${row.remates} remates · ${row.amenazas} amenazas · ${row.goles} goles`}</p>{kind === "TIME" && <p className="text-slate-500">{row.intervals.length ? row.intervals.map((interval) => `P${interval.period} · min ${format(interval.start)}–${format(interval.end)}`).join(" · ") : "Sin intervalos en este partido"}</p>}</article>)}</div>;
}

function SituationCard({ label, primary, detail, expanded }: { label: string; primary: string; detail: React.ReactNode; expanded?: React.ReactNode }) {
  return <details className="group rounded-2xl border border-slate-700 bg-slate-900 p-3 open:border-indigo-500"><summary className="cursor-pointer list-none"><span className="text-[9px] font-black tracking-[.12em] text-indigo-200">{label}</span><strong className="mt-1 block text-2xl">{primary}</strong><div className="mt-2 text-[10px] leading-5 text-slate-300">{detail}</div><span className="mt-2 block text-[9px] font-black text-indigo-300 group-open:hidden">PARTIDO A PARTIDO +</span></summary><div className="mt-3 border-t border-slate-800 pt-3 text-[10px] leading-5 text-slate-400">{expanded ?? "Sin desglose adicional disponible."}</div></details>;
}

function PhaseImpact({ analysis, reference, scope, referenceScope, allRecords, comparisonEnabled }: { analysis: Analysis; reference: Analysis; scope: DashboardScopeV2; referenceScope: DashboardScopeV2; allRecords: DashboardMatchRecord[]; comparisonEnabled: boolean }) {
  const aggregate = (records: DashboardMatchRecord[], phases: ThreatPhase[], side: "FOR" | "AGAINST") => {
    const parts = phases.map((phase) => phaseImpactShare(records, phase, side));
    const phaseEvents = parts.reduce((sum, value) => sum + value.phaseEvents, 0);
    const phaseGoals = parts.reduce((sum, value) => sum + value.phaseGoals, 0);
    const totalEvents = parts[0]?.totalEvents ?? 0;
    const totalGoals = parts[0]?.totalGoals ?? 0;
    return { phaseEvents, phaseGoals, volumePercentage: totalEvents ? phaseEvents / totalEvents * 100 : null, goalPercentage: totalGoals ? phaseGoals / totalGoals * 100 : null };
  };
  const abp: ThreatPhase[] = ["SET_PIECE_CORNER", "SET_PIECE_FREE_KICK", "SET_PIECE_KICK_IN"];
  const definitions: Array<{ key: string; label: string; phases: ThreatPhase[] }> = [
    { key: "ABP", label: "ABP · CÓRNER + FALTA + BANDA", phases: abp },
    ...DASHBOARD_PHASES.filter((phase) => phase !== "UNSPECIFIED").map((phase) => ({ key: phase, label: PHASE_LABEL[phase], phases: [phase] })),
  ].filter((definition) => (["FOR", "AGAINST"] as const).some((side) => aggregate(analysis.records, definition.phases, side).phaseEvents > 0));
  const referenceMatches = filterDashboardMatchSelection(allRecords, referenceScope);
  return <FamilySection family="context" title="FASES · VOLUMEN → IMPACTO" eyebrow="CDA A LA IZQUIERDA · RIVAL A LA DERECHA · MISMA ESCALA"><div className="space-y-2">{definitions.map((definition) => {
    const current = (["FOR", "AGAINST"] as const).map((side) => aggregate(analysis.records, definition.phases, side));
    const compared = (["FOR", "AGAINST"] as const).map((side) => aggregate(reference.records, definition.phases, side));
    const perMatch = (["FOR", "AGAINST"] as const).map((side) => referenceMatches.map((record) => aggregate(buildDashboardV2([record], { ...referenceScope, matchIds: [record.catalog.matchId] }).records, definition.phases, side)));
    const distributions = perMatch.map((values) => describeDistribution(values.map((value) => value.volumePercentage)));
    const countDistributions = perMatch.map((values) => describeDistribution(values.map((value) => value.phaseEvents)));
    return <article key={definition.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">{current.map((value, index) => {
      const own = index === 0;
      const differential = phaseImpactDelta(value.volumePercentage, value.goalPercentage);
      const stats = distributions[index]; const counts = countDistributions[index];
      const content = <div className={own ? "text-right" : "text-left"}><strong className={`text-xl ${own ? "text-cyan-100" : "text-rose-100"}`}>{value.phaseEvents}</strong><p className="text-[9px] font-black text-slate-400">{format(value.volumePercentage, "%")} VOLUMEN · {format(value.goalPercentage, "%")} GOLES</p><p className={`text-[9px] font-black ${differential !== null && differential >= 0 ? own ? "text-emerald-300" : "text-rose-300" : "text-slate-400"}`}>{own ? "EFICIENCIA" : "VULNERABILIDAD"} {differential !== null && differential > 0 ? "+" : ""}{format(differential, " pp")}</p><MetricScale value={value.volumePercentage} reference={comparisonEnabled ? compared[index].volumePercentage : undefined} stats={stats} maximum={100} side={own ? "left" : "right"} tone={own ? "cyan" : "rose"} suffix="%"/><details className="mt-1 text-[8px] text-slate-400"><summary className="cursor-pointer font-black text-indigo-200">ACTUAL / HABITUAL</summary><p>Actual: {value.phaseEvents} acciones · {format(value.volumePercentage, "%")}</p><p>Media: {format(counts.mean)} acc. · {format(stats.mean, "%")} · Mediana {format(counts.median)} / {format(stats.median, "%")}</p><p>Rango: {format(counts.min)}–{format(counts.max)} acc. · {format(stats.min, "%")}–{format(stats.max, "%")} · N={stats.n}</p><p>Habitual = distribución partido a partido del scope de referencia; no mezcla cantidad con porcentaje.</p></details><DashboardVideoLink records={allRecords} scope={scope} override={definition.key === "ABP" ? { side: own ? "FOR" : "AGAINST", eventKinds: ["SET_PIECES"] } : { side: own ? "FOR" : "AGAINST", phases: definition.phases }} label={own ? "CDA" : "RIVAL"}/></div>;
      return index === 0 ? <div key="FOR">{content}</div> : <div key="AGAINST" className="col-start-3">{content}</div>;
    })}<div className="col-start-2 row-start-1 text-center"><h3 className="text-[9px] font-black tracking-[.1em] text-white">{definition.label}</h3><p className="mt-1 text-[8px] text-slate-500">REMATES / AMENAZAS</p></div></article>;
  })}</div></FamilySection>;
}

function Goalkeepers({ analysis, overview, query, onPoint, scope, onScope, mode, allRecords }: { analysis: Analysis; overview: Analysis; query: string; onPoint: (point: TraceablePoint) => void; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; mode: DashboardValueMode; allRecords: DashboardMatchRecord[] }) {
  const [view, setView] = useState<"GLOBAL" | "INDIVIDUAL" | "COMPARE">(scope.goalkeeperIds.length === 1 ? "INDIVIDUAL" : "GLOBAL");
  const [compareIds, setCompareIds] = useState<[string, string]>(() => [overview.goalkeepers[0]?.playerId ?? "", overview.goalkeepers[1]?.playerId ?? overview.goalkeepers[0]?.playerId ?? ""]);
  const [keeperSort, setKeeperSort] = useState<"minutes" | "matches" | "threatsAgainst" | "threatsAgainst40" | "saves" | "savePercentage" | "goalsAgainst">("minutes");
  const [keeperMetric, setKeeperMetric] = useState<GoalkeeperEvolutionMetric>("savePercentage");
  if (!overview.goalkeepers.length) return <section><SectionTitle>PORTEROS</SectionTitle><p className="rounded-3xl border border-dashed border-slate-700 p-8 text-slate-500">N/D · Sin portero funcional reconstruible.</p></section>;
  const selectedId = scope.goalkeeperIds.length === 1 ? scope.goalkeeperIds[0] : "GLOBAL";
  const deepKeeper = selectedId === "GLOBAL" ? aggregateGoalkeepers(analysis.goalkeepers) : analysis.goalkeepers.find((keeper) => keeper.playerId === selectedId);
  const keeperIds = new Set(selectedId === "GLOBAL" ? overview.goalkeepers.map((keeper) => keeper.playerId) : [selectedId]);
  const secondaryPlayers = overview.players.filter((player) => keeperIds.has(player.playerId));
  const secondary = { shots: secondaryPlayers.reduce((sum, player) => sum + player.ownThreats, 0), goals: secondaryPlayers.reduce((sum, player) => sum + player.goals, 0), assists: secondaryPlayers.reduce((sum, player) => sum + player.assists, 0), losses: secondaryPlayers.reduce((sum, player) => sum + player.possessionLosses, 0), fouls: secondaryPlayers.reduce((sum, player) => sum + player.foulsCommitted, 0), cards: secondaryPlayers.reduce((sum, player) => sum + player.yellowCards + player.redCards, 0) };
  const trend = overview.records.map((record) => {
    const single = buildDashboardV2([record], { ...emptyDashboardScope(record.catalog.clubId, record.catalog.teamId, record.catalog.seasonId), goalkeeperIds: selectedId === "GLOBAL" ? [] : [selectedId] });
    return { id: record.catalog.matchId, label: record.catalog.opponent, detail: `${record.catalog.date} · TOCA PARA FILTRAR`, value: selectedId === "GLOBAL" ? null : goalkeeperMetricValue(single, selectedId, keeperMetric) };
  });
  const compareKeepers = compareIds.map((id) => overview.goalkeepers.find((keeper) => keeper.playerId === id)).filter((keeper): keeper is NonNullable<typeof keeper> => Boolean(keeper));
  const keeperRows = overview.goalkeepers.map((keeper) => { const player = overview.players.find((candidate) => candidate.playerId === keeper.playerId); const matches = overview.records.filter((record) => buildDashboardV2([record], { ...scope, goalkeeperIds: [keeper.playerId] }).goalkeepers.some((item) => item.playerId === keeper.playerId && item.minutes > 0)).length; return { keeper, player, matches }; }).sort((a, b) => keeperSort === "matches" ? b.matches - a.matches : (Number(b.keeper[keeperSort] ?? -Infinity) - Number(a.keeper[keeperSort] ?? -Infinity)));
  return <section><div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle eyebrow="COMPARA ARRIBA · PROFUNDIZA ABAJO · P-J EXCLUIDO">PORTEROS</SectionTitle><DashboardVideoLink records={allRecords} scope={scope} label="PARADAS / AMENAZAS"/></div>
    <div data-goalkeeper-comparison className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900"><table className="min-w-[1050px] w-full text-[10px]"><thead><tr className="border-b border-slate-700">{[["name", "PORTERO"], ["minutes", "MINUTOS"], ["matches", "PARTIDOS"], ["threatsAgainst", "AMENAZAS"], ["threatsAgainst40", "AME/40"], ["saves", "PARADAS"], ["savePercentage", "% PARADA"], ["goalsAgainst", "GC"], ["shots", "REMATES"], ["goals", "GOLES"], ["assists", "ASIST."], ["losses", "PÉRDIDAS"], ["fouls", "FALTAS"], ["cards", "TARJETAS"]].map(([key, label]) => <th key={key} className="px-2 py-3 text-left">{["minutes", "matches", "threatsAgainst", "threatsAgainst40", "saves", "savePercentage", "goalsAgainst"].includes(key) ? <button type="button" onClick={() => setKeeperSort(key as typeof keeperSort)} className="font-black">{label}{keeperSort === key ? " ↓" : ""}</button> : label}</th>)}</tr></thead><tbody>{keeperRows.map(({ keeper, player, matches }) => <tr key={keeper.playerId} onClick={() => { setView("INDIVIDUAL"); onScope({ ...scope, goalkeeperIds: [keeper.playerId] }); }} className={`cursor-pointer border-b border-slate-800 hover:bg-slate-800 ${selectedId === keeper.playerId ? "bg-cyan-950/30" : ""}`}><th className="px-2 py-3 text-left text-cyan-200">#{keeper.number} · {keeper.name}</th><td>{format(keeper.minutes)}</td><td>{matches}</td><td>{keeper.threatsAgainst}</td><td>{format(keeper.threatsAgainst40)}</td><td>{keeper.saves}</td><td>{format(keeper.savePercentage, "%")}</td><td>{keeper.goalsAgainst}</td><td>{player?.ownThreats ?? 0}</td><td>{player?.goals ?? 0}</td><td>{player?.assists ?? 0}</td><td>{player?.possessionLosses ?? 0}</td><td>{player?.foulsCommitted ?? 0}</td><td>{(player?.yellowCards ?? 0) + (player?.redCards ?? 0)}</td></tr>)}</tbody></table></div>
    <div className="mt-3 flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2"><button type="button" onClick={() => { setView("GLOBAL"); onScope({ ...scope, goalkeeperIds: [] }); }} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${view === "GLOBAL" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>GLOBAL</button><button type="button" onClick={() => setView("INDIVIDUAL")} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${view === "INDIVIDUAL" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>INDIVIDUAL</button><button type="button" onClick={() => setView("COMPARE")} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${view === "COMPARE" ? "bg-amber-300 text-slate-950" : "text-slate-400"}`}>COMPARAR</button>{view === "INDIVIDUAL" && overview.goalkeepers.map((keeper) => <button type="button" key={keeper.playerId} onClick={() => onScope({ ...scope, goalkeeperIds: [keeper.playerId] })} className={`min-h-10 shrink-0 rounded-xl px-4 text-[10px] font-black ${selectedId === keeper.playerId ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>{keeper.name}</button>)}</div>
    {view !== "COMPARE" && <div className="mt-3 flex justify-end"><select aria-label="Métrica de evolución de porteros" value={keeperMetric} onChange={(event) => setKeeperMetric(event.target.value as GoalkeeperEvolutionMetric)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{GOALKEEPER_EVOLUTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}
    {view === "GLOBAL" && <div className="mt-3"><GoalkeeperGroupedEvolution records={analysis.records} scope={scope} keepers={overview.goalkeepers} metric={keeperMetric} onMatch={(matchId) => onScope({ ...scope, matchIds: scope.matchIds.length === 1 && scope.matchIds[0] === matchId ? [] : [matchId] })}/></div>}
    {view === "INDIVIDUAL" && selectedId !== "GLOBAL" && <div className="mt-2 flex justify-end"><label className="text-[9px] font-black text-slate-400">COMPARAR CON <select aria-label="Comparar portero individual con" defaultValue="" onChange={(event) => { if (!event.target.value) return; setCompareIds([selectedId, event.target.value]); setView("COMPARE"); }} className="ml-2 min-h-10 rounded-xl bg-slate-800 px-3 text-xs text-white"><option value="">Selecciona portero B</option>{overview.goalkeepers.filter((keeper) => keeper.playerId !== selectedId).map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>{keeper.name}</option>)}</select></label></div>}
    {view === "COMPARE" && <div className="mt-3 rounded-2xl border border-amber-900/60 bg-amber-950/10 p-3"><div className="grid gap-2 sm:grid-cols-2">{([0, 1] as const).map((index) => <select key={index} aria-label={`Portero ${index + 1} para comparar`} value={compareIds[index]} onChange={(event) => setCompareIds(index === 0 ? [event.target.value, compareIds[1]] : [compareIds[0], event.target.value])} className="min-h-11 rounded-xl bg-slate-900 px-3 text-xs font-black">{overview.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>{keeper.name}</option>)}</select>)}</div><div className="mt-3 grid gap-3 lg:grid-cols-2">{compareKeepers.map((keeper, index) => { const player = overview.players.find((candidate) => candidate.playerId === keeper.playerId); return <article key={keeper.playerId} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-3"><h3 className={`font-black ${index === 0 ? "text-cyan-200" : "text-amber-200"}`}>{index === 0 ? "A" : "B"} · {keeper.name}</h3><p className="text-sm">{format(keeper.minutes, " min")} · {keeper.threatsAgainst} amenazas · {keeper.saves} paradas · {keeper.goalsAgainst} GC · {format(keeper.savePercentage, "%")} parada</p><p className="text-[10px] text-slate-400">REM {player?.ownThreats ?? 0} · G {player?.goals ?? 0} · A {player?.assists ?? 0} · PÉR {player?.possessionLosses ?? 0}</p><div><p className="mb-1 text-[9px] font-black text-slate-500">DESTINOS · {keeper.name}</p><GoalThreatMap points={keeper.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/></div><div><p className="mb-1 text-[9px] font-black text-slate-500">ORÍGENES · {keeper.name}</p><PitchThreatMap points={keeper.originPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/></div><DashboardVideoLink records={allRecords} scope={scope} override={{ goalkeeperIds: [keeper.playerId] }} label={`VÍDEOS ${keeper.name}`}/></article>; })}</div></div>}
    {view !== "COMPARE" && deepKeeper && <div id="goalkeeper-maps" className="mt-3"><GoalkeeperAnalysisColumn keeper={deepKeeper} records={analysis.records} trend={trend} onPoint={onPoint} detailHref={selectedId === "GLOBAL" ? undefined : `/dashboard/portero/${encodeURIComponent(selectedId)}?${query}`} selectedBodyParts={scope.keeperBodyParts} selectedSaveOutcomes={scope.saveOutcomes} onBodyPart={(part) => onScope({ ...scope, keeperBodyParts: toggle(scope.keeperBodyParts, part) })} onSaveOutcome={(outcome) => onScope({ ...scope, saveOutcomes: toggle(scope.saveOutcomes, outcome) })} mode={mode} samples={analysis.samples} secondaryStats={secondary} onTrendSelect={(matchId) => onScope({ ...scope, matchIds: scope.matchIds.length === 1 && scope.matchIds[0] === matchId ? [] : [matchId] })}/></div>}
    <div className="mt-3 grid gap-3 lg:grid-cols-2"><PitchZoneGrid zones={analysis.pitchZones} selected={scope.originZones} onSelect={(zone) => onScope({ ...scope, originZones: toggle(scope.originZones, zone) })}/><GoalZoneGrid zones={analysis.goalZones} selected={scope.targetZones} onSelect={(zone) => onScope({ ...scope, targetZones: toggle(scope.targetZones, zone) })}/></div>
  </section>;
}

function Maps({ analysis, scope, onScope, onPoint, allRecords }: { analysis: Analysis; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; onPoint: (point: TraceablePoint) => void; allRecords: DashboardMatchRecord[] }) {
  return <section><div className="flex flex-wrap items-center justify-between gap-2"><SectionTitle eyebrow="PUNTOS EXACTOS · EVENTO TRAZABLE">MAPAS / ZONAS</SectionTitle><DashboardVideoLink records={allRecords} scope={scope} label="VÍDEOS DEL MAPA"/></div><div className="grid gap-3 lg:grid-cols-2"><PitchThreatMap points={analysis.analytics.pitchPoints} side="FOR" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchThreatMap points={analysis.analytics.pitchPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchZoneGrid zones={analysis.pitchZones} selected={scope.originZones} onSelect={(zone) => onScope({ ...scope, originZones: toggle(scope.originZones, zone) })}/><GoalThreatMap points={analysis.analytics.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><GoalZoneGrid zones={analysis.goalZones} selected={scope.targetZones} onSelect={(zone) => onScope({ ...scope, targetZones: toggle(scope.targetZones, zone) })}/></div></section>;
}

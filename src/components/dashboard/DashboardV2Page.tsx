"use client";
import { DashboardCombinations } from "./DashboardCombinations";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../app/AppHeader";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";
import { DashboardFilterBar } from "./DashboardFilterBar";
import { GoalZoneGrid, KeeperBodySummary, PitchZoneGrid, SaveOutcomeSummary } from "./AnalysisVisuals";
import { PlayerTableV2 } from "./PlayerTableV2";
import { GoalThreatMap, PitchThreatMap } from "./ThreatMaps";
import { ComparisonHeader, comparisonRightLabel } from "./ComparisonHeader";
import { EventTracePanel, TraceablePoint } from "./EventTracePanel";
import { dashboardMapPointTitle } from "../../lib/dashboardTrace";
import { withCurrentPlayerIdentity } from "../../lib/dashboardIdentity";
import { EvolutionChart } from "./EvolutionChart";
import { MetricHelp } from "./MetricHelp";
import { GoalkeeperAnalysisColumn } from "./GoalkeeperAnalysisColumn";
import { DashboardMatchRecord, DASHBOARD_PHASES } from "../../lib/dashboardAnalytics";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../lib/dashboardFixture";
import { listMatchCatalog, matchCatalogClubId, visibleMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { buildDashboardV2, buildPlayerScores, comparisonEnabledFromSearchParams, DashboardArea, DashboardReferencePreset, DashboardScopeV2, DashboardValueMode, defaultDashboardCompetition, emptyDashboardScope, hasDashboardScopeSearchParams, matchCompetition, mergeDashboardSearchParams, normalizeDashboardArea, normalizeDashboardCount, phaseImpactShare, referenceScopeForPreset, scopeFromSearchParams, teamMetricValue, teamThreatProfile } from "../../lib/dashboardV2";
import { replayMatch } from "../../lib/matchEngine";
import { useTeamStore } from "../../store/useTeamStore";
import { ThreatPhase } from "../../types";
import { buildVideoLibraryItems, EMPTY_VIDEO_LIBRARY_FILTERS } from "../../lib/videoLibrary";
import { MatchMomentumPanel } from "./MatchMomentumPanel";
import { SetPieceFunnel } from "./SetPieceFunnel";
import { HabitualRange } from "./HabitualRange";

const AREAS: Array<[DashboardArea, string]> = [["SUMMARY", "RESUMEN"], ["PLAYERS", "JUGADORES"], ["GOALKEEPERS", "PORTEROS"], ["COMBINATIONS", "COMBINACIONES"], ["MAPS", "MAPAS / ZONAS"]];
const PHASE_LABEL: Record<ThreatPhase, string> = { POSITIONAL: "POSICIONAL", TRANSITION: "TRANSICIÓN", SET_PIECE_CORNER: "CÓRNER", SET_PIECE_FREE_KICK: "FALTA", SET_PIECE_KICK_IN: "BANDA", FLYING_GOALKEEPER: "P-J", PENALTY: "PENALTI", DOUBLE_PENALTY: "DOBLE PENALTI", UNSPECIFIED: "SIN FASE" };
const format = (value: number | null, suffix = "") => value === null ? "N/D" : `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")}${suffix}`;
const toggle = <T extends string>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
type Analysis = ReturnType<typeof buildDashboardV2>;

function readLocalRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

function SectionTitle({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return <div className="mb-4">{eyebrow && <p className="text-[9px] font-black tracking-[.18em] text-cyan-300">{eyebrow}</p>}<h2 className="text-xl font-black sm:text-2xl">{children}</h2></div>;
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

function Kpi({ label, value, detail, tone = "text-white", help, family, detailProminent = false }: { label: string; value: string | number; detail?: string; tone?: string; help?: React.ComponentProps<typeof MetricHelp>["metricId"]; family?: DashboardFamily; detailProminent?: boolean }) {
  const familyStyle = family ? FAMILY_STYLE[family] : null;
  return <article className={`rounded-2xl border border-slate-700 bg-slate-900/90 p-3 ${familyStyle ? `border-l-4 ${familyStyle.card}` : ""}`}><div className="flex items-center justify-between gap-2"><p className={`text-[9px] font-black tracking-[.12em] ${familyStyle?.accent ?? "text-slate-500"}`}>{label}</p>{help && <MetricHelp metricId={help}/>}</div><strong className={`mt-1 block text-2xl sm:text-3xl ${tone}`}>{value}</strong>{detail && <span data-kpi-detail={detailProminent ? "prominent" : "secondary"} className={`mt-1 block ${detailProminent ? `text-base font-black sm:text-lg ${familyStyle?.accent ?? "text-cyan-200"}` : "text-[9px] text-slate-500"}`}>{detail}</span>}</article>;
}

type TeamEvolutionMetric = "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "shotsOnTarget" | "shotsOnTargetPct" | "threatsOnTarget" | "threatsOnTargetPct" | "shotsNear" | "threatsNear" | "savePercentage" | "possessionLosses" | "keyMinutes" | "goldMinutes";
const TEAM_EVOLUTION: Array<[TeamEvolutionMetric, string]> = [["goalsFor", "GF"], ["goalsAgainst", "GC"], ["threatsFor", "REMATES"], ["threatsAgainst", "AMENAZAS"], ["shotsOnTarget", "REM. A PUERTA"], ["shotsOnTargetPct", "% REM. A PUERTA"], ["threatsOnTarget", "AMEN. A PUERTA"], ["threatsOnTargetPct", "% AMEN. A PUERTA"], ["shotsNear", "REM. CERCANOS"], ["threatsNear", "AMEN. CERCANAS"], ["savePercentage", "% PARADA"], ["possessionLosses", "PÉRDIDAS"], ["keyMinutes", "MIN. CLAVE"], ["goldMinutes", "MIN. ORO"]];

function trendValue(item: Analysis["trends"][number], metric: TeamEvolutionMetric): number | null {
  if (metric === "shotsOnTargetPct") return item.threatsFor ? item.shotsOnTarget / item.threatsFor * 100 : null;
  if (metric === "threatsOnTargetPct") return item.threatsAgainst ? item.threatsOnTarget / item.threatsAgainst * 100 : null;
  return item[metric];
}

function TeamEvolution({ analysis, reference, referenceLabel }: { analysis: Analysis; reference?: Analysis; referenceLabel: string }) {
  const [metric, setMetric] = useState<TeamEvolutionMetric>("threatsFor");
  const values = (reference?.trends ?? []).map((item) => trendValue(item, metric)).filter((value): value is number => value !== null);
  const referenceValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return <div><div className="mb-3 flex justify-end"><select aria-label="Métrica de evolución" value={metric} onChange={(event) => setMetric(event.target.value as TeamEvolutionMetric)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{TEAM_EVOLUTION.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><EvolutionChart points={analysis.trends.map((item) => ({ id: item.matchId, label: item.opponent, detail: `${item.date} · ${item.venue === "HOME" ? "Local" : "Visitante"} · ${item.goalsFor}-${item.goalsAgainst}`, value: trendValue(item, metric) }))} reference={referenceValue} referenceLabel={referenceLabel}/></div>;
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
  const [keeperAId, setKeeperAId] = useState("");
  const [keeperBId, setKeeperBId] = useState("");
  const [selectedPoint, setSelectedPoint] = useState<TraceablePoint | null>(null);

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
  const reference = useMemo(() => buildDashboardV2(resolvedRecords, referenceScope), [resolvedRecords, referenceScope]);
  const naturalGoalkeepers = useMemo(() => new Set((workspace?.players ?? []).filter((player) => player.primaryPosition === "GOALKEEPER").map((player) => player.playerId)), [workspace?.players]);
  const fieldPlayers = useMemo(() => analysis.players.filter((player) => fixture ? player.position !== "PORTERO" : !naturalGoalkeepers.has(player.playerId)), [analysis.players, fixture, naturalGoalkeepers]);
  const scores = useMemo(() => buildPlayerScores(fieldPlayers), [fieldPlayers]);
  const videoCount = useMemo(() => buildVideoLibraryItems(resolvedRecords, { ...EMPTY_VIDEO_LIBRARY_FILTERS, source: "EVENT" }, { dashboardScope: scope, includeClips: false }).length, [resolvedRecords, scope]);

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
  const keeperA = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperAId) ?? analysis.goalkeepers[0];
  const keeperB = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperBId) ?? analysis.goalkeepers.find((keeper) => keeper.playerId !== keeperA?.playerId);

  return <div className="min-h-screen overflow-x-clip bg-slate-950 text-white"><div className="sticky top-0 z-40"><AppHeader title="Dashboard V2" clubId={fixture ? undefined : currentClubId} actions={<><Link href={`/dashboard/jugadas?${query}`} className="grid min-h-10 place-items-center rounded-lg bg-red-950 px-3 text-[10px] font-black text-red-300">▶ JUGADAS</Link>{videoCount > 0 && <Link href={`/video?from=dashboard&${query}`} className="grid min-h-10 place-items-center rounded-lg bg-violet-950 px-3 text-[10px] font-black text-violet-200">🎬 VER VÍDEOS ({videoCount})</Link>}</>} /></div><main className="mx-auto max-w-7xl space-y-6 p-3 pb-16 sm:p-5">
    <DashboardFilterBar clubName={workspace?.club.name ?? "Club"} clubs={clubs} onClub={setCurrentClub} scope={scope} referenceScope={referenceScope} teams={teams} seasons={seasons} matches={matches} rivals={rivals} players={fieldPlayers} goalkeepers={analysis.goalkeepers} referencePreset={referencePreset} mode={mode} onScope={setScope} onReferenceScope={setReferenceScope} onReferencePreset={changeReferencePreset} onMode={setMode} fixedPer40={area === "COMBINATIONS"} comparisonEnabled={area !== "COMBINATIONS" && comparisonEnabled} onComparisonEnabled={setComparisonEnabled} onRefresh={() => setRecords(fixture ? buildDashboardFixture() : readLocalRecords())} fixture={fixture} comparison={<ComparisonHeader left={area === "GOALKEEPERS" ? keeperA?.name.toUpperCase() ?? "PORTERO A" : "CDA"} right={area === "GOALKEEPERS" ? keeperB?.name.toUpperCase() ?? "PORTERO B" : comparisonRightLabel(referenceScope, referencePreset, matches.find((match) => match.matchId === referenceScope.matchIds[0])?.opponent)} scope={scope}/>} />
    <nav aria-label="Secciones del Dashboard" className="sticky top-36 z-20 flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/95 p-2 shadow-xl backdrop-blur">{AREAS.filter(([key]) => key !== "COMBINATIONS" || canViewIndividualAnalytics).map(([key, label]) => <button key={key} type="button" onClick={() => setArea(key)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${area === key ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>{label}</button>)}</nav>
    {!ready ? <p className="p-10 text-center text-slate-500">Preparando análisis…</p> : area === "COMBINATIONS" ? <DashboardCombinations rosterPlayers={fixture ? undefined : workspace?.players} records={resolvedRecords} scope={scope} canViewIndividualAnalytics={canViewIndividualAnalytics} /> : analysis.analytics.matches === 0 ? <Empty /> : <>{area === "SUMMARY" && <Summary analysis={analysis} reference={reference} mode={mode} comparisonEnabled={comparisonEnabled} scope={scope} referenceScope={referenceScope} allRecords={resolvedRecords} momentumRecords={resolvedRecords} momentumMatches={matches} />}{area === "PLAYERS" && <><SectionTitle eyebrow="PORTEROS NATURALES EN SU ANÁLISIS ESPECÍFICO">JUGADORES</SectionTitle><PlayerTableV2 analysis={analysis} players={fieldPlayers} scores={scores} mode={mode} detailQuery={query} /></>}{area === "GOALKEEPERS" && <Goalkeepers analysis={analysis} keeperA={keeperA} keeperB={keeperB} onA={setKeeperAId} onB={setKeeperBId} query={query} onPoint={setSelectedPoint} scope={scope} onScope={setScope} mode={mode} />}{area === "MAPS" && <Maps analysis={analysis} scope={scope} onScope={setScope} onPoint={setSelectedPoint} />}</>}
  </main>{selectedPoint && <EventTracePanel records={analysis.records} point={selectedPoint} onClose={() => setSelectedPoint(null)} returnTo={`/dashboard?${query}#maps`}/>}</div>;
}

function Empty() {
  return <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong className="text-xl">Sin datos para esta intersección</strong><p className="mt-2 text-sm text-slate-500">Retira un filtro o usa el fixture poblado sin persistencia.</p><Link href="/dashboard?fixture=1" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950">ABRIR FIXTURE POBLADO</Link></section>;
}

function DuelRow({ label, own, rival, ownPct, rivalPct, ownReference, rivalReference, ownHabitual, rivalHabitual, comparisonEnabled }: { label: string; own: number | null; rival: number | null; ownPct?: number | null; rivalPct?: number | null; ownReference?: number | null; rivalReference?: number | null; ownHabitual?: React.ReactNode; rivalHabitual?: React.ReactNode; comparisonEnabled: boolean }) {
  const difference = own === null || rival === null ? null : own - rival;
  return <div className="grid grid-cols-[1fr_7.5rem_1fr] items-center gap-2 border-t border-slate-800 py-3 first:border-0">
    <div className="relative min-w-0 text-right"><strong className="text-2xl text-cyan-100">{format(own)}</strong>{ownPct !== undefined && <span className="ml-2 text-xs font-black text-cyan-300">{format(ownPct, "%")}</span>}{comparisonEnabled && ownReference !== undefined && <small className="block text-[9px] text-amber-200">ref. {format(ownReference)}</small>}{ownHabitual && <div>{ownHabitual}</div>}</div>
    <div className="text-center"><span className="block text-[9px] font-black tracking-wide text-slate-400">{label}</span><strong className="mt-0.5 block text-sm text-white">{difference !== null && difference > 0 ? "+" : ""}{format(difference)}</strong></div>
    <div className="relative min-w-0"><strong className="text-2xl text-rose-100">{format(rival)}</strong>{rivalPct !== undefined && <span className="ml-2 text-xs font-black text-rose-300">{format(rivalPct, "%")}</span>}{comparisonEnabled && rivalReference !== undefined && <small className="block text-[9px] text-amber-200">ref. {format(rivalReference)}</small>}{rivalHabitual && <div>{rivalHabitual}</div>}</div>
  </div>;
}

function Summary({ analysis, reference, mode, comparisonEnabled, scope, referenceScope, allRecords, momentumRecords, momentumMatches }: { analysis: Analysis; reference: Analysis; mode: DashboardValueMode; comparisonEnabled: boolean; scope: DashboardScopeV2; referenceScope: DashboardScopeV2; allRecords: DashboardMatchRecord[]; momentumRecords: DashboardMatchRecord[]; momentumMatches: Array<{ matchId: string; opponent: string; date: string }> }) {
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
  const contextCard = (label: string, value: Analysis) => {
    const profileFor = teamThreatProfile(value.records.flatMap((record) => record.session.events), "FOR");
    const profileAgainst = teamThreatProfile(value.records.flatMap((record) => record.session.events), "AGAINST");
    return <article className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><span className="text-[9px] font-black tracking-[.12em] text-cyan-300">{label}</span><strong className="mt-1 block text-3xl">{format(label.includes("ORO") ? value.teamGoldMinutes : value.teamKeyMinutes, " min")}</strong><div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]"><span><b className="block text-base">{profileAgainst.total}</b>AME</span><span><b className="block text-base">{profileFor.total}</b>REM</span><span><b className="block text-base">{profileFor.goals + profileAgainst.goals}</b>GOLES</span></div></article>;
  };
  return <>
    <section data-dashboard-context-strip className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-indigo-800/70 bg-indigo-950/30 px-4 py-2 text-sm"><b>{analysis.samples} {analysis.samples === 1 ? "partido" : "partidos"}</b><span className="text-slate-500">·</span><b>{format(analysis.rates.observedMinutes, " min")}</b><span className="text-slate-500">·</span><b className="text-cyan-200">GF {format(goalsFor)}</b><span>—</span><b className="text-rose-200">{format(goalsAgainst)} GC</b><span className="text-slate-500">·</span><b>{goalDifference !== null && goalDifference > 0 ? "+" : ""}{format(goalDifference)}</b>{pending > 0 && <span className="text-amber-300">? {pending}</span>}</section>
    <section data-dashboard-duel className="rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4"><div className="grid grid-cols-[1fr_7.5rem_1fr] text-[10px] font-black tracking-[.16em]"><span className="text-right text-cyan-300">CDA · REMATES</span><span className="text-center text-slate-500">DIFERENCIA</span><span className="text-rose-300">AMENAZAS · RIVAL</span></div><DuelRow label="REMATES ↔ AMENAZAS" own={normalized(own.total)} rival={normalized(rival.total)} ownReference={normalizedRef(ownRef.total)} rivalReference={normalizedRef(rivalRef.total)} ownHabitual={<HabitualRange records={allRecords} scope={referenceScope} metric="threatsFor" mode={mode} value={normalized(own.total)}/>} rivalHabitual={<HabitualRange records={allRecords} scope={referenceScope} metric="threatsAgainst" mode={mode} value={normalized(rival.total)}/>} comparisonEnabled={comparisonEnabled}/><DuelRow label="FUERA" own={normalized(own.outside)} rival={normalized(rival.outside)} ownPct={own.outsidePercentage} rivalPct={rival.outsidePercentage} comparisonEnabled={comparisonEnabled}/><DuelRow label="A PUERTA" own={normalized(own.onTarget)} rival={normalized(rival.onTarget)} ownPct={own.onTargetPercentage} rivalPct={rival.onTargetPercentage} comparisonEnabled={comparisonEnabled}/><DuelRow label="PARADAS" own={normalized(rival.saves)} rival={normalized(own.saves)} ownPct={rival.goalkeeperSavePercentage} rivalPct={own.goalkeeperSavePercentage} comparisonEnabled={comparisonEnabled}/><DuelRow label="GOLES" own={goalsFor} rival={goalsAgainst} ownPct={own.conversionPercentage} rivalPct={rival.conversionPercentage} ownReference={normalizedRef(ownRef.goals)} rivalReference={normalizedRef(rivalRef.goals)} ownHabitual={<HabitualRange records={allRecords} scope={referenceScope} metric="goalsFor" mode={mode} value={goalsFor}/>} rivalHabitual={<HabitualRange records={allRecords} scope={referenceScope} metric="goalsAgainst" mode={mode} value={goalsAgainst}/>} comparisonEnabled={comparisonEnabled}/></section>
    <section data-dashboard-losses className="relative flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/70 bg-amber-950/20 p-4"><div><span className="text-[9px] font-black tracking-[.14em] text-amber-300">PÉRDIDAS CDA</span><strong className="block text-3xl">{format(losses)}</strong></div><HabitualRange records={allRecords} scope={referenceScope} metric="possessionLosses" mode={mode} value={losses}/></section>
    <MatchMomentumPanel records={momentumRecords} matches={momentumMatches} selectedMatchIds={scope.matchIds}/>
    <FamilySection family="setPiece" title="RENDIMIENTO ABP" eyebrow="OPORTUNIDAD → REMATE → PUERTA → GOL"><SetPieceFunnel records={analysis.records}/></FamilySection>
    <PhaseImpact analysis={analysis}/>
    <div className="grid gap-3 sm:grid-cols-2">{contextCard("MINUTOS CLAVE", key)}{contextCard("MINUTOS DE ORO", gold)}</div>
    <FamilySection family="context" title="PORTERO-JUGADOR" eyebrow="ESTADO SOSTENIDO · NO PORTERO FUNCIONAL"><div className="grid gap-3 sm:grid-cols-2"><PlayingStateCard title="PJ CDA" tone="cyan" stats={analysis.flyingGoalkeeper.for}/><PlayingStateCard title="PJ RIVAL" tone="rose" stats={analysis.flyingGoalkeeper.against}/></div></FamilySection>
    <FamilySection family="context" title="EVOLUCIÓN" eyebrow="CONTEXTO TEMPORAL"><TeamEvolution analysis={analysis} reference={comparisonEnabled ? reference : undefined} referenceLabel="MEDIA"/></FamilySection>
  </>;
}

function PhaseImpact({ analysis }: { analysis: Analysis }) {
  const phases = DASHBOARD_PHASES.filter((phase) => phase !== "UNSPECIFIED" && (["FOR", "AGAINST"] as const).some((side) => phaseImpactShare(analysis.records, phase, side).phaseEvents > 0));
  return <FamilySection family="context" title="FASES · VOLUMEN → IMPACTO" eyebrow="PESO EN REMATES/AMENAZAS FRENTE A PESO EN GOLES"><div className="space-y-2">{phases.map((phase) => {
    const values = (["FOR", "AGAINST"] as const).map((side) => phaseImpactShare(analysis.records, phase, side));
    return <div key={phase} className="grid grid-cols-[1fr_8rem_1fr] items-center rounded-xl bg-slate-950 p-3 text-sm"><span className="text-right"><b className="text-cyan-200">{format(values[0].volumePercentage, "%")} → {format(values[0].goalPercentage, "%")}</b><small className="block text-[9px] text-slate-500">{values[0].phaseEvents}/{values[0].totalEvents} · {values[0].phaseGoals}/{values[0].totalGoals}</small></span><strong className="text-center text-[9px]">{PHASE_LABEL[phase]}</strong><span><b className="text-rose-200">{format(values[1].volumePercentage, "%")} → {format(values[1].goalPercentage, "%")}</b><small className="block text-[9px] text-slate-500">{values[1].phaseEvents}/{values[1].totalEvents} · {values[1].phaseGoals}/{values[1].totalGoals}</small></span></div>;
  })}</div></FamilySection>;
}

function PlayingStateCard({ title, tone, stats }: { title: string; tone: "cyan" | "rose"; stats: Analysis["flyingGoalkeeper"]["for"] }) {
  const border = tone === "cyan" ? "border-cyan-900" : "border-rose-900";
  const text = tone === "cyan" ? "text-cyan-300" : "text-rose-300";
  return <article className={`rounded-3xl border ${border} bg-slate-900 p-4`}>
    <div className="flex items-end justify-between gap-3"><div><h3 className={`font-black ${text}`}>{title}</h3><strong className="mt-1 block text-4xl">{format(stats.minutes, " min")}</strong></div><span className="text-right text-[10px] text-slate-400">{stats.matchesWithState} partidos<br/>{format(stats.minutesPerMatchWithState, " min/uso")}</span></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4"><Kpi label="MIN/PARTIDO" value={format(stats.minutesPerMatch)}/><Kpi label="GF–GC" value={`${stats.goalsFor}–${stats.goalsAgainst}`}/><Kpi label="REM–AME" value={`${stats.threatsFor}–${stats.threatsAgainst}`}/><Kpi label="PUERTA" value={`${stats.onTargetFor}–${stats.onTargetAgainst}`}/></div>
  </article>;
}

function Goalkeepers({ analysis, keeperA, keeperB, onA, onB, query, onPoint, scope, onScope, mode }: { analysis: Analysis; keeperA?: Analysis["goalkeepers"][number]; keeperB?: Analysis["goalkeepers"][number]; onA: (id: string) => void; onB: (id: string) => void; query: string; onPoint: (point: TraceablePoint) => void; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; mode: DashboardValueMode }) {
  if (!keeperA) return <section><SectionTitle>PORTEROS</SectionTitle><p className="rounded-3xl border border-dashed border-slate-700 p-8 text-slate-500">N/D · Sin portero funcional reconstruible.</p></section>;
  const selected = keeperB && keeperB.playerId !== keeperA.playerId ? [keeperA, keeperB] : [keeperA];
  const trendFor = (playerId: string) => analysis.records.map((record) => {
    const single = buildDashboardV2([record], emptyDashboardScope(record.catalog.clubId, record.catalog.teamId, record.catalog.seasonId));
    const keeper = single.goalkeepers.find((candidate) => candidate.playerId === playerId);
    return { id: record.catalog.matchId, label: record.catalog.opponent, detail: record.catalog.date, value: keeper?.savePercentage ?? null };
  });
  return <section><SectionTitle eyebrow="P-J EXCLUIDO · VOLUMEN → IMPACTO">PORTEROS</SectionTitle><div className="grid grid-cols-2 gap-2"><select aria-label="Portero A" value={keeperA.playerId} onChange={(event) => onA(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>A · #{keeper.number} {keeper.name}</option>)}</select><select aria-label="Portero B" value={keeperB?.playerId ?? ""} onChange={(event) => onB(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>B · #{keeper.number} {keeper.name}</option>)}</select></div><div id="goalkeeper-maps" className="mt-3 grid gap-3 lg:grid-cols-2">{selected.map((keeper) => <GoalkeeperAnalysisColumn key={keeper.playerId} keeper={keeper} records={analysis.records} trend={trendFor(keeper.playerId)} onPoint={onPoint} detailHref={`/dashboard/portero/${encodeURIComponent(keeper.playerId)}?${query}`} selectedBodyParts={scope.keeperBodyParts} selectedSaveOutcomes={scope.saveOutcomes} onBodyPart={(part) => onScope({ ...scope, keeperBodyParts: toggle(scope.keeperBodyParts, part) })} onSaveOutcome={(outcome) => onScope({ ...scope, saveOutcomes: toggle(scope.saveOutcomes, outcome) })} mode={mode} samples={analysis.samples}/>)}</div><div className="mt-3 grid gap-3 lg:grid-cols-2"><PitchZoneGrid zones={analysis.pitchZones} selected={scope.originZones} onSelect={(zone) => onScope({ ...scope, originZones: toggle(scope.originZones, zone) })}/><GoalZoneGrid zones={analysis.goalZones} selected={scope.targetZones} onSelect={(zone) => onScope({ ...scope, targetZones: toggle(scope.targetZones, zone) })}/></div></section>;
}

function GoalkeepersLegacy({ analysis, keeperA, keeperB, onA, onB, query, onPoint }: { analysis: Analysis; keeperA?: Analysis["goalkeepers"][number]; keeperB?: Analysis["goalkeepers"][number]; onA: (id: string) => void; onB: (id: string) => void; query: string; onPoint: (point: TraceablePoint) => void }) {
  if (!keeperA) return <section><SectionTitle>PORTEROS</SectionTitle><p className="rounded-3xl border border-dashed border-slate-700 p-8 text-slate-500">N/D · Sin portero funcional reconstruible.</p></section>;
  return <section><SectionTitle eyebrow="P-J EXCLUIDO · MISMO SCOPE">PORTEROS</SectionTitle><div className="grid grid-cols-2 gap-2"><select aria-label="Portero A" value={keeperA.playerId} onChange={(event) => onA(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>A · #{keeper.number} {keeper.name}</option>)}</select><select aria-label="Portero B" value={keeperB?.playerId ?? ""} onChange={(event) => onB(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>B · #{keeper.number} {keeper.name}</option>)}</select></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{[keeperA, keeperB].filter((keeper, index, all) => keeper && all.findIndex((item) => item?.playerId === keeper.playerId) === index).map((keeper) => keeper && <KeeperCard key={keeper.playerId} keeper={keeper} query={query} />)}</div><div className="mt-3 grid gap-3 lg:grid-cols-2"><GoalThreatMap points={keeperA.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><KeeperBodySummary keeper={keeperA}/></div></section>;
}

function KeeperCard({ keeper, query }: { keeper: Analysis["goalkeepers"][number]; query: string }) {
  const savesWithOutcome = Object.values(keeper.saveOutcomes).reduce((sum, value) => sum + value, 0);
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex gap-4"><PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-36 w-28 shrink-0"/><div><span className="text-xs font-black text-cyan-300">#{keeper.number}</span><h3 className="text-xl font-black">{keeper.name}</h3><strong className="mt-2 block text-4xl">{format(keeper.savePercentage, "%")}</strong><span className="text-[9px] text-slate-500">{format(keeper.minutes, "'")} · {format(keeper.threatsAgainst40)} amenazas/40</span></div></div><div className="mt-3 grid grid-cols-3 gap-2"><Kpi label="AMENAZAS" value={keeper.threatsAgainst}/><Kpi label="PARADAS" value={keeper.saves}/><Kpi label="GOLES" value={keeper.goalsAgainst}/></div><div className="mt-3"><SaveOutcomeSummary keeper={keeper}/></div><p className="mt-2 text-[9px] text-slate-500">Desenlace documentado: {savesWithOutcome}/{keeper.saves} paradas.</p><Link href={`/dashboard/portero/${encodeURIComponent(keeper.playerId)}?${query}`} className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-cyan-800 px-4 text-[10px] font-black text-cyan-200">VER DETALLE</Link></article>;
}

void GoalkeepersLegacy;

function Maps({ analysis, scope, onScope, onPoint }: { analysis: Analysis; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; onPoint: (point: TraceablePoint) => void }) {
  return <section><SectionTitle eyebrow="PUNTOS EXACTOS · EVENTO TRAZABLE">MAPAS / ZONAS</SectionTitle><div className="grid gap-3 lg:grid-cols-2"><PitchThreatMap points={analysis.analytics.pitchPoints} side="FOR" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchThreatMap points={analysis.analytics.pitchPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchZoneGrid zones={analysis.pitchZones} selected={scope.originZones} onSelect={(zone) => onScope({ ...scope, originZones: toggle(scope.originZones, zone) })}/><GoalThreatMap points={analysis.analytics.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><GoalZoneGrid zones={analysis.goalZones} selected={scope.targetZones} onSelect={(zone) => onScope({ ...scope, targetZones: toggle(scope.targetZones, zone) })}/></div></section>;
}

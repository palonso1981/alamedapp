"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../app/AppHeader";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";
import { DashboardFilterBar } from "./DashboardFilterBar";
import { GoalZoneGrid, KeeperBodySummary, PitchZoneGrid, SaveOutcomeSummary } from "./AnalysisVisuals";
import { PlayerTableV2 } from "./PlayerTableV2";
import { FacedMetricRow, OutcomeDistribution, TeamComparison } from "./SportsComparison";
import { GoalThreatMap, PitchThreatMap } from "./ThreatMaps";
import { ComparisonHeader, comparisonRightLabel } from "./ComparisonHeader";
import { EventTracePanel, TraceablePoint } from "./EventTracePanel";
import { dashboardMapPointTitle } from "../../lib/dashboardTrace";
import { EvolutionChart } from "./EvolutionChart";
import { MetricHelp } from "./MetricHelp";
import { DashboardMatchRecord, DASHBOARD_PHASES } from "../../lib/dashboardAnalytics";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../lib/dashboardFixture";
import { listMatchCatalog, matchCatalogClubId, visibleMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { buildDashboardV2, buildPlayerScores, DashboardArea, DashboardReferencePreset, DashboardScopeV2, DashboardValueMode, derivedThreatSummary, emptyDashboardScope, mergeDashboardSearchParams, referenceScopeForPreset, scopeFromSearchParams, teamMetricValue } from "../../lib/dashboardV2";
import { useTeamStore } from "../../store/useTeamStore";
import { ThreatPhase } from "../../types";

const AREAS: Array<[DashboardArea, string]> = [["SUMMARY", "RESUMEN"], ["TEAM", "EQUIPO"], ["PLAYERS", "JUGADORES"], ["GOALKEEPERS", "PORTEROS"], ["MAPS", "MAPAS / ZONAS"]];
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

function Kpi({ label, value, detail, tone = "text-white", help }: { label: string; value: string | number; detail?: string; tone?: string; help?: React.ComponentProps<typeof MetricHelp>["metricId"] }) {
  return <article className="rounded-2xl border border-slate-700 bg-slate-900 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black tracking-[.12em] text-slate-500">{label}</p>{help && <MetricHelp metricId={help}/>}</div><strong className={`mt-1 block text-2xl sm:text-3xl ${tone}`}>{value}</strong>{detail && <span className="mt-1 block text-[9px] text-slate-500">{detail}</span>}</article>;
}

type TeamEvolutionMetric = "goalsFor" | "goalsAgainst" | "threatsFor" | "threatsAgainst" | "shotsOnTarget" | "shotsOnTargetPct" | "threatsOnTarget" | "threatsOnTargetPct" | "shotsNear" | "threatsNear" | "savePercentage";
const TEAM_EVOLUTION: Array<[TeamEvolutionMetric, string]> = [["goalsFor", "GF"], ["goalsAgainst", "GC"], ["threatsFor", "REMATES"], ["threatsAgainst", "AMENAZAS"], ["shotsOnTarget", "REM. A PUERTA"], ["shotsOnTargetPct", "% REM. A PUERTA"], ["threatsOnTarget", "AMEN. A PUERTA"], ["threatsOnTargetPct", "% AMEN. A PUERTA"], ["shotsNear", "REM. CERCANOS"], ["threatsNear", "AMEN. CERCANAS"], ["savePercentage", "% PARADA"]];

function trendValue(item: Analysis["trends"][number], metric: TeamEvolutionMetric): number | null {
  if (metric === "shotsOnTargetPct") return item.threatsFor ? item.shotsOnTarget / item.threatsFor * 100 : null;
  if (metric === "threatsOnTargetPct") return item.threatsAgainst ? item.threatsOnTarget / item.threatsAgainst * 100 : null;
  return item[metric];
}

function TeamEvolution({ analysis, reference, referenceLabel }: { analysis: Analysis; reference: Analysis; referenceLabel: string }) {
  const [metric, setMetric] = useState<TeamEvolutionMetric>("threatsFor");
  const values = reference.trends.map((item) => trendValue(item, metric)).filter((value): value is number => value !== null);
  const referenceValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return <section><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><SectionTitle>EVOLUCIÓN</SectionTitle><select aria-label="Métrica de evolución" value={metric} onChange={(event) => setMetric(event.target.value as TeamEvolutionMetric)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{TEAM_EVOLUTION.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><EvolutionChart points={analysis.trends.map((item) => ({ id: item.matchId, label: item.opponent, detail: `${item.date} · ${item.venue === "HOME" ? "Local" : "Visitante"} · ${item.goalsFor}-${item.goalsAgainst}`, value: trendValue(item, metric) }))} reference={referenceValue} referenceLabel={referenceLabel}/></section>;
}

export function DashboardV2Page() {
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
  const [referencePreset, setReferencePreset] = useState<DashboardReferencePreset>("SEASON");
  const [mode, setMode] = useState<DashboardValueMode>("TOTALS");
  const [area, setArea] = useState<DashboardArea>("SUMMARY");
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
    setRecords(fixture ? buildDashboardFixture() : readLocalRecords());
    setScope(scopeFromSearchParams(params, "a", fallback));
    setReferencePreset((params.get("reference") as DashboardReferencePreset) ?? "SEASON");
    setMode((params.get("mode") as DashboardValueMode) ?? "TOTALS");
    setArea((params.get("area") as DashboardArea) ?? "SUMMARY");
    setReady(true);
  }, [currentClubId, ensureTeam, fixture, ready, registryReady, searchParams]);

  const teams = useMemo(() => workspace?.teams.filter((team) => team.active && !team.archivedAt && !team.deletedAt) ?? [], [workspace]);
  const seasons = useMemo(() => workspace?.seasons.filter((season) => season.active && !season.archivedAt && !season.deletedAt) ?? [], [workspace]);
  const clubs = clubIds.map((clubId) => useTeamStore.getState().teams[clubId]?.club).filter((club): club is NonNullable<typeof club> => Boolean(club && club.active && !club.archivedAt && !club.deletedAt));
  useEffect(() => {
    if (!ready || fixture || scope.clubId === currentClubId) return;
    const teamId = teams[0]?.teamId ?? "";
    const seasonId = seasons.find((season) => season.teamId === teamId && season.current)?.seasonId ?? seasons.find((season) => season.teamId === teamId)?.seasonId ?? "";
    setScope((current) => ({ ...emptyDashboardScope(currentClubId, teamId, seasonId), period: current.period }));
    setRecords(readLocalRecords());
  }, [currentClubId, fixture, ready, scope.clubId, seasons, teams]);
  const matches = useMemo(() => visibleMatchCatalog(records.map((record) => record.catalog), scope.includeArchived).filter((match) => matchCatalogClubId(match) === scope.clubId && match.teamId === scope.teamId && match.seasonId === scope.seasonId), [records, scope.clubId, scope.includeArchived, scope.seasonId, scope.teamId]);
  const rivals = useMemo(() => Array.from(new Set(matches.map((match) => match.opponent))).sort(), [matches]);
  const referenceScope = useMemo(() => referenceScopeForPreset(scope, referencePreset), [referencePreset, scope]);
  const analysis = useMemo(() => buildDashboardV2(records, scope), [records, scope]);
  const reference = useMemo(() => buildDashboardV2(records, referenceScope), [records, referenceScope]);
  const scores = useMemo(() => buildPlayerScores(analysis.players), [analysis.players]);

  useEffect(() => {
    if (!ready) return;
    const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area }, new URLSearchParams(searchParams.toString()));
    if (query !== searchParams.toString()) router.replace(`/dashboard?${query}`, { scroll: false });
  }, [area, mode, ready, referencePreset, referenceScope, router, scope, searchParams]);

  const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area }, new URLSearchParams(fixture ? "fixture=1" : ""));
  const keeperA = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperAId) ?? analysis.goalkeepers[0];
  const keeperB = analysis.goalkeepers.find((keeper) => keeper.playerId === keeperBId) ?? analysis.goalkeepers.find((keeper) => keeper.playerId !== keeperA?.playerId);

  return <div className="min-h-screen overflow-x-hidden bg-slate-950 text-white"><AppHeader title="Dashboard V2" clubId={fixture ? undefined : currentClubId} /><main className="mx-auto max-w-7xl space-y-6 p-3 pb-16 sm:p-5">
    <DashboardFilterBar clubName={workspace?.club.name ?? "Club"} clubs={clubs} onClub={setCurrentClub} scope={scope} teams={teams} seasons={seasons} matches={matches} rivals={rivals} players={analysis.players} goalkeepers={analysis.goalkeepers} referencePreset={referencePreset} mode={mode} onScope={setScope} onReferencePreset={setReferencePreset} onMode={setMode} onRefresh={() => setRecords(fixture ? buildDashboardFixture() : readLocalRecords())} fixture={fixture} />
    <nav aria-label="Secciones del Dashboard" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2">{AREAS.map(([key, label]) => <button key={key} type="button" onClick={() => setArea(key)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black ${area === key ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>{label}</button>)}</nav>
    <ComparisonHeader left={area === "GOALKEEPERS" ? keeperA?.name.toUpperCase() ?? "PORTERO A" : "CDA"} right={area === "GOALKEEPERS" ? keeperB?.name.toUpperCase() ?? "PORTERO B" : comparisonRightLabel(scope, referencePreset)} scope={scope}/>
    {!ready ? <p className="p-10 text-center text-slate-500">Preparando análisis…</p> : analysis.analytics.matches === 0 ? <Empty /> : <>{area === "SUMMARY" && <Summary analysis={analysis} reference={reference} mode={mode} query={query} />}{area === "TEAM" && <TeamArea analysis={analysis} reference={reference} mode={mode} scope={scope} onScope={setScope} referenceLabel={comparisonRightLabel(scope, referencePreset)} />}{area === "PLAYERS" && <><SectionTitle eyebrow="CABECERAS CUANTITATIVAS ORDENABLES">JUGADORES</SectionTitle><PlayerTableV2 players={analysis.players} scores={scores} mode={mode} detailQuery={query} /></>}{area === "GOALKEEPERS" && <Goalkeepers analysis={analysis} keeperA={keeperA} keeperB={keeperB} onA={setKeeperAId} onB={setKeeperBId} query={query} />}{area === "MAPS" && <Maps analysis={analysis} scope={scope} onScope={setScope} onPoint={setSelectedPoint} />}</>}
  </main>{selectedPoint && <EventTracePanel records={analysis.records} point={selectedPoint} onClose={() => setSelectedPoint(null)}/>}</div>;
}

function Empty() {
  return <section className="rounded-3xl border border-dashed border-slate-700 p-10 text-center"><strong className="text-xl">Sin datos para esta intersección</strong><p className="mt-2 text-sm text-slate-500">Retira un filtro o usa el fixture poblado sin persistencia.</p><Link href="/dashboard?fixture=1" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950">ABRIR FIXTURE POBLADO</Link></section>;
}

function Summary({ analysis, reference, mode, query }: { analysis: Analysis; reference: Analysis; mode: DashboardValueMode; query: string }) {
  const saves = analysis.analytics.goalkeepers.reduce((sum, keeper) => sum + keeper.saves, 0);
  const interiors = analysis.analytics.goalkeepers.reduce((sum, keeper) => sum + keeper.saves + keeper.goalsAgainst, 0);
  const pending = analysis.analytics.quality.reduce((sum, item) => sum + item.pendingReview, 0);
  const players = [...analysis.players].sort((a, b) => b.goals + b.assists - a.goals - a.assists || b.minutes - a.minutes).slice(0, 4);
  const events = analysis.records.flatMap((record) => record.session.events);
  const ownDerived = derivedThreatSummary(events, "FOR");
  const againstDerived = derivedThreatSummary(events, "AGAINST");
  return <>
    <section><SectionTitle eyebrow={`${analysis.samples} PARTIDOS · ${analysis.rates.observedMinutes}' OBSERVADOS`}>MARCADOR</SectionTitle><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"><Kpi label="RESULTADO GF–GC" value={`${analysis.analytics.goalsFor}–${analysis.analytics.goalsAgainst}`} tone="text-cyan-200" /><Kpi label="REMATES" value={format(teamMetricValue(analysis, "threatsFor", mode))} /><Kpi label="AMENAZAS" value={format(teamMetricValue(analysis, "threatsAgainst", mode))} /><Kpi label="% GOL REMATES" value={format(analysis.analytics.threats.FOR.total ? analysis.analytics.threats.FOR.GOL / analysis.analytics.threats.FOR.total * 100 : null, "%")} /><Kpi label="% GOL AMENAZAS" value={format(analysis.analytics.threats.AGAINST.total ? analysis.analytics.threats.AGAINST.GOL / analysis.analytics.threats.AGAINST.total * 100 : null, "%")} /><Kpi label="% PARADA PROPIA" value={format(interiors ? saves / interiors * 100 : null, "%")} help="SAVE_PERCENTAGE"/><Kpi label="FALTAS CDA / RIV" value={`${analysis.analytics.discipline.for.fouls} / ${analysis.analytics.discipline.against.fouls}`} /></div><div className="mt-2 flex gap-2 overflow-x-auto text-[10px]"><span className="shrink-0 rounded-full bg-slate-900 px-3 py-2">Córners · {analysis.analytics.phases.SET_PIECE_CORNER.FOR}/{analysis.analytics.phases.SET_PIECE_CORNER.AGAINST}</span><span className="shrink-0 rounded-full bg-slate-900 px-3 py-2">Bandas cercanas · {analysis.analytics.phases.SET_PIECE_KICK_IN.FOR}/{analysis.analytics.phases.SET_PIECE_KICK_IN.AGAINST}</span>{pending > 0 && <span className="shrink-0 rounded-full bg-amber-950 px-3 py-2 font-bold text-amber-300">? {pending} pendientes · siguen computando</span>}</div></section>
    <section><SectionTitle>REMATES Y AMENAZAS</SectionTitle><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="REMATES A PUERTA" value={ownDerived.onTarget} detail={format(ownDerived.onTargetPercentage, "%")} help="ON_TARGET"/><Kpi label="AMENAZAS A PUERTA" value={againstDerived.onTarget} detail={format(againstDerived.onTargetPercentage, "%")} help="ON_TARGET"/><Kpi label="REMATES CERCANOS" value={ownDerived.near} detail={format(ownDerived.nearPercentage, "%")} help="NEAR_ZONE"/><Kpi label="AMENAZAS CERCANAS" value={againstDerived.near} detail={format(againstDerived.nearPercentage, "%")} help="NEAR_ZONE"/></div></section>
    <section><SectionTitle eyebrow="ACTUAL SÓLIDO · REFERENCIA DISCONTINUA">COMPARACIÓN</SectionTitle><TeamComparison analysis={analysis} reference={reference} mode={mode} /></section>
    <section className="grid gap-3 lg:grid-cols-2"><OutcomeDistribution side="FOR" stats={analysis.analytics.threats.FOR} reference={reference.analytics.threats.FOR} /><OutcomeDistribution side="AGAINST" stats={analysis.analytics.threats.AGAINST} reference={reference.analytics.threats.AGAINST} /></section>
    <section><SectionTitle eyebrow="SCOPE ACTIVO">DESTACADOS</SectionTitle><div className="flex gap-3 overflow-x-auto pb-2">{players.map((player) => <Link href={`/dashboard/jugador/${encodeURIComponent(player.playerId)}?${query}`} key={player.playerId} className="w-36 shrink-0"><PlayerPhotoCard player={{ id: player.playerId, name: player.name, number: player.number, photoUrl: player.photoUrl }} className="h-44 w-36"><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 p-3 pt-10"><strong className="block truncate text-sm">{player.name}</strong><span className="text-[10px] text-cyan-200">{player.goals} G · {player.assists} A</span></span></PlayerPhotoCard></Link>)}</div></section>
    <TeamEvolution analysis={analysis} reference={reference} referenceLabel="MEDIA"/>
  </>;
}

function TeamArea({ analysis, reference, mode, scope, onScope, referenceLabel }: { analysis: Analysis; reference: Analysis; mode: DashboardValueMode; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; referenceLabel: string }) {
  return <><section><SectionTitle eyebrow="REMATES ← CENTRO → AMENAZAS">FASES</SectionTitle><div className="space-y-3 rounded-3xl border border-slate-700 bg-slate-900 p-4">{DASHBOARD_PHASES.filter((phase) => phase !== "UNSPECIFIED").map((phase) => { const current = analysis.analytics.phases[phase]; return <button type="button" key={phase} onClick={() => onScope({ ...scope, phases: toggle(scope.phases, phase) })} className="block w-full"><FacedMetricRow label={PHASE_LABEL[phase]} own={current.FOR} rival={current.AGAINST} ownReference={reference.samples ? reference.analytics.phases[phase].FOR / reference.samples : null} rivalReference={reference.samples ? reference.analytics.phases[phase].AGAINST / reference.samples : null} /></button>; })}</div></section><section><SectionTitle eyebrow="SIN AGREGADOS PERSISTIDOS">EQUIPO</SectionTitle><TeamComparison analysis={analysis} reference={reference} mode={mode} /><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Kpi label="FC CRÍTICAS" value={analysis.criticalFouls.for} /><Kpi label="FR CRÍTICAS" value={analysis.criticalFouls.against} /><Kpi label="2ª JUGADA" value={analysis.analytics.secondPlay.threats} /><Kpi label="GOLES 2ª" value={analysis.analytics.secondPlay.goals} /></div></section><TeamEvolution analysis={analysis} reference={reference} referenceLabel={referenceLabel}/><section><SectionTitle eyebrow="SEPARADO DE PORTEROS NORMALES">PORTERO-JUGADOR</SectionTitle><div className="grid gap-3 sm:grid-cols-2"><article className="rounded-3xl border border-cyan-900 bg-slate-900 p-4"><h3 className="font-black text-cyan-300">CUANDO SACAMOS P-J</h3><p className="mt-2 text-sm">{format(analysis.flyingGoalkeeper.for.minutes, "'")} · Remates {analysis.flyingGoalkeeper.for.threatsFor} · Amenazas {analysis.flyingGoalkeeper.for.threatsAgainst} · GF–GC {analysis.flyingGoalkeeper.for.goalsFor}–{analysis.flyingGoalkeeper.for.goalsAgainst}</p></article><article className="rounded-3xl border border-rose-900 bg-slate-900 p-4"><h3 className="font-black text-rose-300">CUANDO DEFENDEMOS P-J</h3><p className="mt-2 text-sm">{format(analysis.flyingGoalkeeper.against.minutes, "'")} · Remates {analysis.flyingGoalkeeper.against.threatsFor} · Amenazas {analysis.flyingGoalkeeper.against.threatsAgainst} · GF–GC {analysis.flyingGoalkeeper.against.goalsFor}–{analysis.flyingGoalkeeper.against.goalsAgainst}</p></article></div></section></>;
}

function Goalkeepers({ analysis, keeperA, keeperB, onA, onB, query }: { analysis: Analysis; keeperA?: Analysis["goalkeepers"][number]; keeperB?: Analysis["goalkeepers"][number]; onA: (id: string) => void; onB: (id: string) => void; query: string }) {
  if (!keeperA) return <section><SectionTitle>PORTEROS</SectionTitle><p className="rounded-3xl border border-dashed border-slate-700 p-8 text-slate-500">N/D · Sin portero funcional reconstruible.</p></section>;
  return <section><SectionTitle eyebrow="P-J EXCLUIDO · MISMO SCOPE">PORTEROS</SectionTitle><div className="grid grid-cols-2 gap-2"><select aria-label="Portero A" value={keeperA.playerId} onChange={(event) => onA(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>A · #{keeper.number} {keeper.name}</option>)}</select><select aria-label="Portero B" value={keeperB?.playerId ?? ""} onChange={(event) => onB(event.target.value)} className="min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-black">{analysis.goalkeepers.map((keeper) => <option key={keeper.playerId} value={keeper.playerId}>B · #{keeper.number} {keeper.name}</option>)}</select></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{[keeperA, keeperB].filter((keeper, index, all) => keeper && all.findIndex((item) => item?.playerId === keeper.playerId) === index).map((keeper) => keeper && <KeeperCard key={keeper.playerId} keeper={keeper} query={query} />)}</div><div className="mt-3 grid gap-3 lg:grid-cols-2"><GoalThreatMap points={keeperA.goalPoints}/><KeeperBodySummary keeper={keeperA}/></div></section>;
}

function KeeperCard({ keeper, query }: { keeper: Analysis["goalkeepers"][number]; query: string }) {
  const savesWithOutcome = Object.values(keeper.saveOutcomes).reduce((sum, value) => sum + value, 0);
  return <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="flex gap-4"><PlayerPhotoCard player={{ id: keeper.playerId, name: keeper.name, number: keeper.number, photoUrl: keeper.photoUrl }} className="h-36 w-28 shrink-0"/><div><span className="text-xs font-black text-cyan-300">#{keeper.number}</span><h3 className="text-xl font-black">{keeper.name}</h3><strong className="mt-2 block text-4xl">{format(keeper.savePercentage, "%")}</strong><span className="text-[9px] text-slate-500">{format(keeper.minutes, "'")} · {format(keeper.threatsAgainst40)} amenazas/40</span></div></div><div className="mt-3 grid grid-cols-3 gap-2"><Kpi label="AMENAZAS" value={keeper.threatsAgainst}/><Kpi label="PARADAS" value={keeper.saves}/><Kpi label="GOLES" value={keeper.goalsAgainst}/></div><div className="mt-3"><SaveOutcomeSummary keeper={keeper}/></div><p className="mt-2 text-[9px] text-slate-500">Desenlace documentado: {savesWithOutcome}/{keeper.saves} paradas.</p><Link href={`/dashboard/portero/${encodeURIComponent(keeper.playerId)}?${query}`} className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-cyan-800 px-4 text-[10px] font-black text-cyan-200">VER DETALLE</Link></article>;
}

function Maps({ analysis, scope, onScope, onPoint }: { analysis: Analysis; scope: DashboardScopeV2; onScope: (scope: DashboardScopeV2) => void; onPoint: (point: TraceablePoint) => void }) {
  return <section><SectionTitle eyebrow="PUNTOS EXACTOS · EVENTO TRAZABLE">MAPAS / ZONAS</SectionTitle><div className="grid gap-3 lg:grid-cols-2"><PitchThreatMap points={analysis.analytics.pitchPoints} side="FOR" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchThreatMap points={analysis.analytics.pitchPoints} side="AGAINST" onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><PitchZoneGrid zones={analysis.pitchZones} selected={scope.originZones} onSelect={(zone) => onScope({ ...scope, originZones: toggle(scope.originZones, zone) })}/><GoalThreatMap points={analysis.analytics.goalPoints} onSelect={onPoint} pointTitle={(point) => dashboardMapPointTitle(analysis.records, point)}/><GoalZoneGrid zones={analysis.goalZones} selected={scope.targetZones} onSelect={(zone) => onScope({ ...scope, targetZones: toggle(scope.targetZones, zone) })}/></div></section>;
}

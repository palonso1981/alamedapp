"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { buildDashboardFixture, DASHBOARD_FIXTURE_CLUB_ID, DASHBOARD_FIXTURE_SEASON_ID, DASHBOARD_FIXTURE_TEAM_ID } from "../../lib/dashboardFixture";
import { listMatchCatalog, matchCatalogClubId, visibleMatchCatalog } from "../../lib/matchCatalog";
import { loadMatchSession } from "../../lib/matchPersistence";
import { buildDashboardV2, DashboardArea, DashboardReferencePreset, DashboardScopeV2, DashboardValueMode, defaultDashboardCompetition, emptyDashboardScope, hasDashboardScopeSearchParams, matchCompetition, mergeDashboardSearchParams, referenceScopeForPreset, scopeFromSearchParams } from "../../lib/dashboardV2";
import { replayMatch } from "../../lib/matchEngine";
import { withCurrentPlayerIdentity } from "../../lib/dashboardIdentity";
import { useTeamStore } from "../../store/useTeamStore";

function localRecords(): DashboardMatchRecord[] {
  return listMatchCatalog().flatMap((catalog) => {
    const session = loadMatchSession(catalog.matchId);
    return session ? [{ catalog, session }] : [];
  });
}

export function useDashboardProfileData(pathname: string, area: DashboardArea = "PLAYERS") {
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
  const [ready, setReady] = useState(false);

  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => {
    if (!registryReady || ready) return;
    if (!fixture) ensureTeam(currentClubId);
    const active = fixture ? undefined : useTeamStore.getState().teams[currentClubId];
    const teamId = active?.teams.find((team) => team.active && !team.archivedAt && !team.deletedAt)?.teamId ?? "";
    const seasonId = active?.seasons.find((season) => season.teamId === teamId && season.current && season.active)?.seasonId ?? active?.seasons.find((season) => season.teamId === teamId && season.active)?.seasonId ?? "";
    const fallback = emptyDashboardScope(fixture ? DASHBOARD_FIXTURE_CLUB_ID : currentClubId, fixture ? DASHBOARD_FIXTURE_TEAM_ID : teamId, fixture ? DASHBOARD_FIXTURE_SEASON_ID : seasonId);
    const params = new URLSearchParams(searchParams.toString());
    const loadedRecords = fixture ? buildDashboardFixture() : localRecords();
    const parsedScope = scopeFromSearchParams(params, "a", fallback);
    if (!params.has("aCompetition")) parsedScope.competition = defaultDashboardCompetition(loadedRecords, parsedScope);
    setRecords(loadedRecords);
    setScope(parsedScope);
    const preset = (params.get("reference") as DashboardReferencePreset) ?? "SEASON";
    setReferencePreset(preset);
    setReferenceScope(hasDashboardScopeSearchParams(params, "r") ? scopeFromSearchParams(params, "r", referenceScopeForPreset(parsedScope, preset)) : referenceScopeForPreset(parsedScope, preset));
    setMode((params.get("mode") as DashboardValueMode) ?? "TOTALS");
    setReady(true);
  }, [currentClubId, ensureTeam, fixture, ready, registryReady, searchParams]);

  const resolvedRecords = useMemo(
    () => fixture ? records : withCurrentPlayerIdentity(records, workspace?.players ?? []),
    [fixture, records, workspace?.players],
  );
  const analysis = useMemo(() => buildDashboardV2(resolvedRecords, scope), [resolvedRecords, scope]);
  const reference = useMemo(() => buildDashboardV2(resolvedRecords, referenceScope), [referenceScope, resolvedRecords]);
  useEffect(() => {
    if (!ready || referencePreset === "CUSTOM" || referencePreset === "MATCH") return;
    setReferenceScope(referenceScopeForPreset(scope, referencePreset));
  }, [ready, referencePreset, scope]);
  const teams = useMemo(() => workspace?.teams.filter((team) => team.active && !team.archivedAt && !team.deletedAt) ?? [], [workspace]);
  const seasons = useMemo(() => workspace?.seasons.filter((season) => season.active && !season.archivedAt && !season.deletedAt) ?? [], [workspace]);
  const clubs = clubIds.map((clubId) => useTeamStore.getState().teams[clubId]?.club).filter((club) => Boolean(club && club.active && !club.archivedAt && !club.deletedAt)) as Array<NonNullable<typeof workspace>["club"]>;
  useEffect(() => {
    if (!ready || fixture || scope.clubId === currentClubId) return;
    const teamId = teams[0]?.teamId ?? "";
    const seasonId = seasons.find((season) => season.teamId === teamId && season.current)?.seasonId ?? seasons.find((season) => season.teamId === teamId)?.seasonId ?? "";
    setScope((current) => ({ ...emptyDashboardScope(currentClubId, teamId, seasonId), period: current.period }));
    setRecords(localRecords());
  }, [currentClubId, fixture, ready, scope.clubId, seasons, teams]);
  const matches = useMemo(() => visibleMatchCatalog(resolvedRecords.map((record) => record.catalog), scope.includeArchived).filter((match) => matchCatalogClubId(match) === scope.clubId && match.teamId === scope.teamId && match.seasonId === scope.seasonId).map((match) => { const record = resolvedRecords.find((item) => item.catalog.matchId === match.matchId); const score = record ? replayMatch(record.session.players, record.session.events).score : null; const competitionType = record ? matchCompetition(record) : undefined; return { ...match, matchday: record?.session.preparation?.matchday, competitionType, competitionLabel: competitionType ? ({ LEAGUE: "Liga", CUP: "Copa", FRIENDLY: "Amistoso", OTHER: "Otra", UNSPECIFIED: "Sin clasificar" } as const)[competitionType] : undefined, scoreLabel: score ? `${score.for}-${score.against}` : undefined }; }).sort((a, b) => b.date.localeCompare(a.date)), [resolvedRecords, scope.clubId, scope.includeArchived, scope.seasonId, scope.teamId]);
  const rivals = useMemo(() => Array.from(new Set(matches.map((match) => match.opponent))).sort(), [matches]);

  function changeReferencePreset(preset: DashboardReferencePreset) {
    setReferencePreset(preset);
    if (preset === "MATCH" || (preset === "CUSTOM" && referencePreset !== "CUSTOM")) setReferenceScope(referenceScopeForPreset(scope, preset));
    else if (preset !== "CUSTOM") setReferenceScope(referenceScopeForPreset(scope, preset));
  }

  useEffect(() => {
    if (!ready) return;
    const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area }, new URLSearchParams(searchParams.toString()));
    if (query !== searchParams.toString()) router.replace(`${pathname}?${query}`, { scroll: false });
  }, [area, mode, pathname, ready, referencePreset, referenceScope, router, scope, searchParams]);

  const query = mergeDashboardSearchParams({ analysis: scope, reference: referenceScope, referencePreset, mode, area }, new URLSearchParams(fixture ? "fixture=1" : ""));
  return { analysis, clubs, currentClubId, fixture, matches, mode, query, ready, records: resolvedRecords, reference, referenceScope, referencePreset, rivals, scope, seasons, setCurrentClub, setMode, setReferencePreset: changeReferencePreset, setReferenceScope, setScope, teams, workspace, refresh: () => setRecords(fixture ? buildDashboardFixture() : localRecords()) };
}

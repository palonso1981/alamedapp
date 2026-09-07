import { DashboardMatchRecord } from "./dashboardAnalytics";
import {
  createCardEvent,
  createFoulEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createSubstitutionEvent,
} from "./matchEngine";
import { CompetitionType, MatchEvent, MatchSession, Player, ThreatPhase } from "../types";

export const DASHBOARD_FIXTURE_CLUB_ID = "dashboard-fixture-club";
export const DASHBOARD_FIXTURE_TEAM_ID = "dashboard-fixture-team";
export const DASHBOARD_FIXTURE_SEASON_ID = "dashboard-fixture-season";
const PHOTO_BLUE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 220'%3E%3Crect width='160' height='220' fill='%230c4a6e'/%3E%3Ccircle cx='80' cy='72' r='40' fill='%23f1c27d'/%3E%3Cpath d='M30 220c0-62 22-92 50-92s50 30 50 92' fill='%2306b6d4'/%3E%3C/svg%3E";
const PHOTO_AMBER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 220'%3E%3Crect width='160' height='220' fill='%237c2d12'/%3E%3Ccircle cx='80' cy='72' r='40' fill='%23d6a06f'/%3E%3Cpath d='M30 220c0-62 22-92 50-92s50 30 50 92' fill='%23f59e0b'/%3E%3C/svg%3E";

const fixturePlayers: Player[] = [
  { id: "fx-gk-1", name: "Leo Ramos", number: 1, position: "PORTERO", naturalPosition: "GOALKEEPER", goalkeeperCapable: true, photoUrl: PHOTO_BLUE },
  { id: "fx-gk-2", name: "Dani Cruz", number: 13, position: "PORTERO", naturalPosition: "GOALKEEPER", goalkeeperCapable: true },
  { id: "fx-p-2", name: "Álex", number: 2, position: "CIERRE", naturalPosition: "FIXO" },
  { id: "fx-p-4", name: "Mario", number: 4, position: "ALA", naturalPosition: "WINGER", photoUrl: PHOTO_AMBER },
  { id: "fx-p-5", name: "Pablo", number: 5, position: "ALA", naturalPosition: "WINGER" },
  { id: "fx-p-7", name: "Hugo", number: 7, position: "PÍVOT", naturalPosition: "PIVOT" },
  { id: "fx-p-8", name: "Nico", number: 8, position: "UNIVERSAL", naturalPosition: "UNIVERSAL" },
  { id: "fx-p-9", name: "Sergio", number: 9, position: "PÍVOT", naturalPosition: "PIVOT" },
  { id: "fx-p-10", name: "Izan", number: 10, position: "ALA", naturalPosition: "WINGER" },
  { id: "fx-p-12", name: "Raúl", number: 12, position: "CIERRE", naturalPosition: "FIXO" },
];

const phases: ThreatPhase[] = [
  "POSITIONAL", "TRANSITION", "SET_PIECE_CORNER", "SET_PIECE_KICK_IN",
  "SET_PIECE_FREE_KICK", "FLYING_GOALKEEPER", "PENALTY", "DOUBLE_PENALTY",
];
const origins = [
  { x: 0.12, y: 0.82 }, { x: 0.14, y: 0.5 }, { x: 0.1, y: 0.16 },
  { x: 0.55, y: 0.82 }, { x: 0.62, y: 0.5 }, { x: 0.72, y: 0.16 },
];

function threat(
  matchId: string,
  id: string,
  period: number,
  minute: number,
  order: number,
  side: "FOR" | "AGAINST",
  outcome: "GOL" | "PARADA" | "FUERA",
  phase: ThreatPhase,
  playerId?: string,
  goalkeeperId = "fx-gk-1",
): MatchEvent {
  return createLiveThreatEvent({
    id,
    matchId,
    position: { period, minute, order },
    side,
    playerId,
    origin: origins[(minute + order) % origins.length],
    outcome,
    phase: phase === "UNSPECIFIED" ? "POSITIONAL" : phase,
    assist: side === "FOR" && outcome === "GOL"
      ? { status: id.endsWith("0") ? "PENDING" : "PLAYER", playerId: "fx-p-5" }
      : undefined,
    defensive: side === "AGAINST" ? {
      version: 2,
      goalTarget: {
        x: outcome === "FUERA" ? 0.13 : 0.32 + ((minute * 13) % 35) / 100,
        y: outcome === "FUERA" ? 0.08 : 0.28 + ((minute * 7) % 32) / 100,
        geometryVersion: 3,
      },
      goalkeeper: { status: "PLAYER", playerId: goalkeeperId, resolution: "REPLAY" },
      keeperBodyPart: outcome === "PARADA" ? (minute % 2 ? "TORSO" : "LEFT_LEG_FOOT") : undefined,
      saveOutcome: outcome === "PARADA" ? (minute % 3 === 0 ? "REBOUND" : minute % 3 === 1 ? "CATCH" : "CLEARANCE") : undefined,
    } : undefined,
    pendingReview: id.endsWith("0"),
    now: Date.UTC(2026, 7, period, minute, order),
  });
}

function buildFixtureRecord(index: number): DashboardMatchRecord {
  const matchId = `dashboard-fixture-${index + 1}`;
  const home = index % 2 === 0;
  const startingGoalkeeper = index === 3 ? "fx-gk-2" : "fx-gk-1";
  const secondHalfGoalkeeper = index === 7 ? startingGoalkeeper : "fx-gk-2";
  const starters = [startingGoalkeeper, "fx-p-2", "fx-p-4", "fx-p-5", "fx-p-7"];
  const events: MatchEvent[] = [
    createLineupInitializedEvent({ id: `${matchId}-p1`, matchId, position: { period: 1, minute: 0, order: 1 }, squadPlayerIds: fixturePlayers.map((player) => player.id), onCourtPlayerIds: starters, goalkeeperPlayerId: startingGoalkeeper, now: index * 1000 + 1 }),
    threat(matchId, `${matchId}-for-${index === 0 ? "0" : "1"}`, 1, 2, 1, "FOR", index % 3 === 0 ? "GOL" : "PARADA", phases[index % phases.length], "fx-p-4", startingGoalkeeper),
    threat(matchId, `${matchId}-against-1`, 1, 4, 1, "AGAINST", index % 2 === 0 ? "PARADA" : "GOL", phases[(index + 1) % phases.length], undefined, startingGoalkeeper),
    createFoulEvent({ id: `${matchId}-f1`, matchId, position: { period: 1, minute: 6, order: 1 }, side: "FOR", playerId: "fx-p-2", now: index * 1000 + 6 }),
    createSubstitutionEvent({ id: `${matchId}-sub-1`, matchId, position: { period: 1, minute: 8, order: 1 }, playerOutId: "fx-p-2", playerInId: "fx-p-8", now: index * 1000 + 8 }),
    threat(matchId, `${matchId}-for-2`, 1, 12, 1, "FOR", "FUERA", phases[(index + 2) % phases.length], "fx-p-8", startingGoalkeeper),
    createCardEvent({ id: `${matchId}-card`, matchId, position: { period: 1, minute: 15, order: 1 }, side: "FOR", color: "YELLOW", playerId: "fx-p-8", now: index * 1000 + 15 }),
    createLineupInitializedEvent({ id: `${matchId}-p2`, matchId, position: { period: 2, minute: 0, order: 1 }, squadPlayerIds: fixturePlayers.map((player) => player.id), onCourtPlayerIds: [secondHalfGoalkeeper, "fx-p-5", "fx-p-7", "fx-p-9", "fx-p-10"], goalkeeperPlayerId: secondHalfGoalkeeper, now: index * 1000 + 20 }),
    threat(matchId, `${matchId}-against-2`, 2, 3, 1, "AGAINST", "PARADA", phases[(index + 3) % phases.length], undefined, secondHalfGoalkeeper),
    threat(matchId, `${matchId}-for-3`, 2, 7, 1, "FOR", index % 2 ? "GOL" : "PARADA", phases[(index + 4) % phases.length], "fx-p-9", secondHalfGoalkeeper),
    createFoulEvent({ id: `${matchId}-f2`, matchId, position: { period: 2, minute: 10, order: 1 }, side: "AGAINST", playerId: "fx-p-7", now: index * 1000 + 30 }),
  ];
  for (let foul = 2; foul <= 5; foul += 1) {
    events.push(createFoulEvent({ id: `${matchId}-critical-${foul}`, matchId, position: { period: 2, minute: 10 + foul, order: 1 }, side: "FOR", playerId: foul === 5 ? "fx-p-5" : null, now: index * 1000 + 30 + foul }));
  }
  if (index === 7) {
    events.push(
      threat(matchId, `${matchId}-context-2-1`, 2, 10, 2, "FOR", "GOL", "POSITIONAL", "fx-p-10", secondHalfGoalkeeper),
      threat(matchId, `${matchId}-context-3-1`, 2, 12, 2, "FOR", "GOL", "TRANSITION", "fx-p-9", secondHalfGoalkeeper),
      threat(matchId, `${matchId}-context-3-2`, 2, 16, 1, "AGAINST", "GOL", "TRANSITION", undefined, secondHalfGoalkeeper),
      threat(matchId, `${matchId}-context-gold`, 2, 17, 1, "AGAINST", "PARADA", "POSITIONAL", undefined, secondHalfGoalkeeper),
    );
  }
  if (index === 4) {
    events.push(
      createGameStateEvent({ id: `${matchId}-pj-on`, matchId, position: { period: 2, minute: 16, order: 1 }, state: "FLYING_GOALKEEPER", active: true, playerId: "fx-p-10", side: "FOR", now: 5000 }),
      threat(matchId, `${matchId}-pj-threat`, 2, 17, 1, "AGAINST", "GOL", "FLYING_GOALKEEPER", undefined, "fx-p-10"),
      createGameStateEvent({ id: `${matchId}-pj-off`, matchId, position: { period: 2, minute: 19, order: 1 }, state: "FLYING_GOALKEEPER", active: false, side: "FOR", now: 5002 }),
    );
  }
  const opponent = ["Racing Norte", "Sala Centro", "Atlético Sur", "Racing Norte", "Unión Este", "Futsal Oeste", "Ciudad Jardín", "Sala Centro", "Legacy Norte"][index];
  const date = `2026-${String(index + 1).padStart(2, "0")}-${String(10 + index).padStart(2, "0")}`;
  const preparation = {
    clubId: DASHBOARD_FIXTURE_CLUB_ID,
    teamId: DASHBOARD_FIXTURE_TEAM_ID,
    seasonId: DASHBOARD_FIXTURE_SEASON_ID,
    ...(index < 4 ? { competitionType: "LEAGUE" as CompetitionType }
      : index < 6 ? { competitionType: "FRIENDLY" as CompetitionType }
        : index < 8 ? { competitionType: "CUP" as CompetitionType }
          : {}),
    opponent,
    venue: home ? "HOME" as const : "AWAY" as const,
    date,
    status: "FINISHED" as const,
    calledPlayerIds: fixturePlayers.map((player) => player.id),
    starterPlayerIds: starters,
    startingGoalkeeperId: startingGoalkeeper,
    selectedStaffIds: [],
    targetMinutes: {},
    createdAt: index + 1,
    updatedAt: index + 101,
  };
  const session: MatchSession = {
    matchId,
    preparation,
    players: fixturePlayers,
    staff: [],
    period: 2,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
    reviewStatus: "VALIDATED",
    events,
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "saved",
    lastSavedAt: index + 101,
  };
  return {
    catalog: {
      matchId,
      clubId: DASHBOARD_FIXTURE_CLUB_ID,
      teamId: DASHBOARD_FIXTURE_TEAM_ID,
      seasonId: DASHBOARD_FIXTURE_SEASON_ID,
      opponent,
      venue: preparation.venue,
      date,
      status: "FINISHED",
      updatedAt: index + 101,
    },
    session,
  };
}

/** Fixture exclusivamente en memoria para validación visual; nunca toca repositorios ni Firebase. */
export function buildDashboardFixture(): DashboardMatchRecord[] {
  return Array.from({ length: 9 }, (_, index) => buildFixtureRecord(index));
}

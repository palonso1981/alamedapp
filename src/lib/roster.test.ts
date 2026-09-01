import assert from "node:assert/strict";
import test from "node:test";

import {
  addExtraPlayerToMatch,
  createDraftMatch,
  markMatchReady,
  plannedMinutes,
  selectStartingGoalkeeper,
  setTargetMinutes,
  startPreparedMatch,
  toggleCalledPlayer,
  toggleMatchStaff,
  toggleStarter,
  validatePreparation,
  validateStartingLineup,
} from "./preMatch";
import {
  calculateDeletionImpact,
  availableTeams,
  changeAdminLifecycle,
  changeMatchLifecycle,
  createTeamProfile,
} from "./adminDomain";
import { visibleMatchCatalog } from "./matchCatalog";
import {
  createMasterPlayer,
  createMasterStaff,
  playerSnapshot,
  updateMasterPlayer,
} from "./rosterDomain";
import {
  createSeason,
  currentSeason,
  emptyTeamWorkspace,
  rosterForSeason,
  rosterWithExtraPlayers,
  setCurrentSeason,
  upsertSeasonPlayer,
  upsertSeasonStaff,
} from "./seasonDomain";
import { LocalStorageAdapter } from "./matchPersistence";
import { LocalTeamRepository } from "./sync/localTeamRepository";
import { LocalMatchRepository } from "./sync/localMatchRepository";
import { InMemoryRemoteMatchRepository } from "./sync/remoteMatchRepository";
import { RemoteApplyResult } from "./sync/remoteMatchRepository";
import { RevisionedRemoteRepository, SyncCoordinator } from "./sync/syncCoordinator";
import { teamEntityKey, TeamSyncOperation } from "./sync/teamSyncTypes";
import { replayMatch } from "./matchEngine";
import { MasterPlayer, TeamRoster, TeamWorkspace } from "../types";

const MATCH_SCOPE = { teamId: "cd-alameda", seasonId: "season-test" } as const;

class MemoryStorage implements LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class TeamRemote implements RevisionedRemoteRepository<TeamSyncOperation> {
  readonly documents = new Map<string, { revision: number; payload: unknown; operationId: string }>();
  online = true;
  async apply(operation: TeamSyncOperation): Promise<RemoteApplyResult> {
    if (!this.online) throw Object.assign(new Error("offline"), { code: "unavailable" });
    const key = teamEntityKey(operation.entityType, operation.entityId);
    const current = this.documents.get(key);
    if (current?.operationId === operation.id) return { status: "ALREADY_APPLIED", revision: current.revision };
    const revision = current?.revision ?? 0;
    if (revision !== operation.baseRevision) return { status: "CONFLICT", remoteRevision: revision, remotePayload: current?.payload ?? null };
    this.documents.set(key, { revision: revision + 1, payload: structuredClone(operation.payload), operationId: operation.id });
    return { status: "APPLIED", revision: revision + 1 };
  }
}

function rosterFixture(): TeamRoster {
  const players: MasterPlayer[] = [
    createMasterPlayer([], { fullName: "Daniel Portero", displayName: "Dani", number: 1, role: "GOALKEEPER", dateOfBirth: "2000-01-02", primaryPosition: "GOALKEEPER", dominantFoot: "RIGHT", canPlayGoalkeeper: true }, { id: "gk-1", now: 1 }),
  ];
  for (let index = 2; index <= 8; index += 1) {
    players.push(createMasterPlayer(players, { fullName: `Jugador ${index}`, displayName: `J${index}`, number: index, role: index === 8 ? "GOALKEEPER" : "FIELD" }, { id: `p-${index}`, now: index }));
  }
  return {
    teamId: "cd-alameda",
    players,
    staff: [createMasterStaff({ fullName: "Ana Técnica", displayName: "Ana", role: "HEAD_COACH" }, { id: "staff-1", now: 1 })],
  };
}

function workspaceFixture(): TeamWorkspace {
  const roster = rosterFixture();
  return { ...emptyTeamWorkspace(roster.teamId, 1), players: roster.players, staff: roster.staff };
}

test("temporadas mantienen ID estable y una única temporada actual configurable", () => {
  let workspace = createSeason(
    workspaceFixture(),
    { label: "2025-26", copyLegacyRoster: true },
    { seasonId: "season-a", now: 10 },
  );
  workspace = createSeason(
    workspace,
    { label: "2026-27", copyFromSeasonId: "season-a" },
    { seasonId: "season-b", now: 20 },
  );
  assert.equal(currentSeason(workspace)?.seasonId, "season-a");
  workspace = setCurrentSeason(workspace, "season-b", 30);
  assert.equal(currentSeason(workspace)?.seasonId, "season-b");
  assert.equal(workspace.seasons.filter((season) => season.current).length, 1);
  assert.deepEqual(workspace.seasons.map((season) => season.seasonId), ["season-a", "season-b"]);
});

test("copiar plantilla crea memberships nuevas sin duplicar identidades maestras", () => {
  const initial = workspaceFixture();
  let workspace = createSeason(
    initial,
    { label: "2025-26", copyLegacyRoster: true },
    { seasonId: "season-origin", now: 10 },
  );
  workspace = createSeason(
    workspace,
    { label: "2026-27", copyFromSeasonId: "season-origin" },
    { seasonId: "season-copy", now: 20 },
  );
  assert.equal(workspace.players.length, initial.players.length);
  assert.equal(workspace.staff.length, initial.staff.length);
  assert.deepEqual(
    rosterForSeason(workspace, "season-copy").players.map((player) => player.playerId),
    rosterForSeason(workspace, "season-origin").players.map((player) => player.playerId),
  );
  assert.equal(
    workspace.seasonPlayers.filter((membership) => membership.seasonId === "season-copy").length,
    initial.players.length,
  );
  assert.equal(
    workspace.seasonStaff.filter((membership) => membership.seasonId === "season-copy").length,
    initial.staff.length,
  );
});

test("membresías cambian dorsal posición y actividad sin duplicar playerId ni alterar otra temporada", () => {
  let workspace = createSeason(
    workspaceFixture(),
    { label: "2025-26", copyLegacyRoster: true },
    { seasonId: "season-a", now: 10 },
  );
  workspace = createSeason(
    workspace,
    { label: "2026-27", copyFromSeasonId: "season-a" },
    { seasonId: "season-b", now: 20 },
  );
  workspace = upsertSeasonPlayer(workspace, "season-b", "p-2", {
    number: 22,
    primaryPosition: "PIVOT",
    active: false,
  }, 30);
  const first = rosterForSeason(workspace, "season-a").players.find((player) => player.playerId === "p-2")!;
  const second = rosterForSeason(workspace, "season-b").players.find((player) => player.playerId === "p-2")!;
  assert.equal(first.playerId, second.playerId);
  assert.equal(first.number, 2);
  assert.equal(second.number, 22);
  assert.notEqual(first.primaryPosition, second.primaryPosition);
  assert.equal(first.active, true);
  assert.equal(second.active, false);
});

test("staff conserva identidad y admite rol y actividad distintos por temporada", () => {
  let workspace = createSeason(
    workspaceFixture(),
    { label: "2025-26", copyLegacyRoster: true },
    { seasonId: "season-a", now: 10 },
  );
  workspace = createSeason(
    workspace,
    { label: "2026-27", copyFromSeasonId: "season-a" },
    { seasonId: "season-b", now: 20 },
  );
  workspace = upsertSeasonStaff(workspace, "season-b", "staff-1", {
    role: "DELEGATE",
    active: false,
  }, 30);
  const first = rosterForSeason(workspace, "season-a").staff[0];
  const second = rosterForSeason(workspace, "season-b").staff[0];
  assert.equal(first.staffId, second.staffId);
  assert.equal(first.role, "HEAD_COACH");
  assert.equal(second.role, "DELEGATE");
  assert.equal(second.active, false);
});

test("jugador maestro conserva ID al editar dorsal, nombre, rol y estado", () => {
  const original = createMasterPlayer([], { fullName: "Alejandro Martínez", displayName: "Álex", number: 11, role: "FIELD" }, { id: "stable-player", now: 10 });
  const edited = updateMasterPlayer([original], original.playerId, { fullName: "Alejandro M.", displayName: "Alex", number: 9, role: "GOALKEEPER", active: false }, 20)[0];
  assert.equal(edited.playerId, "stable-player");
  assert.equal(edited.number, 9);
  assert.equal(edited.role, "GOALKEEPER");
  assert.equal(edited.active, false);
  assert.equal(edited.createdAt, 10);
  assert.equal(edited.updatedAt, 20);
});

test("ficha maestra separa perfil natural, capacidad de portero y rol funcional", () => {
  const player = createMasterPlayer([], {
    fullName: "Lucía Universal",
    displayName: "Lucía",
    number: 13,
    role: "FIELD",
    dateOfBirth: "2004-02-29",
    primaryPosition: "UNIVERSAL",
    dominantFoot: "BOTH",
    canPlayGoalkeeper: true,
  }, { id: "profile-player", now: 1 });
  assert.equal(player.playerId, "profile-player");
  assert.equal(player.primaryPosition, "UNIVERSAL");
  assert.equal(player.canPlayGoalkeeper, true);
  const snapshot = playerSnapshot(player, false);
  assert.equal(snapshot.position, "JUGADOR");
  assert.equal(snapshot.goalkeeperCapable, true);
  assert.equal(snapshot.naturalPosition, "UNIVERSAL");
  assert.equal(snapshot.dateOfBirth, "2004-02-29");
});

test("dorsales activos no se duplican y un inactivo no bloquea el dorsal", () => {
  const first = createMasterPlayer([], { fullName: "Uno", displayName: "Uno", number: 7, role: "FIELD" }, { id: "one" });
  assert.throws(() => createMasterPlayer([first], { fullName: "Dos", displayName: "Dos", number: 7, role: "FIELD" }), /dorsal 7/i);
  const inactive = updateMasterPlayer([first], first.playerId, { active: false })[0];
  assert.doesNotThrow(() => createMasterPlayer([inactive], { fullName: "Dos", displayName: "Dos", number: 7, role: "FIELD" }));
});

test("staff mantiene entidad e identidad separadas del jugador", () => {
  const player = createMasterPlayer([], { fullName: "Alex", displayName: "Alex", number: 4, role: "FIELD" }, { id: "same-visible-id" });
  const staff = createMasterStaff({ fullName: "Alex", displayName: "Alex", role: "DELEGATE" }, { id: "staff-id" });
  assert.equal(player.playerId, "same-visible-id");
  assert.equal(staff.staffId, "staff-id");
  assert.equal("number" in staff, false);
});

test("plantilla persiste offline, reaparece y sincroniza fichas sin duplicados", async () => {
  const storage = new MemoryStorage(); let id = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `team-op-${++id}` });
  const remote = new TeamRemote(); remote.online = false;
  const coordinator = new SyncCoordinator(local, remote, { isOnline: () => remote.online });
  const roster = rosterFixture();
  local.save(roster);
  await coordinator.syncMatch(roster.teamId);
  assert.equal(local.getSummary(roster.teamId).pending, 10);
  const reopened = new LocalTeamRepository({ storage, idFactory: () => `reopen-${++id}` });
  assert.equal(reopened.load(roster.teamId).players.length, 8);
  assert.equal(reopened.load(roster.teamId).players[0].primaryPosition, "GOALKEEPER");
  assert.equal(reopened.load(roster.teamId).players[0].dateOfBirth, "2000-01-02");
  assert.equal(reopened.load(roster.teamId).players[0].canPlayGoalkeeper, true);
  assert.equal(reopened.load(roster.teamId).staff.length, 1);
  remote.online = true;
  const reopenedCoordinator = new SyncCoordinator(reopened, remote, { isOnline: () => true });
  await reopenedCoordinator.syncMatch(roster.teamId);
  assert.equal(reopened.getSummary(roster.teamId).pending, 0);
  assert.equal(remote.documents.size, 10);
});

test("equipo temporadas y memberships sobreviven offline reload y sync", async () => {
  const storage = new MemoryStorage(); let id = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `season-op-${++id}` });
  const remote = new TeamRemote(); remote.online = false;
  let workspace = createSeason(
    workspaceFixture(),
    { label: "2026-27", copyLegacyRoster: true },
    { seasonId: "season-sync", now: 10 },
  );
  workspace = upsertSeasonPlayer(workspace, "season-sync", "p-2", { number: 22 }, 20);
  assert.equal(local.save(workspace), true);
  await new SyncCoordinator(local, remote, { isOnline: () => remote.online }).syncMatch(workspace.teamId);
  assert.ok(local.getSummary(workspace.teamId).pending > 0);
  const reopened = new LocalTeamRepository({ storage, idFactory: () => `reopen-season-${++id}` });
  const loaded = reopened.load(workspace.teamId);
  assert.equal(loaded.seasons[0].seasonId, "season-sync");
  assert.equal(rosterForSeason(loaded, "season-sync").players.find((player) => player.playerId === "p-2")?.number, 22);
  remote.online = true;
  await new SyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch(workspace.teamId);
  assert.equal(reopened.getSummary(workspace.teamId).pending, 0);
  assert.ok(remote.documents.has(teamEntityKey("SEASON", "season-sync")));
  assert.ok(remote.documents.has(teamEntityKey("SEASON_PLAYER", "season-sync:p-2")));
});

test("editar una ficha mientras sincroniza conserva la versión posterior", async () => {
  const storage = new MemoryStorage(); let id = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `race-team-${++id}` });
  const inner = new TeamRemote();
  let holdNext = false;
  let release: (() => void) | undefined;
  let reached: (() => void) | undefined;
  const gate = () => new Promise<void>((resolve) => { release = resolve; });
  const claimed = new Promise<void>((resolve) => { reached = resolve; });
  const remote: RevisionedRemoteRepository<TeamSyncOperation> = {
    async apply(operation) {
      if (holdNext) {
        holdNext = false;
        reached?.();
        await gate();
      }
      return inner.apply(operation);
    },
  };
  const coordinator = new SyncCoordinator(local, remote, { isOnline: () => true });
  const base = workspaceFixture();
  local.save(base);
  await coordinator.syncMatch(base.teamId);

  const first = {
    ...base,
    players: updateMasterPlayer(base.players, "p-2", { displayName: "Primero" }, 20),
  };
  holdNext = true;
  local.save(first);
  const running = coordinator.syncMatch(base.teamId);
  await claimed;
  const second = {
    ...first,
    players: updateMasterPlayer(first.players, "p-2", { displayName: "Segundo" }, 30),
  };
  local.save(second);
  release?.();
  await running;
  await coordinator.syncMatch(base.teamId);

  const remotePlayer = inner.documents.get(teamEntityKey("PLAYER", "p-2"));
  assert.equal(local.getSummary(base.teamId).conflicts, 0);
  assert.equal(local.getSummary(base.teamId).pending, 0);
  assert.equal(remotePlayer?.revision, 3);
  assert.equal((remotePlayer?.payload as MasterPlayer).displayName, "Segundo");
});

test("conflicto de plantilla conserva payload local y remoto", async () => {
  const storage = new MemoryStorage(); let operation = 0; const local = new LocalTeamRepository({ storage, idFactory: () => `local-op-${++operation}` }); const remote = new TeamRemote();
  const roster = rosterFixture(); const player = roster.players[0];
  remote.documents.set(teamEntityKey("PLAYER", player.playerId), { revision: 2, payload: { remote: true }, operationId: "remote-op" });
  local.save({ ...roster, staff: [], players: [player] });
  await new SyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(roster.teamId);
  const state = local.getSyncState(roster.teamId);
  assert.equal(state.outbox[0].status, "CONFLICT");
  assert.equal(state.conflicts[0].remoteRevision, 2);
  assert.equal((state.conflicts[0].localPayload as MasterPlayer).playerId, player.playerId);
});

test("Prepartido deriva convocatoria, cinco, banquillo, portero, staff y plan", () => {
  const roster = rosterFixture(); let session = createDraftMatch("prematch-complete", { ...MATCH_SCOPE, opponent: "Rival", venue: "HOME", date: "2026-09-01" }, 1);
  for (const player of roster.players.slice(0, 7)) session = toggleCalledPlayer(session, roster, player.playerId, 2);
  for (const player of roster.players.slice(0, 5)) session = toggleStarter(session, roster, player.playerId, 3);
  session = selectStartingGoalkeeper(session, roster, "gk-1", 4);
  session = toggleMatchStaff(session, roster, "staff-1", 5);
  session = setTargetMinutes(session, "gk-1", 25, 6);
  session = setTargetMinutes(session, "p-2", 20, 7);
  assert.equal(validatePreparation(session, roster).valid, true);
  assert.equal(session.players.length, 7);
  assert.equal(session.staff.length, 1);
  assert.equal(session.preparation?.calledPlayerIds.length, 7);
  assert.equal(session.preparation?.starterPlayerIds.length, 5);
  assert.equal(session.preparation!.calledPlayerIds.filter((id) => !session.preparation!.starterPlayerIds.includes(id)).length, 2);
  assert.equal(plannedMinutes(session.preparation), 45);
  assert.equal(session.preparation?.teamId, MATCH_SCOPE.teamId);
  assert.equal(session.preparation?.seasonId, MATCH_SCOPE.seasonId);
});

test("Prepartido puede quedar LISTO sin quinteto pero INICIAR exige cinco y portero", () => {
  const roster = rosterFixture();
  let session = createDraftMatch("ready-without-lineup", {
    ...MATCH_SCOPE,
    opponent: "Rival",
    venue: "HOME",
    date: "2026-09-05",
    competitionType: "LEAGUE",
    competition: "Liga juvenil",
    matchday: 4,
  });
  for (const player of roster.players.slice(0, 7)) {
    session = toggleCalledPlayer(session, roster, player.playerId);
  }
  assert.equal(validatePreparation(session, roster).valid, true);
  assert.equal(validateStartingLineup(session, roster).valid, false);
  session = markMatchReady(session, roster, 10);
  assert.equal(session.preparation?.status, "READY");
  assert.throws(() => startPreparedMatch(session, roster), /cinco titulares/i);
  for (const player of roster.players.slice(0, 5)) {
    session = toggleStarter(session, roster, player.playerId);
  }
  assert.equal(session.preparation?.status, "READY");
  session = selectStartingGoalkeeper(session, roster, "gk-1");
  assert.equal(validateStartingLineup(session, roster).valid, true);
  assert.equal(startPreparedMatch(session, roster).preparation?.status, "LIVE");
});

test("Prepartido admite 5+8, rechaza el decimocuarto y excluye inactivos", () => {
  const players: MasterPlayer[] = [
    createMasterPlayer([], { fullName: "Portero", displayName: "POR", number: 1, role: "GOALKEEPER" }, { id: "limit-gk" }),
  ];
  for (let index = 2; index <= 14; index += 1) {
    players.push(createMasterPlayer(players, { fullName: `Jugador ${index}`, displayName: `J${index}`, number: index, role: "FIELD" }, { id: `limit-${index}` }));
  }
  const roster: TeamRoster = { teamId: "cd-alameda", players, staff: [] };
  let session = createDraftMatch("prematch-limit", { ...MATCH_SCOPE, opponent: "Rival", venue: "HOME", date: "2026-09-01" });
  for (const player of players.slice(0, 13)) {
    session = toggleCalledPlayer(session, roster, player.playerId);
  }
  assert.equal(session.preparation?.calledPlayerIds.length, 13);
  assert.throws(
    () => toggleCalledPlayer(session, roster, players[13].playerId),
    /hasta 13 jugadores/i,
  );
  const inactivePlayers = updateMasterPlayer(players, players[13].playerId, { active: false });
  assert.throws(
    () => toggleCalledPlayer(session, { ...roster, players: inactivePlayers }, players[13].playerId),
    /jugadores activos/i,
  );
});

test("inicio es idempotente y Directo recibe alineación y portero funcional", () => {
  const roster = rosterFixture(); let session = createDraftMatch("idempotent-start", { ...MATCH_SCOPE, opponent: "Rival", venue: "AWAY", date: "2026-09-02" }, 1);
  for (const player of roster.players.slice(0, 7)) session = toggleCalledPlayer(session, roster, player.playerId);
  for (const player of roster.players.slice(0, 5)) session = toggleStarter(session, roster, player.playerId);
  session = selectStartingGoalkeeper(session, roster, "gk-1");
  const started = startPreparedMatch(session, roster, 100);
  const retried = startPreparedMatch(started, roster, 200);
  assert.equal(retried.events.filter((event) => event.type === "lineup_initialized").length, 1);
  assert.equal(retried.preparation?.status, "LIVE");
  assert.equal(retried.minute, 0);
  const replay = replayMatch(retried.players, retried.events);
  assert.deepEqual(replay.onCourtPlayerIds, retried.preparation?.starterPlayerIds);
  assert.equal(replay.benchPlayerIds.length, 2);
  assert.equal(replay.lineupValidation.goalkeeper.status, "PLAYER");
  if (replay.lineupValidation.goalkeeper.status === "PLAYER") assert.equal(replay.lineupValidation.goalkeeper.playerId, "gk-1");
});

test("portero inicial explícito resuelve un quinteto con dos porteros naturales", () => {
  const roster = rosterFixture(); let session = createDraftMatch("two-keepers", { ...MATCH_SCOPE, opponent: "Rival", venue: "HOME", date: "2026-09-03" });
  for (const player of roster.players) session = toggleCalledPlayer(session, roster, player.playerId);
  for (const playerId of ["gk-1", "p-2", "p-3", "p-4", "p-8"]) session = toggleStarter(session, roster, playerId);
  session = selectStartingGoalkeeper(session, roster, "p-8");
  const replay = replayMatch(startPreparedMatch(session, roster).players, startPreparedMatch(session, roster).events);
  assert.equal(replay.lineupValidation.goalkeeper.status, "PLAYER");
  if (replay.lineupValidation.goalkeeper.status === "PLAYER") assert.equal(replay.lineupValidation.goalkeeper.playerId, "p-8");
});

test("Prepartido persiste, reabre offline y sincroniza metadata e inicio", async () => {
  const storage = new MemoryStorage(); let nextId = 0;
  const local = new LocalMatchRepository({ storage, idFactory: () => `match-op-${++nextId}` });
  const remote = new InMemoryRemoteMatchRepository(); remote.online = false;
  const roster = rosterFixture(); let session = createDraftMatch("offline-prematch", { ...MATCH_SCOPE, opponent: "Rival offline", venue: "AWAY", date: "2026-09-04", competitionType: "CUP", competition: "Copa local", matchday: 2 });
  for (const player of roster.players.slice(0, 7)) session = toggleCalledPlayer(session, roster, player.playerId);
  for (const player of roster.players.slice(0, 5)) session = toggleStarter(session, roster, player.playerId);
  session = selectStartingGoalkeeper(session, roster, "gk-1");
  session = setTargetMinutes(session, "p-2", 17);
  local.save(session);
  const coordinator = new SyncCoordinator(local, remote, { isOnline: () => remote.online });
  await coordinator.syncMatch(session.matchId);
  const reopened = new LocalMatchRepository({ storage, idFactory: () => `reopen-${++nextId}` });
  const loaded = reopened.load(session.matchId)!;
  assert.equal(loaded.preparation?.opponent, "Rival offline");
  assert.equal(loaded.preparation?.competitionType, "CUP");
  assert.equal(loaded.preparation?.competition, "Copa local");
  assert.equal(loaded.preparation?.matchday, 2);
  assert.equal(loaded.preparation?.targetMinutes["p-2"], 17);
  assert.equal(reopened.getSummary(session.matchId).pending, 1);
  const started = startPreparedMatch(loaded, roster);
  reopened.save(started);
  remote.online = true;
  await new SyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(reopened.getSummary(session.matchId).pending, 0);
  assert.equal(remote.documents.size, 2);
  const metadata = remote.documents.get(`${session.matchId}:match`)?.payload as { preparation?: { status: string } };
  assert.equal(metadata.preparation?.status, "LIVE");
});

test("snapshot de partido no cambia al editar o inactivar la ficha maestra", () => {
  const master = createMasterPlayer([], { fullName: "Nombre Original", displayName: "Original", number: 6, role: "FIELD" }, { id: "history-id", now: 1 });
  const snapshot = playerSnapshot(master);
  const changed = updateMasterPlayer([master], master.playerId, { fullName: "Nombre Nuevo", displayName: "Nuevo", number: 18, active: false }, 2)[0];
  assert.equal(snapshot.id, changed.playerId);
  assert.equal(snapshot.name, "Original");
  assert.equal(snapshot.number, 6);
  assert.equal(changed.displayName, "Nuevo");
});

test("club mantiene una identidad playerId entre equipos y temporadas", () => {
  let workspace = workspaceFixture();
  workspace = createTeamProfile(workspace, { name: "Senior A", shortName: "SEN A" }, { teamId: "senior-a", now: 2 });
  workspace = createTeamProfile(workspace, { name: "Juvenil A", shortName: "JUV A" }, { teamId: "juvenil-a", now: 3 });
  workspace = createSeason(workspace, { teamId: "senior-a", label: "2026-27" }, { seasonId: "senior-26", now: 4 });
  workspace = createSeason(workspace, { teamId: "juvenil-a", label: "2026-27" }, { seasonId: "juvenil-26", now: 5 });
  workspace = upsertSeasonPlayer(workspace, "senior-26", "p-2", { number: 8, active: true }, 6);
  workspace = upsertSeasonPlayer(workspace, "juvenil-26", "p-2", { number: 12, active: true }, 7);

  assert.equal(workspace.players.filter((player) => player.playerId === "p-2").length, 1);
  assert.equal(rosterForSeason(workspace, "senior-26").players.find((player) => player.playerId === "p-2")?.number, 8);
  assert.equal(rosterForSeason(workspace, "juvenil-26").players.find((player) => player.playerId === "p-2")?.number, 12);
});

test("jugador extra conserva playerId snapshot y no crea membership salvo decisión explícita", () => {
  let workspace = createSeason(workspaceFixture(), { teamId: "cd-alameda", label: "2026-27", copyLegacyRoster: true }, { seasonId: "season-extra", now: 10 });
  const extra = createMasterPlayer(workspace.players.map((player) => ({ ...player, active: false })), { fullName: "Refuerzo Juvenil", displayName: "Refuerzo", number: 21, role: "FIELD" }, { id: "club-extra", now: 11 });
  workspace = { ...workspace, players: [...workspace.players, extra] };
  let session = createDraftMatch("extra-match", { teamId: "cd-alameda", seasonId: "season-extra", opponent: "Rival", venue: "HOME", date: "2026-09-05" }, 12);
  const extraRoster = rosterWithExtraPlayers(workspace, "season-extra", [extra.playerId]);
  session = addExtraPlayerToMatch(session, extraRoster, extra.playerId, 13);
  assert.deepEqual(session.preparation?.extraPlayerIds, [extra.playerId]);
  assert.deepEqual(session.preparation?.calledPlayerIds, [extra.playerId]);
  assert.equal(session.players[0].id, extra.playerId);
  assert.equal(workspace.seasonPlayers.some((membership) => membership.playerId === extra.playerId), false);

  workspace = upsertSeasonPlayer(workspace, "season-extra", extra.playerId, { number: 21, active: true }, 14);
  assert.equal(workspace.seasonPlayers.filter((membership) => membership.playerId === extra.playerId).length, 1);
  assert.equal(workspace.players.filter((player) => player.playerId === extra.playerId).length, 1);
});

test("archivo es reversible y eliminación usa tombstone sin romper dependencias", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-a", now: 2 });
  workspace = createSeason(workspace, { teamId: "senior-a", label: "2026-27" }, { seasonId: "season-admin", now: 3 });
  workspace = upsertSeasonPlayer(workspace, "season-admin", "p-2", { number: 2, active: true }, 4);
  const impact = calculateDeletionImpact(workspace, "TEAM", "senior-a", [{ matchId: "m-1", teamId: "senior-a", seasonId: "season-admin", eventCount: 73 }]);
  assert.deepEqual({ seasons: impact.seasons, players: impact.players, matches: impact.matches, events: impact.events }, { seasons: 1, players: 1, matches: 1, events: 73 });
  workspace = changeAdminLifecycle(workspace, "TEAM", "senior-a", "ARCHIVE", 5);
  assert.equal(workspace.teams[0].archivedAt, 5);
  workspace = changeAdminLifecycle(workspace, "TEAM", "senior-a", "REACTIVATE", 6);
  assert.equal(workspace.teams[0].archivedAt, undefined);
  workspace = changeAdminLifecycle(workspace, "TEAM", "senior-a", "DELETE", 7);
  assert.equal(workspace.teams[0].deletedAt, 7);
  assert.equal(workspace.seasons[0].seasonId, "season-admin");
  assert.equal(workspace.seasonPlayers[0].playerId, "p-2");
});

test("tombstone de plantilla persiste, reabre y sincroniza sin resucitar", async () => {
  const storage = new MemoryStorage(); let id = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `admin-op-${++id}` });
  const workspace = changeAdminLifecycle(workspaceFixture(), "PLAYER", "p-2", "DELETE", 20);
  local.save(workspace);
  const reopened = new LocalTeamRepository({ storage, idFactory: () => `reopen-admin-${++id}` });
  assert.equal(reopened.load("cd-alameda").players.find((player) => player.playerId === "p-2")?.deletedAt, 20);
  const remote = new TeamRemote();
  await new SyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch("cd-alameda");
  assert.equal(reopened.getSummary("cd-alameda").pending, 0);
  const payload = remote.documents.get("player:p-2")?.payload as MasterPlayer;
  assert.equal(payload.deletedAt, 20);
  assert.equal(payload.active, false);
});

test("partido archivado/reactivado conserva eventos y delete solo añade tombstone", () => {
  let session = createDraftMatch("admin-match", { ...MATCH_SCOPE, opponent: "Rival", venue: "HOME", date: "2026-09-06" }, 1);
  session = changeMatchLifecycle(session, "ARCHIVE", 2);
  assert.equal(session.preparation?.archivedAt, 2);
  session = changeMatchLifecycle(session, "REACTIVATE", 3);
  assert.equal(session.preparation?.archivedAt, undefined);
  session = changeMatchLifecycle(session, "DELETE", 4);
  assert.equal(session.preparation?.deletedAt, 4);
  assert.deepEqual(session.events, []);
});

test("equipos temporadas jugadores staff y partidos archivados quedan ocultos y son reactivables", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-filter", now: 2 });
  workspace = createSeason(workspace, { teamId: "senior-filter", label: "2026-27" }, { seasonId: "season-filter", now: 3 });
  for (const [type, id] of [["TEAM", "senior-filter"], ["SEASON", "season-filter"], ["PLAYER", "p-2"], ["STAFF", "staff-1"]] as const) {
    workspace = changeAdminLifecycle(workspace, type, id, "ARCHIVE", 4);
  }
  assert.equal(availableTeams(workspace).some((team) => team.teamId === "senior-filter"), false);
  assert.equal(availableTeams(workspace, true).some((team) => team.teamId === "senior-filter"), true);
  assert.equal(rosterForSeason(workspace, "season-filter").players.find((player) => player.playerId === "p-2")?.active, false);
  for (const [type, id] of [["TEAM", "senior-filter"], ["SEASON", "season-filter"], ["PLAYER", "p-2"], ["STAFF", "staff-1"]] as const) {
    workspace = changeAdminLifecycle(workspace, type, id, "REACTIVATE", 5);
  }
  assert.equal(availableTeams(workspace).some((team) => team.teamId === "senior-filter"), true);
  assert.equal(rosterForSeason(workspace, "season-filter").players.find((player) => player.playerId === "p-2")?.active, false, "reactivar identidad no inventa una membership que nunca estuvo activa");

  const catalog = [
    { matchId: "normal", opponent: "A", venue: "HOME" as const, date: "2026-01-01", status: "DRAFT" as const, updatedAt: 1 },
    { matchId: "archived", opponent: "B", venue: "HOME" as const, date: "2026-01-02", status: "DRAFT" as const, updatedAt: 2, archivedAt: 3 },
    { matchId: "deleted", opponent: "C", venue: "HOME" as const, date: "2026-01-03", status: "DRAFT" as const, updatedAt: 3, deletedAt: 4 },
  ];
  assert.deepEqual(visibleMatchCatalog(catalog).map((match) => match.matchId), ["normal"]);
  assert.deepEqual(visibleMatchCatalog(catalog, true).map((match) => match.matchId), ["normal", "archived"]);
});

test("jugador extra sobrevive reload offline y sincroniza snapshot y decisión", async () => {
  const storage = new MemoryStorage(); let operation = 0;
  const local = new LocalMatchRepository({ storage, idFactory: () => `extra-op-${++operation}` });
  const workspace = workspaceFixture();
  const extra = createMasterPlayer(workspace.players.map((player) => ({ ...player, active: false })), { fullName: "Juvenil Puntual", displayName: "Juvenil", number: 20, role: "FIELD" }, { id: "extra-reload", now: 2 });
  const augmented: TeamWorkspace = { ...workspace, players: [...workspace.players, extra] };
  let session = createDraftMatch("extra-offline", { ...MATCH_SCOPE, opponent: "Rival", venue: "AWAY", date: "2026-09-07" }, 3);
  session = addExtraPlayerToMatch(session, rosterWithExtraPlayers(augmented, MATCH_SCOPE.seasonId, [extra.playerId]), extra.playerId, 4);
  local.save(session);
  const reopened = new LocalMatchRepository({ storage, idFactory: () => `extra-reopen-${++operation}` });
  assert.deepEqual(reopened.load(session.matchId)?.preparation?.extraPlayerIds, [extra.playerId]);
  assert.equal(reopened.load(session.matchId)?.players[0].id, extra.playerId);
  const remote = new InMemoryRemoteMatchRepository();
  await new SyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch(session.matchId);
  const metadata = remote.documents.get(`${session.matchId}:match`)?.payload as { preparation?: { extraPlayerIds?: string[] }; players?: Array<{ id: string }> };
  assert.deepEqual(metadata.preparation?.extraPlayerIds, [extra.playerId]);
  assert.equal(metadata.players?.[0].id, extra.playerId);
  assert.equal(reopened.getSummary(session.matchId).pending, 0);
});

test("persistencia V2 legacy migra club y equipos sin inventar un equipo real", () => {
  const storage = new MemoryStorage();
  const legacy = workspaceFixture();
  storage.setItem("alamedapp:team:v1:cd-alameda", JSON.stringify({ storageVersion: 2, savedAt: 99, roster: { teamId: legacy.teamId, team: legacy.team, players: legacy.players, staff: legacy.staff, seasons: [], seasonPlayers: [], seasonStaff: [] }, sync: { schemaVersion: 2, outbox: [], knownRemoteRevisions: {}, lastLocalMutationAt: null, lastSyncedAt: null, lastError: null, lastErrorKind: null, conflicts: [] } }));
  const migrated = new LocalTeamRepository({ storage }).load("cd-alameda");
  assert.equal(migrated.club.name, "Club Deportivo Alameda");
  assert.equal(migrated.clubId, "cd-alameda");
  assert.deepEqual(migrated.teams, []);
  assert.equal(migrated.players.length, legacy.players.length);
});

test("equipo deportivo y tombstone usan outbox estable e idempotente", async () => {
  const storage = new MemoryStorage(); let operation = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `team-unit-op-${++operation}` });
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-sync", now: 2 });
  local.save(workspace);
  workspace = changeAdminLifecycle(workspace, "TEAM", "senior-sync", "DELETE", 3);
  local.save(workspace);
  const queued = local.getSyncState("cd-alameda").outbox.filter((item) => item.entityType === "TEAM_UNIT");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].entityId, "senior-sync");
  const operationId = queued[0].id;
  const remote = new TeamRemote();
  await new SyncCoordinator(local, remote, { isOnline: () => true }).syncMatch("cd-alameda");
  assert.equal((remote.documents.get("team_unit:senior-sync")?.payload as { deletedAt?: number }).deletedAt, 3);
  assert.equal(remote.documents.get("team_unit:senior-sync")?.operationId, operationId);
  assert.equal(local.getSummary("cd-alameda").pending, 0);
});

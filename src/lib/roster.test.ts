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
  assignLegacyMatchSeason,
  availableTeams,
  clubPlayers,
  changeAdminLifecycle,
  changeMatchLifecycle,
  createTeamProfile,
  isSeasonVisible,
} from "./adminDomain";
import { matchCatalogClubId, visibleMatchCatalog } from "./matchCatalog";
import { changeClubLifecycle, createClubWorkspace, defaultClubRegistry } from "./clubDomain";
import { loadClubRegistry, saveClubRegistry } from "./clubRegistry";
import {
  canPlayGoalkeeper,
  createMasterPlayer,
  createMasterStaff,
  playerSnapshot,
  updateMasterPlayer,
} from "./rosterDomain";
import {
  createSeason,
  assertSeasonScope,
  clubExtraPlayerCandidates,
  currentSeason,
  emptyTeamWorkspace,
  rosterForSeason,
  rosterWithExtraPlayers,
  setCurrentSeason,
  updateSeasonDetails,
  upsertSeasonPlayer,
  upsertSeasonStaff,
} from "./seasonDomain";
import { updateExistingMatchMetadata } from "./matchMetadata";
import { LocalStorageAdapter } from "./matchPersistence";
import { LocalTeamRepository } from "./sync/localTeamRepository";
import { LocalMatchRepository } from "./sync/localMatchRepository";
import { InMemoryRemoteMatchRepository } from "./sync/remoteMatchRepository";
import { RemoteApplyResult } from "./sync/remoteMatchRepository";
import { RevisionedRemoteRepository, SyncCoordinator } from "./sync/syncCoordinator";
import { teamEntityKey, TeamSyncOperation } from "./sync/teamSyncTypes";
import { createLiveThreatEvent, replayMatch } from "./matchEngine";
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
    const key = teamEntityKey(operation.entityType, operation.entityId, operation.namespace);
    const current = this.documents.get(key);
    if (current?.operationId === operation.id) return { status: "ALREADY_APPLIED", revision: current.revision };
    if (current && JSON.stringify(current.payload) === JSON.stringify(operation.payload)) {
      return { status: "ALREADY_APPLIED", revision: current.revision };
    }
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

test("categoría propia vive en equipo-temporada, persiste y no contamina otro equipo", () => {
  let workspace = createTeamProfile(
    workspaceFixture(),
    { name: "Senior B" },
    { teamId: "senior-b", now: 5 },
  );
  workspace = createSeason(
    workspace,
    { label: "2026-27", category: "Juvenil División de Honor" },
    { seasonId: "season-category", now: 10 },
  );
  workspace = createSeason(
    workspace,
    { teamId: "senior-b", label: "2026-27", category: "Senior Preferente" },
    { seasonId: "season-category-b", now: 10 },
  );
  assert.equal(workspace.seasons[0].category, "Juvenil División de Honor");
  workspace = updateSeasonDetails(workspace, "season-category", { category: "Juvenil Preferente" }, 11);
  assert.equal(workspace.seasons[0].category, "Juvenil Preferente");
  assert.equal(workspace.seasons[0].revision, 1);
  assert.equal(workspace.seasons.find((season) => season.seasonId === "season-category-b")?.category, "Senior Preferente");
  const storage = new MemoryStorage();
  new LocalTeamRepository({ storage }).save(workspace);
  assert.equal(new LocalTeamRepository({ storage }).load(workspace.teamId).seasons[0].category, "Juvenil Preferente");
});

test("editar metadata mantiene matchId, eventos, coordenadas y horas de captura", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-edit", now: 2 });
  workspace = createSeason(workspace, { teamId: "senior-edit", label: "2026-27", category: "Senior" }, { seasonId: "season-edit-a", now: 3 });
  workspace = createSeason(workspace, { teamId: "senior-edit", label: "2027-28", category: "Senior" }, { seasonId: "season-edit-b", now: 4 });
  const base = createDraftMatch("match-001", { clubId: workspace.clubId, teamId: "senior-edit", seasonId: "season-edit-a", opponent: "Alzira", venue: "HOME", date: "2026-10-01", competitionType: "LEAGUE", matchday: 5 }, 10);
  const threat = createLiveThreatEvent({ id: "event-123", matchId: base.matchId, position: { period: 1, minute: 4, order: 1 }, side: "FOR", playerId: "p-2", origin: { x: 0.24, y: 0.71 }, outcome: "FUERA", phase: "TRANSITION", now: 12 });
  const session = { ...base, preparation: { ...base.preparation!, status: "FINISHED" as const }, matchFinished: true, events: [threat] };
  const edited = updateExistingMatchMetadata(session, workspace, { seasonId: "season-edit-b", opponent: "Elche", venue: "AWAY", date: "2026-10-03", time: "18:30", competitionType: "CUP", competition: "Copa Autonómica", matchday: 6, opponentCategory: "Senior Preferente" }, 20);
  assert.equal(edited.matchId, "match-001");
  assert.equal(edited.preparation?.status, "FINISHED");
  assert.equal(edited.preparation?.createdAt, 10);
  assert.equal(edited.preparation?.updatedAt, 20);
  assert.deepEqual(edited.events, session.events);
  assert.equal(edited.events[0].id, "event-123");
  assert.equal(edited.events[0].createdAt, 12);
  assert.deepEqual(edited.events[0].type === "threat_recorded" ? edited.events[0].origin : null, { x: 0.24, y: 0.71 });
  assert.deepEqual({ opponent: edited.preparation?.opponent, venue: edited.preparation?.venue, seasonId: edited.preparation?.seasonId, competitionType: edited.preparation?.competitionType, matchday: edited.preparation?.matchday, opponentCategory: edited.preparation?.opponentCategory }, { opponent: "Elche", venue: "AWAY", seasonId: "season-edit-b", competitionType: "CUP", matchday: 6, opponentCategory: "Senior Preferente" });
});

test("edición rechaza temporada ajena y partido eliminado sin tocar el original", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-safe", now: 2 });
  workspace = createSeason(workspace, { teamId: "senior-safe", label: "2026-27" }, { seasonId: "season-safe", now: 3 });
  workspace = createSeason(workspace, { teamId: workspace.teamId, label: "Legacy" }, { seasonId: "season-foreign", now: 4 });
  const base = createDraftMatch("match-safe", { clubId: workspace.clubId, teamId: "senior-safe", seasonId: "season-safe", opponent: "Rival", venue: "HOME", date: "2026-10-01" }, 10);
  assert.throws(() => updateExistingMatchMetadata(base, workspace, { seasonId: "season-foreign", opponent: "Otro", venue: "HOME", date: "2026-10-01" }), /temporada no pertenece/i);
  const deleted = { ...base, preparation: { ...base.preparation!, deletedAt: 11 } };
  assert.throws(() => updateExistingMatchMetadata(deleted, workspace, { opponent: "Otro", venue: "HOME", date: "2026-10-01" }), /eliminado/i);
  assert.equal(base.preparation?.opponent, "Rival");
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

test("portero natural siempre es elegible y la capacidad adicional solo aplica a jugadores de campo", () => {
  const naturalGoalkeeper = createMasterPlayer([], {
    fullName: "Portero Natural",
    displayName: "POR",
    number: 1,
    role: "FIELD",
    primaryPosition: "GOALKEEPER",
    canPlayGoalkeeper: false,
  }, { id: "natural-gk", now: 1 });
  const regularFieldPlayer = createMasterPlayer([naturalGoalkeeper], {
    fullName: "Jugador Campo",
    displayName: "Campo",
    number: 2,
    role: "FIELD",
    primaryPosition: "WINGER",
    canPlayGoalkeeper: false,
  }, { id: "regular-field", now: 2 });
  const alternateGoalkeeper = createMasterPlayer([naturalGoalkeeper, regularFieldPlayer], {
    fullName: "Portero Alternativo",
    displayName: "Alternativo",
    number: 3,
    role: "FIELD",
    primaryPosition: "FIXO",
    canPlayGoalkeeper: true,
  }, { id: "alternate-gk", now: 3 });

  assert.equal(naturalGoalkeeper.canPlayGoalkeeper, false);
  assert.equal(canPlayGoalkeeper(naturalGoalkeeper), true);
  assert.equal(playerSnapshot(naturalGoalkeeper).goalkeeperCapable, true);
  assert.equal(canPlayGoalkeeper(regularFieldPlayer), false);
  assert.equal(canPlayGoalkeeper(alternateGoalkeeper), true);

  const explicitFieldOverride: MasterPlayer = {
    ...regularFieldPlayer,
    role: "GOALKEEPER",
    canPlayGoalkeeper: false,
  };
  const legacyFieldGoalkeeper: MasterPlayer = {
    ...regularFieldPlayer,
    role: "GOALKEEPER",
    canPlayGoalkeeper: undefined,
  };
  assert.equal(canPlayGoalkeeper(explicitFieldOverride), false);
  assert.equal(canPlayGoalkeeper(legacyFieldGoalkeeper), true);

  const movedToField = updateMasterPlayer(
    [naturalGoalkeeper],
    naturalGoalkeeper.playerId,
    { primaryPosition: "WINGER", canPlayGoalkeeper: false },
    4,
  )[0];
  assert.equal(canPlayGoalkeeper(movedToField), false);
  const movedToGoal = updateMasterPlayer(
    [regularFieldPlayer],
    regularFieldPlayer.playerId,
    { primaryPosition: "GOALKEEPER" },
    5,
  )[0];
  assert.equal(canPlayGoalkeeper(movedToGoal), true);
});

test("portero natural sobrevive membresía, persistencia e inicio de partido", () => {
  const naturalGoalkeeper = createMasterPlayer([], {
    fullName: "Portero Persistente",
    displayName: "POR",
    number: 1,
    role: "FIELD",
    primaryPosition: "GOALKEEPER",
    canPlayGoalkeeper: false,
  }, { id: "persistent-natural-gk", now: 1 });
  const fieldPlayers = Array.from({ length: 5 }, (_, index) => createMasterPlayer(
    [naturalGoalkeeper],
    {
      fullName: `Campo ${index + 1}`,
      displayName: `C${index + 1}`,
      number: index + 2,
      role: "FIELD",
      primaryPosition: "WINGER",
      canPlayGoalkeeper: false,
    },
    { id: `persistent-field-${index + 1}`, now: index + 2 },
  ));
  let workspace = {
    ...emptyTeamWorkspace("cd-alameda", 1),
    players: [naturalGoalkeeper, ...fieldPlayers],
  };
  workspace = createSeason(
    workspace,
    { label: "2026-27", copyLegacyRoster: true },
    { seasonId: "natural-gk-season", now: 10 },
  );
  const seasonalRoster = rosterForSeason(workspace, "natural-gk-season");
  assert.equal(canPlayGoalkeeper(seasonalRoster.players[0]), true);

  const storage = new MemoryStorage();
  const repository = new LocalTeamRepository({ storage });
  repository.save(workspace);
  const reopened = repository.load("cd-alameda");
  const reopenedRoster = rosterForSeason(reopened, "natural-gk-season");
  assert.equal(canPlayGoalkeeper(reopenedRoster.players[0]), true);

  let session = createDraftMatch("natural-gk-start", {
    ...MATCH_SCOPE,
    seasonId: "natural-gk-season",
    opponent: "Rival",
    venue: "HOME",
    date: "2026-09-02",
  }, 20);
  for (const player of reopenedRoster.players.slice(0, 5)) {
    session = toggleCalledPlayer(session, reopenedRoster, player.playerId, 21);
    session = toggleStarter(session, reopenedRoster, player.playerId, 22);
  }
  session = selectStartingGoalkeeper(session, reopenedRoster, naturalGoalkeeper.playerId, 23);
  assert.equal(validateStartingLineup(session, reopenedRoster).valid, true);
  const started = startPreparedMatch(session, reopenedRoster, 24);
  const replay = replayMatch(started.players, started.events);
  assert.equal(replay.lineupValidation.goalkeeper.status, "PLAYER");
  assert.equal(replay.lineupValidation.goalkeeper.playerId, naturalGoalkeeper.playerId);
  assert.equal(replay.issues.length, 0);
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

test("payload remoto idéntico adopta la revisión y no crea un falso conflicto", async () => {
  const storage = new MemoryStorage(); let operation = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `equivalent-op-${++operation}` });
  const remote = new TeamRemote();
  const workspace = { ...workspaceFixture(), staff: [], players: [workspaceFixture().players[0]] };
  local.save(workspace);
  const playerOperation = local.getSyncState(workspace.teamId).outbox.find((item) => item.entityType === "PLAYER")!;
  const key = teamEntityKey(playerOperation.entityType, playerOperation.entityId, playerOperation.namespace);
  remote.documents.set(key, {
    revision: 7,
    payload: structuredClone(playerOperation.payload),
    operationId: "ack-perdido-en-otra-sesion",
  });

  await new SyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(workspace.teamId);

  const sync = local.getSyncState(workspace.teamId);
  assert.equal(sync.outbox.some((item) => item.id === playerOperation.id), false);
  assert.equal(sync.conflicts.length, 0);
  assert.equal(sync.knownRemoteRevisions[key], 7);
  assert.equal(remote.documents.get(key)?.operationId, "ack-perdido-en-otra-sesion");
});

test("recomprobar un conflicto solo lo cierra si local y nube ya son idénticos", async () => {
  const storage = new MemoryStorage(); let operation = 0;
  const local = new LocalTeamRepository({ storage, idFactory: () => `recheck-op-${++operation}` });
  const remote = new TeamRemote();
  const workspace = { ...workspaceFixture(), staff: [], players: [workspaceFixture().players[0]] };
  local.save(workspace);
  const playerOperation = local.getSyncState(workspace.teamId).outbox.find((item) => item.entityType === "PLAYER")!;
  const key = teamEntityKey(playerOperation.entityType, playerOperation.entityId, playerOperation.namespace);
  remote.documents.set(key, { revision: 3, payload: { remote: true }, operationId: "remote-change" });
  const coordinator = new SyncCoordinator(local, remote, { isOnline: () => true });
  await coordinator.syncMatch(workspace.teamId);
  assert.equal(local.getSummary(workspace.teamId).conflicts, 1);

  local.retryConflicts(workspace.teamId);
  await coordinator.syncMatch(workspace.teamId);
  let sync = local.getSyncState(workspace.teamId);
  assert.equal(sync.conflicts.length, 1, "una divergencia real sigue conservando ambas versiones");
  assert.deepEqual(sync.conflicts[0].remotePayload, { remote: true });

  remote.documents.set(key, { revision: 3, payload: structuredClone(playerOperation.payload), operationId: "remote-equivalent" });
  local.retryConflicts(workspace.teamId);
  await coordinator.syncMatch(workspace.teamId);
  sync = local.getSyncState(workspace.teamId);
  assert.equal(sync.outbox.some((item) => item.id === playerOperation.id), false);
  assert.equal(sync.conflicts.length, 0);
  assert.equal(sync.knownRemoteRevisions[key], 3);
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
  const payload = remote.documents.get(teamEntityKey("PLAYER", "p-2"))?.payload as MasterPlayer;
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
  assert.equal(queued[0].namespace, "CLUBS");
  const operationId = queued[0].id;
  const remote = new TeamRemote();
  await new SyncCoordinator(local, remote, { isOnline: () => true }).syncMatch("cd-alameda");
  assert.equal((remote.documents.get(teamEntityKey("TEAM_UNIT", "senior-sync"))?.payload as { deletedAt?: number }).deletedAt, 3);
  assert.equal(remote.documents.get(teamEntityKey("TEAM_UNIT", "senior-sync"))?.operationId, operationId);
  assert.equal(local.getSummary("cd-alameda").pending, 0);
});

test("registro multiclub recuerda currentClub y conserva IDs estables", () => {
  const storage = new MemoryStorage();
  const registry = defaultClubRegistry();
  const testsClub = createClubWorkspace({ name: "Club Pruebas", shortName: "TEST" }, { clubId: "club-tests", now: 10 });
  const next = { ...registry, clubIds: [...registry.clubIds, testsClub.clubId], currentClubId: testsClub.clubId };
  assert.equal(saveClubRegistry(next, storage), true);
  assert.deepEqual(loadClubRegistry(storage), next);
  assert.equal(createClubWorkspace({ name: "Otro" }, { clubId: "stable-id", now: 20 }).club.clubId, "stable-id");
  const local = new LocalTeamRepository({ storage, idFactory: () => "club-create-op" });
  local.save(testsClub);
  const clubOperation = local.getSyncState("club-tests").outbox.find((operation) => operation.entityType === "CLUB");
  assert.deepEqual([clubOperation?.id, clubOperation?.namespace, clubOperation?.entityId], ["club-create-op", "CLUBS", "club-tests"]);
  const archived = changeClubLifecycle(testsClub, "ARCHIVE", 30);
  assert.equal(archived.club.archivedAt, 30);
  assert.equal(changeClubLifecycle(archived, "REACTIVATE", 31).club.active, true);
});

test("identidades maestras quedan aisladas por club y se reutilizan entre equipos y temporadas", () => {
  let alameda = createTeamProfile(workspaceFixture(), { name: "Senior A" }, { teamId: "senior-a", now: 10 });
  alameda = createTeamProfile(alameda, { name: "Juvenil A" }, { teamId: "juvenil-a", now: 11 });
  alameda = createSeason(alameda, { teamId: "senior-a", label: "2026-27" }, { seasonId: "senior-26", now: 12 });
  alameda = createSeason(alameda, { teamId: "juvenil-a", label: "2026-27" }, { seasonId: "juvenil-26", now: 13 });
  alameda = upsertSeasonPlayer(alameda, "senior-26", "p-2", { number: 12, active: true }, 14);
  alameda = upsertSeasonPlayer(alameda, "juvenil-26", "p-2", { number: 7, active: true }, 15);
  assert.equal(alameda.players.filter((player) => player.playerId === "p-2").length, 1);
  assert.equal(alameda.seasonPlayers.filter((membership) => membership.playerId === "p-2").length, 2);
  const masterBefore = alameda.players.find((player) => player.playerId === "p-2");
  alameda = changeAdminLifecycle(alameda, "TEAM", "juvenil-a", "ARCHIVE", 16);
  alameda = changeAdminLifecycle(alameda, "SEASON", "juvenil-26", "ARCHIVE", 17);
  assert.deepEqual(alameda.players.find((player) => player.playerId === "p-2"), masterBefore);

  let testsClub = createClubWorkspace({ name: "Club Pruebas" }, { clubId: "club-tests", now: 20 });
  testsClub = { ...testsClub, players: [createMasterPlayer([], { fullName: "Persona Tests", displayName: "Tests", number: 4, role: "FIELD" }, { id: "tests-p-1", clubId: "club-tests", now: 21 })] };
  assert.deepEqual(clubExtraPlayerCandidates(testsClub).map((player) => player.playerId), ["tests-p-1"]);
  assert.equal(clubExtraPlayerCandidates(alameda).some((player) => player.playerId === "tests-p-1"), false);
  assert.throws(() => assertSeasonScope(alameda, "senior-a", "juvenil-26"), /temporada no pertenece/i);
});

test("Prepartido busca jugadores activos de todo el club sin duplicar por equipo o temporada", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior" }, { teamId: "senior-search", now: 10 });
  workspace = createTeamProfile(workspace, { name: "Juvenil" }, { teamId: "juvenil-search", now: 11 });
  workspace = createSeason(workspace, { teamId: "senior-search", label: "2026-27" }, { seasonId: "senior-search-season", now: 12 });
  workspace = createSeason(workspace, { teamId: "juvenil-search", label: "2026-27" }, { seasonId: "juvenil-search-season", now: 13 });
  workspace = upsertSeasonPlayer(workspace, "senior-search-season", "p-2", { active: true }, 14);
  workspace = upsertSeasonPlayer(workspace, "juvenil-search-season", "p-3", { active: true }, 15);
  workspace = upsertSeasonPlayer(workspace, "juvenil-search-season", "p-3", { number: 23, active: true }, 16);
  workspace = changeAdminLifecycle(workspace, "PLAYER", "p-4", "ARCHIVE", 17);

  const currentRosterIds = rosterForSeason(workspace, "senior-search-season")
    .players
    .filter((player) => player.active)
    .map((player) => player.playerId);
  const candidates = clubExtraPlayerCandidates(workspace, currentRosterIds);
  const candidateIds = candidates.map((player) => player.playerId);

  assert.equal(candidateIds.includes("p-2"), false);
  assert.equal(candidateIds.includes("p-3"), true);
  assert.equal(candidateIds.includes("p-4"), false);
  assert.equal(candidateIds.length, new Set(candidateIds).size);
  assert.equal(clubExtraPlayerCandidates(workspace, currentRosterIds, "J3").some((player) => player.playerId === "p-3"), true);
  assert.equal(clubExtraPlayerCandidates(workspace, currentRosterIds, "", true).some((player) => player.playerId === "p-4"), true);
});

test("archivar equipo o temporada y retirar membership no archiva la identidad maestra", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Juvenil" }, { teamId: "juvenil-safe", now: 1 });
  workspace = createSeason(workspace, { teamId: "juvenil-safe", label: "2026-27" }, { seasonId: "juvenil-safe-26", now: 2 });
  workspace = upsertSeasonPlayer(workspace, "juvenil-safe-26", "p-3", { active: true }, 3);
  const original = workspace.players.find((player) => player.playerId === "p-3")!;

  workspace = upsertSeasonPlayer(workspace, "juvenil-safe-26", "p-3", { active: false }, 4);
  workspace = changeAdminLifecycle(workspace, "SEASON", "juvenil-safe-26", "ARCHIVE", 5);
  workspace = changeAdminLifecycle(workspace, "TEAM", "juvenil-safe", "ARCHIVE", 6);

  assert.deepEqual(workspace.players.find((player) => player.playerId === "p-3"), original);
  assert.equal(clubPlayers(workspace).some((player) => player.playerId === "p-3"), true);
  assert.equal(clubExtraPlayerCandidates(workspace).some((player) => player.playerId === "p-3"), true);

  workspace = changeAdminLifecycle(workspace, "PLAYER", "p-3", "ARCHIVE", 7);
  assert.equal(clubPlayers(workspace).some((player) => player.playerId === "p-3"), false);
  assert.equal(clubPlayers(workspace, true).some((player) => player.playerId === "p-3"), true);
});

test("crear partido acepta Senior A legacy/canónico del club y mantiene rechazos estrictos", () => {
  let legacy = workspaceFixture();
  legacy = {
    ...legacy,
    team: { ...legacy.team, name: "CD Alameda Senior A", shortName: "SEN A", clubId: legacy.clubId },
  };
  legacy = createSeason(legacy, { teamId: legacy.teamId, label: "2026-27" }, { seasonId: "alameda-26", now: 10 });
  assert.doesNotThrow(() => assertSeasonScope(legacy, legacy.teamId, "alameda-26"));

  let canonical = createTeamProfile(workspaceFixture(), { name: "CD Alameda Senior A", shortName: "SEN A" }, { teamId: "senior-a-valid", now: 11 });
  canonical = createSeason(canonical, { teamId: "senior-a-valid", label: "2026-27" }, { seasonId: "senior-a-26", now: 12 });
  assert.doesNotThrow(() => assertSeasonScope(canonical, "senior-a-valid", "senior-a-26"));

  const foreign = {
    ...canonical,
    teams: canonical.teams.map((team) => team.teamId === "senior-a-valid" ? { ...team, clubId: "otro-club" } : team),
  };
  assert.throws(() => assertSeasonScope(foreign, "senior-a-valid", "senior-a-26"), /no pertenece al club actual/i);

  const archived = changeAdminLifecycle(canonical, "TEAM", "senior-a-valid", "ARCHIVE", 13);
  assert.throws(() => assertSeasonScope(archived, "senior-a-valid", "senior-a-26"), /no pertenece al club actual|no está activo/i);
});

test("temporadas archivadas y tombstones no reaparecen en operativa normal", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior" }, { teamId: "senior-filter-v2", now: 1 });
  workspace = createSeason(workspace, { teamId: "senior-filter-v2", label: "A" }, { seasonId: "season-a-filter", now: 2 });
  workspace = createSeason(workspace, { teamId: "senior-filter-v2", label: "B" }, { seasonId: "season-b-filter", now: 3 });
  workspace = changeAdminLifecycle(workspace, "SEASON", "season-a-filter", "ARCHIVE", 4);
  workspace = changeAdminLifecycle(workspace, "SEASON", "season-b-filter", "DELETE", 5);
  assert.deepEqual(workspace.seasons.filter((season) => isSeasonVisible(season)).map((season) => season.seasonId), []);
  assert.deepEqual(workspace.seasons.filter((season) => isSeasonVisible(season, true)).map((season) => season.seasonId), ["season-a-filter"]);
  const storage = new MemoryStorage();
  new LocalTeamRepository({ storage }).save(workspace);
  const reloaded = new LocalTeamRepository({ storage }).load("cd-alameda");
  assert.equal(reloaded.seasons.find((season) => season.seasonId === "season-b-filter")?.deletedAt, 5);
  assert.equal(reloaded.seasons.filter((season) => isSeasonVisible(season, true)).some((season) => season.seasonId === "season-b-filter"), false);
});

test("migración V3→V4 y sync V2→V3 conserva outbox conflictos revisiones e IDs", () => {
  const storage = new MemoryStorage();
  const workspace = workspaceFixture();
  const player = workspace.players.find((item) => item.playerId === "p-2")!;
  const member = workspace.staff[0];
  storage.setItem("alamedapp:team:v1:cd-alameda", JSON.stringify({
    storageVersion: 3,
    savedAt: 90,
    roster: workspace,
    sync: {
      schemaVersion: 2,
      outbox: [
        { id: "legacy-player-op", teamId: "cd-alameda", entityType: "PLAYER", entityId: player.playerId, kind: "UPSERT", payload: player, baseRevision: 4, clientUpdatedAt: 80, attempts: 2, status: "PENDING", nextAttemptAt: 0 },
        { id: "legacy-staff-conflict", teamId: "cd-alameda", entityType: "STAFF", entityId: member.staffId, kind: "UPSERT", payload: member, baseRevision: 2, clientUpdatedAt: 81, attempts: 1, status: "CONFLICT", nextAttemptAt: 0, errorKind: "CONFLICT" },
      ],
      knownRemoteRevisions: { "player:p-2": 4, "staff:staff-1": 2 },
      lastLocalMutationAt: 81,
      lastSyncedAt: 70,
      lastError: "Conflicto",
      lastErrorKind: "CONFLICT",
      conflicts: [{ operationId: "legacy-staff-conflict", entityKey: "staff:staff-1", detectedAt: 82, localPayload: member, remoteRevision: 3, remotePayload: { remote: true } }],
    },
  }));
  const repository = new LocalTeamRepository({ storage });
  const sync = repository.getSyncState("cd-alameda");
  assert.equal(sync.schemaVersion, 3);
  assert.deepEqual(sync.outbox.map((operation) => [operation.id, operation.namespace, operation.baseRevision, operation.status]), [
    ["legacy-player-op", "LEGACY_TEAMS", 4, "PENDING"],
    ["legacy-staff-conflict", "LEGACY_TEAMS", 2, "CONFLICT"],
  ]);
  assert.equal(sync.knownRemoteRevisions[teamEntityKey("PLAYER", "p-2", "LEGACY_TEAMS")], 4);
  assert.equal(sync.conflicts[0].entityKey, teamEntityKey("STAFF", "staff-1", "LEGACY_TEAMS"));
  assert.deepEqual(new LocalTeamRepository({ storage }).getSyncState("cd-alameda"), sync);
});

test("outbox legacy pendiente sobrevive offline reload y reconecta sin mezclarse con CLUBS", async () => {
  const storage = new MemoryStorage();
  const workspace = workspaceFixture();
  const player = workspace.players.find((item) => item.playerId === "p-2")!;
  storage.setItem("alamedapp:team:v1:cd-alameda", JSON.stringify({ storageVersion: 3, savedAt: 10, roster: workspace, sync: { schemaVersion: 2, outbox: [{ id: "pending-before-upgrade", teamId: "cd-alameda", entityType: "PLAYER", entityId: player.playerId, kind: "UPSERT", payload: player, baseRevision: 0, clientUpdatedAt: 9, attempts: 0, status: "PENDING", nextAttemptAt: 0 }], knownRemoteRevisions: {}, lastLocalMutationAt: 9, lastSyncedAt: null, lastError: null, lastErrorKind: null, conflicts: [] } }));
  const offlineReload = new LocalTeamRepository({ storage });
  assert.equal(offlineReload.getSyncState("cd-alameda").outbox[0].id, "pending-before-upgrade");
  assert.equal(offlineReload.getSyncState("cd-alameda").outbox[0].namespace, "LEGACY_TEAMS");
  const remote = new TeamRemote();
  await new SyncCoordinator(new LocalTeamRepository({ storage }), remote, { isOnline: () => true }).syncMatch("cd-alameda");
  assert.equal(new LocalTeamRepository({ storage }).getSummary("cd-alameda").pending, 0);
  assert.equal(remote.documents.get(teamEntityKey("PLAYER", player.playerId, "LEGACY_TEAMS"))?.operationId, "pending-before-upgrade");
});

test("asignar temporada legacy conserva identidad eventos revisión y procedencia", () => {
  let workspace = createTeamProfile(workspaceFixture(), { name: "Senior" }, { teamId: "senior-legacy", now: 1 });
  workspace = createSeason(workspace, { teamId: "senior-legacy", label: "2026-27" }, { seasonId: "season-legacy-target", now: 2 });
  const session = { ...createDraftMatch("legacy-assign", { teamId: "cd-alameda", seasonId: "temporary", opponent: "Rival", venue: "HOME", date: "2026-09-01" }, 3), reviewStatus: "IN_REVIEW" as const };
  const legacy = { ...session, preparation: { ...session.preparation!, seasonId: undefined }, events: [{ id: "legacy-event", provenance: "VIDEO" } as never] };
  const assigned = assignLegacyMatchSeason(legacy, workspace, "season-legacy-target", 4);
  assert.equal(assigned.matchId, legacy.matchId);
  assert.equal(assigned.preparation?.clubId, "cd-alameda");
  assert.equal(assigned.preparation?.teamId, "senior-legacy");
  assert.equal(assigned.preparation?.seasonId, "season-legacy-target");
  assert.equal(assigned.reviewStatus, "IN_REVIEW");
  assert.equal(assigned.events, legacy.events);
  assert.equal((assigned.events[0] as { provenance?: string }).provenance, "VIDEO");
});

test("partidos nuevos guardan club equipo temporada y legacy conserva cd-alameda sin inventar temporada", () => {
  const created = createDraftMatch("multiclub-match", { clubId: "club-tests", teamId: "tests-senior", seasonId: "tests-26", opponent: "Rival", venue: "HOME", date: "2026-09-02" }, 1);
  assert.deepEqual({ clubId: created.preparation?.clubId, teamId: created.preparation?.teamId, seasonId: created.preparation?.seasonId }, { clubId: "club-tests", teamId: "tests-senior", seasonId: "tests-26" });
  assert.equal(matchCatalogClubId({ matchId: "legacy", opponent: "Rival", venue: "HOME", date: "2025-01-01", status: "FINISHED", updatedAt: 1 }), "cd-alameda");
});

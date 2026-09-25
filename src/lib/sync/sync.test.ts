import assert from "node:assert/strict";
import test from "node:test";

import {
  createFoulEvent,
  createFoulCountAdjustmentEvent,
  createGameStateEvent,
  createLiveThreatEvent,
  createPossessionLostEvent,
  createRestartEvent,
  editEvent,
  replayMatch,
  restoreEvent,
  softDeleteEvent,
} from "../matchEngine";
import {
  loadMatchRecord,
  LocalStorageAdapter,
  matchStorageKey,
  saveMatchSession,
} from "../matchPersistence";
import { createSession } from "../../store/useMatchStore";
import {
  LocalMatchRepository,
  matchRemoteMetadata,
} from "./localMatchRepository";
import {
  classifyRemoteError,
  InMemoryRemoteMatchRepository,
  RemoteApplyResult,
  RemoteMatchRepository,
} from "./remoteMatchRepository";
import { MatchSyncCoordinator } from "./syncCoordinator";
import { hasUnreconciledMatchSyncState, matchTombstoneAlreadyApplied, migrateMatchSyncState, syncEntityKey } from "./syncTypes";
import {
  buildLocalVideoResolutionPayload,
  hasVideoOnlyMatchConflict,
  resolveLocalMatchVideoConflict,
} from "./matchVideoConflict";
import { createDraftMatch } from "../preMatch";
import { createSeason, emptyTeamWorkspace } from "../seasonDomain";
import { changeMatchLifecycle, createTeamProfile } from "../adminDomain";
import { updateExistingMatchMetadata } from "../matchMetadata";
import { createVideoSegment, upsertVideoEventOverride, upsertVideoSegment } from "../videoIndex";
import { resetRuntimeCaptureContextsForTests, setRuntimeCaptureContext } from "../captureLease";
import { buildDashboardV2, emptyDashboardScope } from "../dashboardV2";
import { listMatchCatalog, visibleMatchCatalog } from "../matchCatalog";
import { remoteEnvelopePayload, remoteMatchSession } from "../access/accessRemoteHydration";

class MemoryStorage implements LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function idFactory() {
  let next = 1;
  return () => `sync-op-${next++}`;
}

function protectMatchConflict(
  local: LocalMatchRepository,
  matchId: string,
  remoteRevision: number,
  remoteMatchPayload: unknown,
): void {
  const snapshots = local.getSyncState(matchId).outbox.map((operation) => ({
    entityType: operation.entityType,
    entityId: operation.entityId,
    exists: true,
    revision: operation.entityType === "MATCH" ? remoteRevision : 1,
    removed: operation.kind === "TOMBSTONE",
    payload: operation.entityType === "MATCH" ? remoteMatchPayload : operation.payload,
  }));
  local.reconcileRemoteSnapshots(matchId, snapshots);
}

test("repositorio local guarda sesión y outbox de forma atómica", () => {
  const storage = new MemoryStorage();
  let now = 100;
  const repository = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const session = createSession("offline-local-first");
  const first = repository.save(session);
  assert.equal(first.ok, true);
  assert.equal(repository.load(session.matchId)?.events.length, 1);
  assert.equal(repository.getSummary(session.matchId).pending, 2);

  const foul = createFoulEvent({
    id: "event-foul",
    matchId: session.matchId,
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 101,
  });
  now = 102;
  const withFoul = { ...session, events: [...session.events, foul] };
  repository.save(withFoul);
  const eventOperation = repository
    .getSyncState(session.matchId)
    .outbox.find((operation) => operation.entityId === foul.id);
  assert.equal(eventOperation?.kind, "UPSERT");
  assert.equal((eventOperation?.payload as typeof foul).id, foul.id);
  assert.equal((eventOperation?.payload as typeof foul).playerId, foul.playerId);
});

test("partido limpio baseRevision 0 sincroniza y un segundo navegador puede hidratarlo", async () => {
  const storageA = new MemoryStorage();
  const localA = new LocalMatchRepository({ storage: storageA, now: () => 100, idFactory: idFactory() });
  const session = createDraftMatch("new-match-visible-remotely", {
    clubId: "club-a", teamId: "team-a", seasonId: "season-a",
    opponent: "Rival", venue: "HOME", date: "2026-09-18",
  }, 100);
  assert.equal(localA.save(session).ok, true);
  const queued = localA.getSyncState(session.matchId).outbox;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].entityType, "MATCH");
  assert.equal(queued[0].baseRevision, 0);

  const remote = new InMemoryRemoteMatchRepository();
  await new MatchSyncCoordinator(localA, remote, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(localA.getSummary(session.matchId).pending, 0);
  assert.equal(localA.getSummary(session.matchId).errors, 0);
  const remoteDocument = remote.documents.get(`${session.matchId}:match`);
  assert.equal(remoteDocument?.revision, 1);

  const storageB = new MemoryStorage();
  const localB = new LocalMatchRepository({ storage: storageB, now: () => 200 });
  assert.equal(localB.hydrateRemote(session, { match: remoteDocument!.revision }), true);
  assert.equal(localB.load(session.matchId)?.preparation?.opponent, "Rival");
  assert.equal(localB.getSyncState(session.matchId).outbox.length, 0);
});

function synchronizedMatchWithEvent(matchId: string) {
  const draft = createDraftMatch(matchId, {
    clubId: "club-a", teamId: "team-a", seasonId: "season-a",
    opponent: "Rival", venue: "HOME", date: "2026-09-18",
  }, 100);
  const demo = createSession(matchId);
  return { ...demo, preparation: draft.preparation };
}

test("borrar un partido sincronizado encola un tombstone MATCH sin borrar sus eventos", async () => {
  const storage = new MemoryStorage();
  let now = 100;
  const local = new LocalMatchRepository({ storage, now: () => now, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const session = synchronizedMatchWithEvent("delete-aggregate");
  local.save(session);
  await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(session.matchId);
  const eventId = session.events[0].id;
  assert.equal(remote.documents.get(`${session.matchId}:event:${eventId}`)?.removed, false);

  now = 200;
  const deleted = changeMatchLifecycle(local.load(session.matchId)!, "DELETE", now);
  const saved = local.save(deleted);
  assert.equal(saved.ok, true);
  assert.equal(saved.ok && saved.pending, 1);
  const operation = local.getSyncState(session.matchId).outbox[0];
  assert.equal(operation.entityType, "MATCH");
  assert.equal(operation.kind, "TOMBSTONE");
  assert.equal((operation.payload as ReturnType<typeof matchRemoteMetadata>).preparation?.deletedAt, now);
  assert.equal(local.load(session.matchId)?.events.length, 1);

  await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(local.getSummary(session.matchId).pending, 0);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.removed, true);
  assert.equal(remote.documents.get(`${session.matchId}:event:${eventId}`)?.removed, false);
});

test("tombstone remoto oculta el agregado en un segundo navegador y no hidrata eventos huérfanos", async () => {
  const storageA = new MemoryStorage();
  const localA = new LocalMatchRepository({ storage: storageA, now: () => 100, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const session = synchronizedMatchWithEvent("delete-second-browser");
  localA.save(session);
  await new MatchSyncCoordinator(localA, remote, { isOnline: () => true }).syncMatch(session.matchId);
  localA.save(changeMatchLifecycle(localA.load(session.matchId)!, "DELETE", 200));
  await new MatchSyncCoordinator(localA, remote, { isOnline: () => true }).syncMatch(session.matchId);

  const root = remote.documents.get(`${session.matchId}:match`)!;
  assert.equal(root.removed, true);
  assert.equal(remoteEnvelopePayload({ removed: root.removed, payload: root.payload }), null);
  const storageB = new MemoryStorage();
  const localB = new LocalMatchRepository({ storage: storageB, now: () => 300 });
  // La hidratación real descarta la raíz removed y por ello ni siquiera
  // consulta/crea localmente su subcolección de eventos.
  assert.equal(localB.load(session.matchId), null);
  assert.deepEqual(visibleMatchCatalog(listMatchCatalog(storageB)), []);
});

test("borrado offline conserva tombstone y al reconectar vacía outbox sin duplicar", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 100, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const session = synchronizedMatchWithEvent("delete-offline-reconnect");
  local.save(session);
  await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(session.matchId);

  let online = false;
  local.save(changeMatchLifecycle(local.load(session.matchId)!, "DELETE", 200));
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => online });
  assert.equal((await coordinator.syncMatch(session.matchId)).pending, 1);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.removed, false);
  online = true;
  assert.equal((await coordinator.syncMatch(session.matchId)).pending, 0);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.removed, true);
  assert.equal(remote.documents.size, 2);
});

test("permission denegado no finge borrado remoto y conserva tombstone recuperable", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 100, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const session = synchronizedMatchWithEvent("delete-permission");
  local.save(session);
  await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(session.matchId);
  local.save(changeMatchLifecycle(local.load(session.matchId)!, "DELETE", 200));
  const denied: RemoteMatchRepository = {
    async apply() {
      throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    },
    async read(operation) { return remote.read(operation); },
  };
  const summary = await new MatchSyncCoordinator(local, denied, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(summary.errors, 1);
  assert.equal(summary.pending, 0);
  assert.equal(local.getSyncState(session.matchId).outbox[0].kind, "TOMBSTONE");
  assert.equal(local.load(session.matchId)?.preparation?.deletedAt, 200);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.removed, false);
});

test("cola anterior con deletedAt migra UPSERT a TOMBSTONE sin cambiar identidad ni revisión", () => {
  const migrated = migrateMatchSyncState({
    schemaVersion: 1,
    outbox: [{
      id: "existing-delete-operation",
      matchId: "legacy-delete",
      entityType: "MATCH",
      entityId: "legacy-delete",
      kind: "UPSERT",
      payload: { matchId: "legacy-delete", preparation: { deletedAt: 123 } },
      baseRevision: 7,
      clientUpdatedAt: 124,
      attempts: 1,
      status: "PENDING",
      nextAttemptAt: 0,
    }],
    knownRemoteRevisions: { "match:legacy-delete": 7 },
    lastLocalMutationAt: 124,
    lastSyncedAt: 120,
    lastError: null,
    lastErrorKind: null,
    conflicts: [],
  }, "legacy-delete");
  assert.equal(migrated.outbox.length, 1);
  assert.equal(migrated.outbox[0].id, "existing-delete-operation");
  assert.equal(migrated.outbox[0].kind, "TOMBSTONE");
  assert.equal(migrated.outbox[0].baseRevision, 7);
  assert.deepEqual(migrated.outbox[0].payload, {
    matchId: "legacy-delete", preparation: { deletedAt: 123 },
  });
});

test("TOMBSTONE base 14 adopta remoto 15 ya eliminado aunque deletedAt sea distinto sin escribir", async () => {
  const matchId = "delete-idempotent";
  const session = synchronizedMatchWithEvent(matchId);
  const localDeleted = changeMatchLifecycle(session, "DELETE", 1789810039631);
  const remoteDeleted = changeMatchLifecycle(session, "DELETE", 1789743327755);
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 1789810039631, idFactory: () => "local-delete-op" });
  local.hydrateRemote(session, {
    [syncEntityKey("MATCH", matchId)]: 14,
    [syncEntityKey("EVENT", session.events[0].id)]: 1,
  });
  local.save(localDeleted);
  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(matchId, "MATCH", matchId, 15, matchRemoteMetadata(remoteDeleted), true);
  const before = structuredClone(remote.documents.get(`${matchId}:match`));

  const summary = await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(matchId);

  assert.equal(summary.pending, 0);
  assert.equal(summary.conflicts, 0);
  assert.equal(local.getSyncState(matchId).outbox.length, 0);
  assert.equal(local.getSyncState(matchId).knownRemoteRevisions[syncEntityKey("MATCH", matchId)], 15);
  assert.equal(remote.applyCalls, 1);
  assert.deepEqual(remote.documents.get(`${matchId}:match`), before);
  assert.equal((remote.documents.get(`${matchId}:match`)?.payload as ReturnType<typeof matchRemoteMetadata>).preparation?.deletedAt, 1789743327755);
});

test("RECOMPROBAR limpia conflicto tombstone ya satisfecho y conserva oculto el partido", () => {
  const matchId = "delete-reconcile-idempotent";
  const session = synchronizedMatchWithEvent(matchId);
  const localDeleted = changeMatchLifecycle(session, "DELETE", 1789810039631);
  const remoteDeleted = matchRemoteMetadata(changeMatchLifecycle(session, "DELETE", 1789743327755));
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 1789810039631, idFactory: () => "conflicting-delete-op" });
  local.hydrateRemote(session, { [syncEntityKey("MATCH", matchId)]: 14 });
  local.save(localDeleted);
  const operation = local.getSyncState(matchId).outbox[0];
  local.markConflict(matchId, operation.id, 15, remoteDeleted);
  assert.equal(local.getSummary(matchId).conflicts, 1);

  const result = local.reconcileRemoteSnapshots(matchId, [{
    entityType: "MATCH",
    entityId: matchId,
    exists: true,
    revision: 15,
    removed: true,
    payload: remoteDeleted,
  }]);

  assert.deepEqual(result, { reconciled: 1, protected: 0, unchanged: 0 });
  assert.equal(local.getSyncState(matchId).outbox.length, 0);
  assert.equal(local.getSyncState(matchId).conflicts.length, 0);
  assert.equal(local.getSyncState(matchId).knownRemoteRevisions[syncEntityKey("MATCH", matchId)], 15);
  assert.equal(local.load(matchId)?.preparation?.deletedAt, 1789810039631);
  assert.deepEqual(visibleMatchCatalog(listMatchCatalog(storage)), []);

  const secondStorage = new MemoryStorage();
  const second = new LocalMatchRepository({ storage: secondStorage, now: () => 2 });
  second.hydrateRemote(remoteMatchSession(remoteDeleted, session.events), {
    [syncEntityKey("MATCH", matchId)]: 15,
  });
  assert.deepEqual(visibleMatchCatalog(listMatchCatalog(secondStorage)), []);
});

test("TOMBSTONE con remoto activo y revisión distinta sigue protegido como conflicto", async () => {
  const matchId = "delete-real-conflict";
  const session = synchronizedMatchWithEvent(matchId);
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 200, idFactory: () => "real-delete-op" });
  local.hydrateRemote(session, { [syncEntityKey("MATCH", matchId)]: 14 });
  local.save(changeMatchLifecycle(session, "DELETE", 200));
  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(matchId, "MATCH", matchId, 15, matchRemoteMetadata(session), false);

  const summary = await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(matchId);
  assert.equal(summary.conflicts, 1);
  assert.equal(local.getSyncState(matchId).outbox.length, 1);
  assert.equal(remote.documents.get(`${matchId}:match`)?.removed, false);
});

test("tombstone idempotente exige identidad completa del mismo agregado", () => {
  const operation = {
    matchId: "match-a",
    entityType: "MATCH" as const,
    entityId: "match-a",
    kind: "TOMBSTONE" as const,
  };
  assert.equal(matchTombstoneAlreadyApplied(operation, {
    entityType: "MATCH",
    entityId: "match-b",
    matchId: "match-b",
    payload: { matchId: "match-b", preparation: { deletedAt: 10 } },
  }), false);
  assert.equal(matchTombstoneAlreadyApplied(operation, {
    entityType: "MATCH",
    entityId: "match-a",
    matchId: "match-a",
    payload: { matchId: "match-a", preparation: { deletedAt: 10 } },
  }), true);
});

test("PERMISSION conservado solo se reactiva tras validación explícita sin cambiar identidad ni base", () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 100, idFactory: idFactory() });
  const session = createDraftMatch("permission-retry", {
    clubId: "club-a", teamId: "team-a", seasonId: "season-a",
    opponent: "Rival", venue: "HOME", date: "2026-09-18",
  }, 100);
  local.save(session);
  const claimed = local.claimNextOperation(session.matchId)!;
  local.markError(session.matchId, claimed.id, "PERMISSION", "Missing or insufficient permissions.", false);
  assert.equal(local.claimNextOperation(session.matchId), null);

  local.retryPermissionErrorsAfterAccessValidation(session.matchId);
  const retried = local.getSyncState(session.matchId).outbox[0];
  assert.equal(retried.id, claimed.id);
  assert.equal(retried.baseRevision, 0);
  assert.deepEqual(retried.payload, claimed.payload);
  assert.equal(retried.status, "PENDING");
});

test("ediciones pendientes se compactan conservando operationId y eventId", () => {
  const storage = new MemoryStorage();
  let now = 200;
  const repository = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const session = createSession("compact-before-sync");
  repository.save(session);
  const foul = createFoulEvent({
    id: "stable-event-id",
    matchId: session.matchId,
    position: { period: 1, minute: 2, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 201,
  });
  now = 202;
  repository.save({ ...session, events: [...session.events, foul] });
  const before = repository
    .getSyncState(session.matchId)
    .outbox.find((operation) => operation.entityId === foul.id);
  assert.ok(before);

  const editedEvents = editEvent(
    session.players,
    [...session.events, foul],
    foul.id,
    { minute: 5, foul: { side: "AGAINST", playerId: "p2" } },
    203,
  );
  now = 204;
  repository.save({ ...session, events: editedEvents });
  const after = repository
    .getSyncState(session.matchId)
    .outbox.filter((operation) => operation.entityId === foul.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.equal(after[0].entityId, foul.id);
  assert.equal((after[0].payload as typeof foul).minute, 5);
});

test("editar metadata offline encola solo el mismo MATCH y reintenta sin duplicarlo", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  let workspace = createTeamProfile(emptyTeamWorkspace("club-edit", 1), { name: "Senior A" }, { teamId: "team-edit", now: 2 });
  workspace = createSeason(workspace, { teamId: "team-edit", label: "2026-27" }, { seasonId: "season-edit", now: 3 });
  const session = createDraftMatch("match-edit-offline", { clubId: "club-edit", teamId: "team-edit", seasonId: "season-edit", opponent: "Alzira", venue: "HOME", date: "2026-10-01" }, 4);
  local.save(session);
  await coordinator.syncMatch(session.matchId);
  assert.equal(local.getSummary(session.matchId).pending, 0);

  const edited = updateExistingMatchMetadata(session, workspace, { opponent: "Elche", venue: "AWAY", date: "2026-10-02", competitionType: "CUP", matchday: 2 }, 5);
  local.save(edited);
  const queued = local.getSyncState(session.matchId).outbox;
  assert.deepEqual(queued.map((operation) => operation.entityType), ["MATCH"]);
  assert.equal(queued[0].entityId, session.matchId);
  const operationId = queued[0].id;

  const reopened = new LocalMatchRepository({ storage, idFactory: idFactory() });
  assert.equal(reopened.load(session.matchId)?.preparation?.opponent, "Elche");
  assert.equal(reopened.getSyncState(session.matchId).outbox[0].id, operationId);
  await new MatchSyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(reopened.getSummary(session.matchId).pending, 0);
  const documents = Array.from(remote.documents.keys()).filter((key) => key === `${session.matchId}:match`);
  assert.equal(documents.length, 1);
  assert.equal((remote.documents.get(`${session.matchId}:match`)?.payload as { preparation?: { opponent?: string } }).preparation?.opponent, "Elche");
});

test("soft delete viaja como UPSERT y undo previo a sync se compacta a tombstone", () => {
  const storage = new MemoryStorage();
  let now = 300;
  const repository = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const session = createSession("delete-offline");
  repository.save(session);
  const foul = createFoulEvent({
    id: "delete-me",
    matchId: session.matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 301,
  });
  const active = { ...session, events: [...session.events, foul] };
  now = 302;
  repository.save(active);
  const deleted = softDeleteEvent(session.players, active.events, foul.id, 303);
  now = 304;
  repository.save({ ...session, events: deleted });
  let operation = repository
    .getSyncState(session.matchId)
    .outbox.find((item) => item.entityId === foul.id);
  assert.equal(operation?.kind, "UPSERT");
  assert.equal((operation?.payload as typeof foul).deletedAt, 303);

  now = 305;
  repository.save(session);
  operation = repository
    .getSyncState(session.matchId)
    .outbox.find((item) => item.entityId === foul.id);
  assert.equal(operation?.kind, "TOMBSTONE");
});

test("outbox sobrevive cierre y reapertura del repositorio", () => {
  const storage = new MemoryStorage();
  const first = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const session = createSession("close-and-reopen");
  first.save(session);
  const operationIds = first
    .getSyncState(session.matchId)
    .outbox.map((operation) => operation.id);

  const reopened = new LocalMatchRepository({ storage, idFactory: idFactory() });
  assert.deepEqual(
    reopened.getSyncState(session.matchId).outbox.map((operation) => operation.id),
    operationIds,
  );
  assert.equal(reopened.load(session.matchId)?.events[0].id, session.events[0].id);
});

test("migración V1 es explícita, idempotente y genera baseline remoto", () => {
  const storage = new MemoryStorage();
  const session = createSession("legacy-storage-v1");
  assert.equal(saveMatchSession(session, storage, 400).ok, true);
  const key = matchStorageKey(session.matchId);
  const envelope = JSON.parse(storage.getItem(key) ?? "{}") as Record<string, unknown>;
  envelope.storageVersion = 1;
  delete envelope.sync;
  storage.setItem(key, JSON.stringify(envelope));

  const repository = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const loaded = repository.load(session.matchId);
  assert.ok(loaded);
  repository.save(loaded);
  const migrated = loadMatchRecord(session.matchId, storage);
  assert.equal(migrated?.storageVersion, 3);
  assert.equal(migrated?.sync.outbox.length, 2);

  repository.save(repository.load(session.matchId)!);
  assert.equal(repository.getSyncState(session.matchId).outbox.length, 2);
});

test("partido legacy sin seasonId se conserva sin inventar temporada", () => {
  const storage = new MemoryStorage();
  const repository = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const base = createSession("legacy-without-season");
  repository.save({
    ...base,
    preparation: {
      teamId: "cd-alameda",
      opponent: "Rival histórico",
      venue: "HOME",
      date: "2025-05-10",
      status: "FINISHED",
      calledPlayerIds: base.players.map((player) => player.id),
      starterPlayerIds: base.players.slice(0, 5).map((player) => player.id),
      selectedStaffIds: [],
      targetMinutes: {},
      createdAt: 1,
      updatedAt: 2,
    },
  });
  const loaded = repository.load(base.matchId)!;
  assert.equal(loaded.preparation?.teamId, "cd-alameda");
  assert.equal(loaded.preparation?.seasonId, undefined);
  assert.equal(loaded.preparation?.opponent, "Rival histórico");
});

test("los partidos demo permanecen exclusivamente locales", () => {
  const storage = new MemoryStorage();
  const repository = new LocalMatchRepository({ storage, idFactory: idFactory() });
  repository.save(createSession("prueba"));
  repository.save(createSession("prueba-porteria"));
  assert.equal(repository.getSummary("prueba").pending, 0);
  assert.equal(repository.getSummary("prueba-porteria").pending, 0);
});

test("sync incremental vacía outbox y mantiene un documento por eventId", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  const session = createSession("normal-sync");
  const foul = createFoulEvent({
    id: "same-event-id",
    matchId: session.matchId,
    position: { period: 1, minute: 2, order: 1 },
    side: "FOR",
    playerId: "p1",
  });
  local.save({ ...session, events: [...session.events, foul] });
  await coordinator.syncMatch(session.matchId);
  assert.equal(local.getSummary(session.matchId).pending, 0);
  assert.equal(local.getSummary(session.matchId).errors, 0);
  assert.ok(remote.documents.has(`${session.matchId}:event:${foul.id}`));
  assert.equal(
    Array.from(remote.documents.keys()).filter((key) => key.endsWith(`event:${foul.id}`)).length,
    1,
  );
});

test("una notificación síncrona durante sync reutiliza la ejecución activa", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  const session = createSession("sync-reentrant-subscriber");
  local.save(session);
  const unsubscribe = local.subscribe(session.matchId, () => {
    void coordinator.syncMatch(session.matchId);
  });

  await coordinator.syncMatch(session.matchId);
  unsubscribe();

  assert.equal(local.getSummary(session.matchId).pending, 0);
  assert.equal(local.getSummary(session.matchId).syncing, 0);
  assert.equal(remote.applyCalls, 2);
});

test("una edición durante una operación SYNCING hereda la nueva revisión sin conflicto propio", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const inner = new InMemoryRemoteMatchRepository();
  let holdNext = false;
  let release: (() => void) | undefined;
  let reached: (() => void) | undefined;
  const gate = () => new Promise<void>((resolve) => { release = resolve; });
  const claimed = new Promise<void>((resolve) => { reached = resolve; });
  const remote = {
    async apply(operation: Parameters<InMemoryRemoteMatchRepository["apply"]>[0]) {
      if (holdNext) {
        holdNext = false;
        reached?.();
        await gate();
      }
      return inner.apply(operation);
    },
  };
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const base = createSession("edit-while-syncing");
  local.save(base);
  await coordinator.syncMatch(base.matchId);

  holdNext = true;
  local.save({ ...base, reviewStatus: "IN_REVIEW", reviewRevision: 1 });
  const running = coordinator.syncMatch(base.matchId);
  await claimed;
  local.save({
    ...base,
    reviewStatus: "VALIDATED",
    reviewRevision: 2,
    reviewValidatedAt: 300,
  });
  release?.();
  await running;
  await coordinator.syncMatch(base.matchId);

  assert.equal(local.getSummary(base.matchId).conflicts, 0);
  assert.equal(local.getSummary(base.matchId).pending, 0);
  assert.equal(inner.documents.get(`${base.matchId}:match`)?.revision, 3);
  assert.equal(
    (inner.documents.get(`${base.matchId}:match`)?.payload as { reviewStatus?: string }).reviewStatus,
    "VALIDATED",
  );
});

test("partido limpio en una sesión admite capturas consecutivas sin conflictos", async () => {
  const storage = new MemoryStorage();
  let now = 1_000;
  const local = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  let session = createSession("clean-single-recorder");

  local.save(session);
  await coordinator.syncMatch(session.matchId);

  for (let index = 1; index <= 4; index += 1) {
    now += 1;
    const event = createFoulEvent({
      id: `single-recorder-event-${index}`,
      matchId: session.matchId,
      position: { period: 1, minute: index, order: 1 },
      side: index % 2 === 0 ? "AGAINST" : "FOR",
      playerId: `p${index}`,
      now,
    });
    session = {
      ...session,
      minute: index,
      periodMinutes: { 1: index, 2: 0 },
      events: [...session.events, event],
    };
    local.save(session);
    await coordinator.syncMatch(session.matchId);
  }

  const summary = local.getSummary(session.matchId);
  assert.equal(summary.conflicts, 0);
  assert.equal(summary.pending, 0);
  assert.equal(summary.syncing, 0);
  assert.equal(summary.errors, 0);
  assert.equal(remote.documents.size, 6);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.revision, 5);
});

test("varias ediciones locales de una entidad en conflicto conservan un único conflicto", async () => {
  const storage = new MemoryStorage();
  let now = 2_000;
  const local = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  let session = createSession("contaminated-match-id");
  remote.seed(
    session.matchId,
    "MATCH",
    session.matchId,
    1,
    { ...matchRemoteMetadata(session), remoteBaseline: true },
  );

  local.save(session);
  await coordinator.syncMatch(session.matchId);
  assert.equal(local.getSummary(session.matchId).conflicts, 1);

  for (let minute = 1; minute <= 4; minute += 1) {
    now += 1;
    session = {
      ...session,
      minute,
      periodMinutes: { 1: minute, 2: 0 },
    };
    local.save(session);
    await coordinator.syncMatch(session.matchId);
  }

  const state = local.getSyncState(session.matchId);
  assert.equal(state.outbox.filter((item) => item.status === "CONFLICT").length, 1);
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].entityKey, "match");
  assert.equal((state.conflicts[0].localPayload as { minute: number }).minute, 4);
});

test("migración consolida conflictos legacy duplicados sin perder el payload local más reciente", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  const session = createSession("legacy-duplicate-conflicts");
  remote.seed(session.matchId, "MATCH", session.matchId, 1, { remote: true });
  local.save(session);
  await coordinator.syncMatch(session.matchId);

  const original = local.getSyncState(session.matchId);
  const operation = original.outbox.find((item) => item.status === "CONFLICT");
  const conflict = original.conflicts[0];
  assert.ok(operation);
  assert.ok(conflict);
  const legacy = {
    ...original,
    outbox: [1, 2, 3, 4].map((minute) => ({
      ...operation,
      id: `legacy-conflict-${minute}`,
      clientUpdatedAt: minute,
      payload: { ...operation.payload, minute },
    })),
    conflicts: [1, 2, 3, 4].map((minute) => ({
      ...conflict,
      operationId: `legacy-conflict-${minute}`,
      localPayload: { ...operation.payload, minute },
    })),
  };

  const migrated = migrateMatchSyncState(legacy, session.matchId);
  assert.equal(migrated.outbox.length, 1);
  assert.equal(migrated.conflicts.length, 1);
  assert.equal(migrated.outbox[0].id, "legacy-conflict-4");
  assert.equal((migrated.conflicts[0].localPayload as { minute: number }).minute, 4);
});

test("ACK perdido reintenta el mismo operationId sin duplicar el remoto", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  remote.failAfterApplyOnce = true;
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  const session = createSession("lost-ack");
  local.save(session);
  const originalId = local.getSyncState(session.matchId).outbox[0].id;
  await coordinator.syncMatch(session.matchId);
  const failed = local.getSyncState(session.matchId).outbox[0];
  assert.equal(failed.id, originalId);
  assert.equal(failed.status, "ERROR");

  await coordinator.retryMatch(session.matchId);
  assert.equal(local.getSummary(session.matchId).pending, 0);
  assert.equal(local.getSummary(session.matchId).errors, 0);
  assert.equal(remote.documents.size, 2);
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.revision, 1);
});

test("offline, cierre y reapertura conservan datos y sincronizan al reconectar", async () => {
  const storage = new MemoryStorage();
  let online = false;
  const firstLocal = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const firstCoordinator = new MatchSyncCoordinator(firstLocal, remote, {
    isOnline: () => online,
  });
  const session = createSession("offline-reopen-sync");
  const foul = createFoulEvent({
    id: "offline-foul",
    matchId: session.matchId,
    position: { period: 1, minute: 7, order: 1 },
    side: "AGAINST",
    playerId: "p2",
  });
  firstLocal.save({ ...session, minute: 7, periodMinutes: { 1: 7, 2: 0 }, events: [...session.events, foul] });
  await firstCoordinator.syncMatch(session.matchId);
  assert.equal(firstLocal.getSummary(session.matchId).pending, 3);
  assert.equal(remote.documents.size, 0);

  const reopenedLocal = new LocalMatchRepository({ storage, idFactory: idFactory() });
  assert.equal(reopenedLocal.load(session.matchId)?.events.length, 2);
  assert.equal(reopenedLocal.getSummary(session.matchId).pending, 3);
  online = true;
  const reopenedCoordinator = new MatchSyncCoordinator(reopenedLocal, remote, {
    isOnline: () => online,
  });
  await reopenedCoordinator.syncMatch(session.matchId);
  assert.equal(reopenedLocal.getSummary(session.matchId).pending, 0);
  assert.equal(remote.documents.size, 3);
});

test("revisión y procedencia sobreviven offline, reapertura y sync", async () => {
  const storage = new MemoryStorage();
  let online = false;
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const base = createSession("review-offline-sync");
  const reviewedThreat = createLiveThreatEvent({
    id: "reviewed-threat",
    matchId: base.matchId,
    position: { period: 2, minute: 12, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.4, y: 0.4 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    provenance: "MANUAL_REVIEW",
  });
  const session = {
    ...base,
    period: 2 as const,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
    reviewStatus: "VALIDATED" as const,
    reviewRevision: 2,
    reviewStartedAt: 100,
    reviewValidatedAt: 200,
    reviewReopenedAt: 150,
    events: [...base.events, reviewedThreat],
  };
  local.save(session);
  await new MatchSyncCoordinator(local, remote, { isOnline: () => online }).syncMatch(session.matchId);

  const reopened = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const loaded = reopened.load(session.matchId)!;
  assert.equal(loaded.reviewStatus, "VALIDATED");
  assert.equal(loaded.reviewRevision, 2);
  assert.equal(loaded.reviewValidatedAt, 200);
  assert.equal(loaded.events.find((event) => event.id === reviewedThreat.id)?.provenance, "MANUAL_REVIEW");
  assert.ok(reopened.getSummary(session.matchId).pending > 0);

  online = true;
  await new MatchSyncCoordinator(reopened, remote, { isOnline: () => online }).syncMatch(session.matchId);
  const remoteMetadata = remote.documents.get(`${session.matchId}:match`)?.payload as {
    reviewStatus?: string;
    reviewRevision?: number;
    reviewValidatedAt?: number;
  };
  const remoteEvent = remote.documents.get(`${session.matchId}:event:${reviewedThreat.id}`)?.payload as typeof reviewedThreat;
  assert.equal(remoteMetadata.reviewStatus, "VALIDATED");
  assert.equal(remoteMetadata.reviewRevision, 2);
  assert.equal(remoteMetadata.reviewValidatedAt, 200);
  assert.equal(remoteEvent.provenance, "MANUAL_REVIEW");
  assert.equal(reopened.getSummary(session.matchId).pending, 0);
});

test("postpartido P2 conserva revisiones remotas y permite revisión retroactiva sin conflictos", async () => {
  const storage = new MemoryStorage();
  let now = 1_000;
  const local = new LocalMatchRepository({
    storage,
    now: () => now,
    idFactory: idFactory(),
  });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, {
    isOnline: () => true,
  });
  const base = createSession("finished-p2-review-no-conflicts");
  const liveThreat = createLiveThreatEvent({
    id: "live-before-review",
    matchId: base.matchId,
    position: { period: 2, minute: 8, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.35, y: 0.45 },
    outcome: "FUERA",
    phase: "TRANSITION",
    provenance: "LIVE",
    now: 900,
  });
  const live = {
    ...base,
    period: 2,
    minute: 12,
    periodMinutes: { 1: 20, 2: 12 },
    closedPeriods: [1],
    events: [...base.events, liveThreat],
  };
  local.save(live);
  await coordinator.syncMatch(base.matchId);

  now += 1;
  const finished = {
    ...live,
    minute: 20,
    periodMinutes: { 1: 20, 2: 20 },
    closedPeriods: [1, 2],
    matchFinished: true,
    reviewStatus: "NOT_REVIEWED" as const,
  };
  local.save(finished);
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);
  assert.equal(local.getSummary(base.matchId).pending, 0);

  // A: abrir Postpartido sobre P2 no invalida el envelope ni pierde revisiones.
  const revisionsBeforeReview = local.getSyncState(base.matchId).knownRemoteRevisions;
  now += 1;
  let reviewing = {
    ...finished,
    reviewPeriod: 2,
    reviewMinute: 20,
    reviewStatus: "IN_REVIEW" as const,
    reviewStartedAt: now,
  };
  local.save(reviewing);
  assert.ok(local.load(base.matchId));
  assert.deepEqual(
    local.getSyncState(base.matchId).knownRemoteRevisions,
    revisionsBeforeReview,
  );
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);
  assert.equal(local.getSummary(base.matchId).pending, 0);

  // B: un evento retroactivo nace en revisión sin alterar la procedencia LIVE previa.
  now += 1;
  const reviewedOne = createLiveThreatEvent({
    id: "manual-review-one",
    matchId: base.matchId,
    position: { period: 2, minute: 10, order: 1 },
    side: "AGAINST",
    origin: { x: 0.55, y: 0.35 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    provenance: "MANUAL_REVIEW",
    now,
  });
  reviewing = { ...reviewing, events: [...reviewing.events, reviewedOne] };
  local.save(reviewing);
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);

  // C: varias altas consecutivas conservan baseRevision por entidad.
  const reviewedMany = [11, 12, 13].map((minute, index) =>
    createFoulEvent({
      id: `manual-review-foul-${index + 1}`,
      matchId: base.matchId,
      position: { period: 2, minute, order: 1 },
      side: index % 2 === 0 ? "FOR" : "AGAINST",
      playerId: index % 2 === 0 ? "p2" : null,
      provenance: "MANUAL_REVIEW",
      now: now + index + 1,
    }),
  );
  now += 4;
  reviewing = { ...reviewing, events: [...reviewing.events, ...reviewedMany] };
  local.save(reviewing);
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);

  // D: editar una entidad ya sincronizada usa su revisión remota conocida.
  now += 1;
  reviewing = {
    ...reviewing,
    events: editEvent(
      reviewing.players,
      reviewing.events,
      reviewedOne.id,
      { minute: 9 },
      now,
    ),
  };
  local.save(reviewing);
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);

  // E: soft delete y restore actualizan el mismo documento sin sobrescritura silenciosa.
  now += 1;
  reviewing = {
    ...reviewing,
    events: softDeleteEvent(
      reviewing.players,
      reviewing.events,
      reviewedMany[0].id,
      now,
    ),
  };
  local.save(reviewing);
  await coordinator.syncMatch(base.matchId);
  assert.equal(local.getSummary(base.matchId).conflicts, 0);

  now += 1;
  reviewing = {
    ...reviewing,
    events: restoreEvent(
      reviewing.players,
      reviewing.events,
      reviewedMany[0].id,
      now,
    ),
  };
  local.save(reviewing);
  await coordinator.syncMatch(base.matchId);

  const finalSummary = local.getSummary(base.matchId);
  const remoteMetadata = remote.documents.get(`${base.matchId}:match`)?.payload as {
    matchFinished: boolean;
    reviewStatus?: string;
  };
  const remoteLive = remote.documents.get(
    `${base.matchId}:event:${liveThreat.id}`,
  )?.payload as typeof liveThreat;
  const remoteReviewed = remote.documents.get(
    `${base.matchId}:event:${reviewedOne.id}`,
  )?.payload as typeof reviewedOne;
  assert.equal(finalSummary.conflicts, 0);
  assert.equal(finalSummary.pending, 0);
  assert.equal(remoteMetadata.matchFinished, true);
  assert.equal(remoteMetadata.reviewStatus, "IN_REVIEW");
  assert.equal(remoteLive.provenance, "LIVE");
  assert.equal(remoteReviewed.provenance, "MANUAL_REVIEW");
  assert.equal(remoteReviewed.minute, 9);
  assert.equal(
    (remote.documents.get(`${base.matchId}:event:${reviewedMany[0].id}`)?.payload as typeof reviewedMany[number]).deletedAt,
    null,
  );
});

test("crear y editar dos veces offline sincroniza solo la versión final", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("edit-before-sync");
  const foul = createFoulEvent({
    id: "edited-offline",
    matchId: session.matchId,
    position: { period: 1, minute: 1, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 10,
  });
  local.save({ ...session, events: [...session.events, foul] });
  const once = editEvent(session.players, [...session.events, foul], foul.id, { minute: 4 }, 11);
  local.save({ ...session, events: once });
  const twice = editEvent(session.players, once, foul.id, { minute: 6 }, 12);
  local.save({ ...session, events: twice });
  assert.equal(
    local.getSyncState(session.matchId).outbox.filter((item) => item.entityId === foul.id).length,
    1,
  );
  await coordinator.syncMatch(session.matchId);
  const remoteEvent = remote.documents.get(`${session.matchId}:event:${foul.id}`)?.payload as typeof foul;
  assert.equal(remoteEvent.minute, 6);
  assert.equal(remoteEvent.updatedAt, 12);
});

test("conflicto conserva payload local y remoto sin sobrescribir", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("conflict-detection");
  local.save(session);
  remote.seed(session.matchId, "MATCH", session.matchId, 3, { remote: "newer" });
  await coordinator.syncMatch(session.matchId);
  const state = local.getSyncState(session.matchId);
  assert.equal(state.outbox[0].status, "CONFLICT");
  assert.equal(state.conflicts.length, 1);
  assert.deepEqual(state.conflicts[0].remotePayload, { remote: "newer" });
  assert.equal(remote.documents.get(`${session.matchId}:match`)?.revision, 3);
});

test("secuencia A→B→C, periodos y replay sobreviven persistencia y sync", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("causal-period-sync");
  const root = createLiveThreatEvent({
    id: "threat-a",
    matchId: session.matchId,
    position: { period: 1, minute: 19, order: 1 },
    side: "FOR",
    playerId: "p1",
    origin: { x: 0.3, y: 0.5 },
    outcome: "FUERA",
    phase: "TRANSITION",
    sequenceId: "sequence-a",
  });
  const second = createLiveThreatEvent({
    id: "threat-b",
    matchId: session.matchId,
    position: { period: 1, minute: 19, order: 2 },
    side: "FOR",
    playerId: "p2",
    origin: { x: 0.5, y: 0.5 },
    outcome: "PARADA",
    phase: "TRANSITION",
    sequenceId: "sequence-a",
    parentEventId: root.id,
  });
  const third = createLiveThreatEvent({
    id: "threat-c",
    matchId: session.matchId,
    position: { period: 1, minute: 19, order: 3 },
    side: "FOR",
    playerId: "p3",
    origin: { x: 0.6, y: 0.5 },
    outcome: "FUERA",
    phase: "TRANSITION",
    sequenceId: "sequence-a",
    parentEventId: second.id,
  });
  const complete = {
    ...session,
    period: 2,
    minute: 3,
    periodMinutes: { 1: 20, 2: 3 },
    closedPeriods: [1],
    periodCloseSnapshots: { 1: 19 },
    reviewPeriod: 1,
    reviewMinute: 19,
    events: [...session.events, root, second, third],
  };
  const replayBefore = replayMatch(complete.players, complete.events, {
    currentClock: { period: 2, minute: 3 },
  });
  local.save(complete);
  const reopened = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const loaded = reopened.load(session.matchId)!;
  const replayAfter = replayMatch(loaded.players, loaded.events, {
    currentClock: { period: 2, minute: 3 },
  });
  assert.deepEqual(replayAfter.score, replayBefore.score);
  assert.deepEqual(replayAfter.playerMinutes, replayBefore.playerMinutes);
  await coordinator.syncMatch(session.matchId);
  const remoteThird = remote.documents.get(`${session.matchId}:event:${third.id}`)?.payload as typeof third;
  assert.equal(remoteThird.sequenceId, "sequence-a");
  assert.equal(remoteThird.parentEventId, second.id);
  const metadata = remote.documents.get(`${session.matchId}:match`)?.payload as { activePeriod: number; reviewPeriod?: number };
  assert.equal(metadata.activePeriod, 2);
  assert.equal(metadata.reviewPeriod, 1);
});

test("soft delete y restore posteriores a sync actualizan el mismo documento", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("remote-soft-restore");
  const foul = createFoulEvent({
    id: "remote-soft-event",
    matchId: session.matchId,
    position: { period: 1, minute: 3, order: 1 },
    side: "FOR",
    playerId: "p1",
    now: 20,
  });
  const active = { ...session, events: [...session.events, foul] };
  local.save(active);
  await coordinator.syncMatch(session.matchId);

  const deletedEvents = softDeleteEvent(session.players, active.events, foul.id, 21);
  local.save({ ...session, events: deletedEvents });
  await coordinator.syncMatch(session.matchId);
  const key = `${session.matchId}:event:${foul.id}`;
  assert.equal((remote.documents.get(key)?.payload as typeof foul).deletedAt, 21);
  assert.equal(remote.documents.get(key)?.removed, false);

  const restoredEvents = restoreEvent(session.players, deletedEvents, foul.id, 22);
  local.save({ ...session, events: restoredEvents });
  await coordinator.syncMatch(session.matchId);
  assert.equal((remote.documents.get(key)?.payload as typeof foul).deletedAt, null);
  assert.equal(remote.documents.get(key)?.revision, 3);
});

test("falta genérica conserva playerId null en outbox, reload y remoto", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("generic-foul-sync");
  const foul = createFoulEvent({
    id: "generic-foul-remote",
    matchId: session.matchId,
    position: { period: 1, minute: 6, order: 1 },
    side: "AGAINST",
    playerId: null,
  });
  local.save({ ...session, events: [...session.events, foul] });
  const pendingPayload = local.getSyncState(session.matchId).outbox.find(
    (operation) => operation.entityId === foul.id,
  )?.payload as typeof foul;
  assert.equal(pendingPayload.playerId, null);
  assert.equal(local.load(session.matchId)?.events.find((event) => event.id === foul.id)?.type, "foul_recorded");
  await coordinator.syncMatch(session.matchId);
  const remotePayload = remote.documents.get(`${session.matchId}:event:${foul.id}`)?.payload as typeof foul;
  assert.equal(remotePayload.playerId, null);
  assert.equal(local.getSummary(session.matchId).pending, 0);
});

test("GoalTarget y pendingReview llegan intactos al documento remoto", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("goal-target-sync");
  const threat = {
    ...createLiveThreatEvent({
      id: "defensive-spatial",
      matchId: session.matchId,
      position: { period: 1, minute: 8, order: 1 },
      side: "AGAINST",
      origin: { x: 0.7, y: 0.25 },
      outcome: "PARADA",
      phase: "POSITIONAL",
      defensive: {
        version: 2,
        goalTarget: { geometryVersion: 2, x: 0.3, y: 0.65 },
        goalkeeper: { status: "PLAYER", playerId: "p5" },
        keeperBodyPart: "LEFT_LEG_FOOT",
        saveOutcome: "REBOUND",
      },
    }),
    pendingReview: true,
  };
  local.save({ ...session, events: [...session.events, threat] });
  await coordinator.syncMatch(session.matchId);
  const payload = remote.documents.get(`${session.matchId}:event:${threat.id}`)?.payload as typeof threat;
  assert.equal(payload.pendingReview, true);
  assert.deepEqual(payload.defensive?.goalTarget, threat.defensive?.goalTarget);
  assert.equal(payload.defensive?.saveOutcome, "REBOUND");
});

test("eventos Directo V2 sobreviven offline reload y sincronizan por el mismo ID", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("directo-v2-sync");
  const events = [
    ...session.events,
    createRestartEvent({ id: "restart-sync", matchId: session.matchId, position: { period: 1, minute: 4, order: 1 }, side: "FOR", restart: "CORNER", spatialSide: "TOP" }),
    createFoulCountAdjustmentEvent({ id: "adjust-sync", matchId: session.matchId, position: { period: 1, minute: 5, order: 1 }, side: "AGAINST", delta: 1 }),
    createGameStateEvent({ id: "pj-rival-sync", matchId: session.matchId, position: { period: 1, minute: 6, order: 1 }, state: "FLYING_GOALKEEPER", active: true, side: "AGAINST" }),
    createPossessionLostEvent({ id: "loss-sync", matchId: session.matchId, position: { period: 1, minute: 7, order: 1 }, playerId: "p1", now: 7 }),
  ];
  local.save({ ...session, events });
  assert.equal(local.load(session.matchId)?.events.length, events.length);
  assert.ok(local.getSummary(session.matchId).pending > 0);
  await coordinator.syncMatch(session.matchId);
  for (const id of ["restart-sync", "adjust-sync", "pj-rival-sync", "loss-sync"]) {
    assert.equal((remote.documents.get(`${session.matchId}:event:${id}`)?.payload as { id?: string })?.id, id);
  }
  assert.equal(local.getSummary(session.matchId).pending, 0);
});

test("segmentos, verificaciones y clips Video Lab viajan como metadata MATCH a un segundo navegador", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const remote = new InMemoryRemoteMatchRepository();
  const coordinator = new MatchSyncCoordinator(local, remote, { isOnline: () => true });
  const session = createSession("video-metadata-sync");
  local.save(session);
  await coordinator.syncMatch(session.matchId);
  const segment = createVideoSegment({ id: "video-1", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 10 });
  const indexed = upsertVideoSegment(session, { ...segment, anchors: [{ id: "anchor-1", eventId: session.events[0].id, videoSecond: 20 }] });
  const immutableEvents = structuredClone(indexed.events);
  const withVideo = { ...upsertVideoEventOverride(indexed, { eventId: session.events[0].id, segmentId: segment.id, syncSegmentId: `${segment.id}:P1`, videoSecond: 17, status: "VERIFIED", timeSource: "manual", now: 11 }), videoAnalysisClips: [{ id: "clip-sync", clubId: "club", matchId: session.matchId, segmentId: `${segment.id}:P1`, videoId: "abcdefghijk", referenceSecond: 20, startSecond: 17, endSecond: 26, tags: ["presión"], playerIds: [session.players[0].id], createdAt: 12, updatedAt: 12 }] };
  assert.deepEqual(withVideo.events, immutableEvents);
  local.save(withVideo);
  const queued = local.getSyncState(session.matchId).outbox;
  assert.deepEqual(queued.map((operation) => operation.entityType), ["MATCH"]);
  assert.equal((queued[0].payload as ReturnType<typeof matchRemoteMetadata>).videoSegments?.[0].anchors[0].eventId, session.events[0].id);
  assert.equal((queued[0].payload as ReturnType<typeof matchRemoteMetadata>).videoEventOverrides?.[0].videoSecond, 17);
  assert.equal((queued[0].payload as ReturnType<typeof matchRemoteMetadata>).videoAnalysisClips?.[0].id, "clip-sync");
  await coordinator.syncMatch(session.matchId);
  const remotePayload = remote.documents.get(`${session.matchId}:match`)?.payload as ReturnType<typeof matchRemoteMetadata>;
  assert.equal(remotePayload.videoSegments?.[0].videoId, "abcdefghijk");
  assert.equal(remotePayload.videoEventOverrides?.[0].eventId, session.events[0].id);
  assert.equal(remotePayload.videoAnalysisClips?.[0].tags[0], "presión");
  assert.equal(local.getSummary(session.matchId).pending, 0);
  const secondStorage = new MemoryStorage();
  const secondBrowser = new LocalMatchRepository({ storage: secondStorage, idFactory: idFactory() });
  const remoteRevision = remote.documents.get(`${session.matchId}:match`)?.revision ?? 0;
  assert.equal(secondBrowser.hydrateRemote(remoteMatchSession(remotePayload, session.events), { [syncEntityKey("MATCH", session.matchId)]: remoteRevision }), true);
  assert.equal(secondBrowser.load(session.matchId)?.videoEventOverrides?.[0].status, "VERIFIED");
  assert.equal(secondBrowser.load(session.matchId)?.videoEventOverrides?.[0].videoSecond, 17);
  assert.equal(secondBrowser.load(session.matchId)?.videoAnalysisClips?.[0].id, "clip-sync");
  assert.equal(secondBrowser.getSummary(session.matchId).pending, 0);
});

test("hidratación PROD-style refresca una caché incompleta con eventos y vídeo sin crear outbox", () => {
  const storage = new MemoryStorage();
  const matchId = "remote-existing-cache";
  const initial = createSession(matchId);
  const preparation = {
    clubId: "club-prod",
    teamId: "team-prod",
    seasonId: "season-prod",
    opponent: "Rival remoto",
    venue: "AWAY" as const,
    date: "2026-09-05",
    competitionType: "FRIENDLY" as const,
    status: "FINISHED" as const,
    calledPlayerIds: initial.players.map((player) => player.id),
    starterPlayerIds: initial.players.slice(0, 5).map((player) => player.id),
    selectedStaffIds: [],
    targetMinutes: {},
    createdAt: 1,
    updatedAt: 2,
  };
  const cached = { ...initial, preparation, matchFinished: true, events: [], videoSegments: [] };
  assert.equal(saveMatchSession(cached, storage, 3).ok, true);

  const goal = createLiveThreatEvent({
    id: "remote-goal",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: initial.players[0].id,
    origin: { x: 0.2, y: 0.5 },
    outcome: "GOL",
    phase: "POSITIONAL",
    now: 4,
  });
  const historicalDuplicateOrder = createLiveThreatEvent({
    id: "remote-duplicate-order",
    matchId,
    position: { period: 1, minute: 4, order: 1 },
    side: "FOR",
    playerId: initial.players[0].id,
    origin: { x: 0.3, y: 0.5 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    now: 5,
  });
  const segment = {
    ...createVideoSegment({ id: "remote-video", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 5 }),
    anchors: [{ id: "remote-anchor", eventId: goal.id, videoSecond: 17 }],
  };
  const remote = {
    ...initial,
    preparation,
    matchFinished: true,
    events: [...initial.events, goal, historicalDuplicateOrder],
    videoSegments: [segment],
  };
  const repository = new LocalMatchRepository({ storage, now: () => 6 });
  assert.equal(repository.hydrateRemote(remote, { "match": 1, [`event:${goal.id}`]: 1 }), true);

  const loaded = repository.load(matchId);
  assert.ok(loaded);
  assert.equal(loaded.events.some((event) => event.id === goal.id), true);
  assert.equal(replayMatch(loaded.players, loaded.events).issues.some((issue) => issue.code === "DUPLICATE_ORDER"), true);
  assert.equal(loaded.videoSegments?.[0].anchors[0].eventId, goal.id);
  assert.equal(repository.getSyncState(matchId).outbox.length, 0);
  const catalog = listMatchCatalog(storage).find((item) => item.matchId === matchId);
  assert.ok(catalog);
  assert.equal(catalog.eventCount, remote.events.length);
  const dashboard = buildDashboardV2(
    [{ catalog, session: loaded }],
    emptyDashboardScope("club-prod", "team-prod", "season-prod"),
  );
  assert.equal(dashboard.analytics.matches, 1);
  assert.equal(dashboard.analytics.goalsFor, 1);
});

test("hidratar 94 eventos y editar solo vídeo encola únicamente MATCH incluso tras reload", async () => {
  const storage = new MemoryStorage();
  const matchId = "historical-video-only";
  const initial = createSession(matchId);
  const events = [...initial.events, ...Array.from({ length: 93 }, (_, index) => createLiveThreatEvent({
    id: `historical-event-${index + 1}`,
    matchId,
    position: { period: index < 47 ? 1 : 2, minute: index % 20, order: Math.floor(index / 20) + 1 },
    side: "FOR",
    playerId: initial.players[index % initial.players.length].id,
    origin: { x: (index % 10) / 10, y: ((index * 3) % 10) / 10 },
    outcome: "FUERA",
    phase: "POSITIONAL",
    now: index + 10,
  }))];
  events[7] = { ...events[7], deletedAt: 1000 };
  const existingSegment = {
    ...createVideoSegment({ id: "existing-video", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 1001 }),
    anchors: [{ id: "existing-anchor", eventId: events[1].id, videoSecond: 17 }],
  };
  const remoteSession = upsertVideoEventOverride({
    ...initial,
    matchFinished: true,
    reviewStatus: "IN_REVIEW" as const,
    reviewRevision: 2,
    events,
    videoSegments: [existingSegment],
  }, { eventId: events[2].id, segmentId: existingSegment.id, videoSecond: 31, now: 1002 });
  const known = Object.fromEntries([
    [syncEntityKey("MATCH", matchId), 4],
    ...events.map((event, index) => [syncEntityKey("EVENT", event.id), index % 3 + 1] as const),
  ]);
  const local = new LocalMatchRepository({ storage, now: () => 2000, idFactory: idFactory() });
  assert.equal(local.hydrateRemote(remoteSession, known), true);
  assert.equal(local.getSyncState(matchId).outbox.length, 0);
  assert.equal(Object.keys(local.getSyncState(matchId).knownRemoteRevisions).length, 95);

  const reopened = new LocalMatchRepository({ storage, now: () => 2001, idFactory: idFactory() });
  const segment = createVideoSegment({ id: "video-only", urlOrVideoId: "abcdefghijk", periods: [1, 2], now: 2001 });
  reopened.save({ ...reopened.load(matchId)!, videoSegments: [existingSegment, segment] });
  const queued = reopened.getSyncState(matchId).outbox;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].entityType, "MATCH");
  assert.equal(queued[0].baseRevision, 4);
  assert.equal(queued.filter((operation) => operation.entityType === "EVENT").length, 0);

  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(matchId, "MATCH", matchId, 4, matchRemoteMetadata(remoteSession));
  events.forEach((event, index) => remote.seed(matchId, "EVENT", event.id, index % 3 + 1, event));
  await new MatchSyncCoordinator(reopened, remote, { isOnline: () => true }).syncMatch(matchId);
  assert.equal(remote.applyCalls, 1);
  assert.equal(reopened.getSummary(matchId).conflicts, 0);
  assert.equal(reopened.getSummary(matchId).errors, 0);
  assert.equal(reopened.getSummary(matchId).pending, 0);
});

test("reconciliación elimina solo operaciones idénticas y protege divergencias base 0", () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 3000, idFactory: idFactory() });
  const initial = createSession("reconcile-recovery");
  const session = {
    ...initial,
    events: [...initial.events, ...Array.from({ length: 93 }, (_, index) => createLiveThreatEvent({
      id: `recovery-event-${index + 1}`,
      matchId: initial.matchId,
      position: { period: index < 47 ? 1 : 2, minute: index % 20, order: Math.floor(index / 20) + 1 },
      side: "FOR",
      playerId: initial.players[index % initial.players.length].id,
      origin: { x: 0.4, y: 0.6 },
      outcome: "FUERA",
      phase: "POSITIONAL",
      now: index + 1,
    }))],
  };
  local.save(session);
  const operations = local.getSyncState(session.matchId).outbox;
  assert.equal(operations.length, 95);
  const snapshots = operations.map((operation, index) => ({
    entityType: operation.entityType,
    entityId: operation.entityId,
    exists: true,
    revision: index + 1,
    removed: operation.kind === "TOMBSTONE",
    payload: operation.entityType === "MATCH"
      ? { ...operation.payload, minute: 9 }
      : structuredClone(operation.payload),
  }));

  const result = local.reconcileRemoteSnapshots(session.matchId, snapshots);
  assert.equal(result.reconciled, 94);
  assert.equal(result.protected, 1);
  const state = local.getSyncState(session.matchId);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].entityType, "MATCH");
  assert.equal(state.outbox[0].status, "CONFLICT");
  assert.equal(state.outbox[0].baseRevision, 0);
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].remoteRevision, 1);
  assert.equal(Object.keys(state.knownRemoteRevisions).length, 95);
  assert.equal(state.knownRemoteRevisions.match, 1);
  assert.equal(hasUnreconciledMatchSyncState(state), true);
});

test("una entidad divergente protegida mantiene disponible la recuperación", () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 4000, idFactory: idFactory() });
  const session = createSession("protected-recovery");
  local.save(session);
  const operation = local.getSyncState(session.matchId).outbox.find((item) => item.entityType === "MATCH")!;

  local.reconcileRemoteSnapshots(session.matchId, [{
    entityType: "MATCH",
    entityId: session.matchId,
    exists: true,
    revision: 3,
    removed: false,
    payload: { ...operation.payload, minute: 12 },
  }]);

  const protectedState = local.getSyncState(session.matchId);
  assert.equal(protectedState.outbox.length > 0, true);
  assert.equal(protectedState.conflicts.length, 1);
  assert.equal(hasUnreconciledMatchSyncState(protectedState), true);
  assert.equal(hasUnreconciledMatchSyncState({
    ...protectedState,
    outbox: [],
    conflicts: [],
  }), false);
});

test("resolver conflicto MATCH solo aplica vídeo local y conserva intacto el resto remoto", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 5000, idFactory: idFactory() });
  const session = createSession("video-only-resolution");
  local.save(session);
  const operation = local.getSyncState(session.matchId).outbox.find((item) => item.entityType === "MATCH")!;
  const segment = createVideoSegment({ id: "remote-segment", urlOrVideoId: "ydQf4OF4bmE", periods: [1], now: 20 });
  const remotePayload = {
    ...operation.payload,
    videoSegments: [segment],
    videoEventOverrides: [],
  };
  protectMatchConflict(local, session.matchId, 20, remotePayload);
  assert.equal(hasVideoOnlyMatchConflict(local.getSyncState(session.matchId)), true);

  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(session.matchId, "MATCH", session.matchId, 20, remotePayload);
  const result = await resolveLocalMatchVideoConflict(session.matchId, local, remote);
  assert.deepEqual(result, { status: "RESOLVED", remoteRevision: 21, wroteRemote: true });

  const finalDocument = remote.documents.get(`${session.matchId}:match`)!;
  const finalPayload = finalDocument.payload as typeof remotePayload;
  assert.deepEqual(finalPayload.videoSegments, []);
  assert.deepEqual(finalPayload.videoEventOverrides, []);
  const { videoSegments: beforeSegments, videoEventOverrides: beforeOverrides, ...beforeSports } = remotePayload;
  const { videoSegments: afterSegments, videoEventOverrides: afterOverrides, ...afterSports } = finalPayload;
  assert.equal(beforeSegments.length, 1);
  assert.equal(beforeOverrides.length, 0);
  assert.equal(afterSegments.length, 0);
  assert.equal(afterOverrides.length, 0);
  assert.deepEqual(afterSports, beforeSports);
  const state = local.getSyncState(session.matchId);
  assert.equal(state.outbox.length, 0);
  assert.equal(state.conflicts.length, 0);
  assert.equal(state.knownRemoteRevisions.match, 21);
});

test("resolución de vídeo rechaza cualquier diferencia deportiva", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 6000, idFactory: idFactory() });
  const session = createSession("video-and-sports-conflict");
  local.save(session);
  const operation = local.getSyncState(session.matchId).outbox.find((item) => item.entityType === "MATCH")!;
  const remotePayload = {
    ...operation.payload,
    minute: 8,
    videoSegments: [createVideoSegment({ id: "remote-sports-segment", urlOrVideoId: "ydQf4OF4bmE", periods: [1], now: 21 })],
  };
  protectMatchConflict(local, session.matchId, 7, remotePayload);
  assert.equal(hasVideoOnlyMatchConflict(local.getSyncState(session.matchId)), false);
  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(session.matchId, "MATCH", session.matchId, 7, remotePayload);
  const result = await resolveLocalMatchVideoConflict(session.matchId, local, remote);
  assert.equal(result.status, "PROTECTED");
  assert.equal(remote.applyCalls, 0);
  assert.equal(local.getSyncState(session.matchId).conflicts.length, 1);
});

test("resolución relee y revalida si cambia la revisión remota", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, now: () => 7000, idFactory: idFactory() });
  const session = createSession("video-concurrent-resolution");
  local.save(session);
  const operation = local.getSyncState(session.matchId).outbox.find((item) => item.entityType === "MATCH")!;
  const firstPayload = {
    ...operation.payload,
    videoSegments: [createVideoSegment({ id: "first-remote-video", urlOrVideoId: "ydQf4OF4bmE", periods: [1], now: 22 })],
  };
  protectMatchConflict(local, session.matchId, 20, firstPayload);

  const inner = new InMemoryRemoteMatchRepository();
  inner.seed(session.matchId, "MATCH", session.matchId, 20, firstPayload);
  let reads = 0;
  let raced = false;
  const remote: RemoteMatchRepository = {
    async read(candidate) {
      reads += 1;
      return inner.read(candidate);
    },
    async apply(candidate): Promise<RemoteApplyResult> {
      if (!raced) {
        raced = true;
        const concurrentPayload = {
          ...firstPayload,
          videoSegments: [createVideoSegment({ id: "concurrent-video", urlOrVideoId: "abcdefghijk", periods: [1], now: 23 })],
        };
        inner.seed(session.matchId, "MATCH", session.matchId, 21, concurrentPayload);
      }
      return inner.apply(candidate);
    },
  };

  const result = await resolveLocalMatchVideoConflict(session.matchId, local, remote);
  assert.deepEqual(result, { status: "RESOLVED", remoteRevision: 22, wroteRemote: true });
  assert.equal(reads, 2);
  const finalPayload = inner.documents.get(`${session.matchId}:match`)?.payload as typeof firstPayload;
  assert.deepEqual(finalPayload.videoSegments, []);
  assert.equal(local.getSyncState(session.matchId).knownRemoteRevisions.match, 22);
});

test("videoEventOverrides se sustituye sin ampliar los campos resolubles", () => {
  const session = createSession("video-overrides-only");
  const localPayload = {
    ...matchRemoteMetadata(session),
    videoEventOverrides: [{ eventId: "event-1", segmentId: "segment-1", videoSecond: 11, updatedAt: 30 }],
  };
  const remotePayload = { ...matchRemoteMetadata(session), videoEventOverrides: [] };
  const merged = buildLocalVideoResolutionPayload(localPayload, remotePayload);
  assert.deepEqual(merged?.videoEventOverrides, localPayload.videoEventOverrides);
  assert.equal(buildLocalVideoResolutionPayload(localPayload, { ...remotePayload, minute: 1 }), null);
});

test("payload remoto semánticamente idéntico se confirma sin conflicto aunque cambie la revisión", async () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const session = createSession("match-identical-retry");
  local.save(session);
  const operation = local.getSyncState(session.matchId).outbox.find((item) => item.entityType === "EVENT")!;
  const remote = new InMemoryRemoteMatchRepository();
  remote.seed(session.matchId, operation.entityType, operation.entityId, 7, structuredClone(operation.payload));
  await new MatchSyncCoordinator(local, remote, { isOnline: () => true }).syncMatch(session.matchId);
  assert.equal(local.getSyncState(session.matchId).outbox.some((item) => item.id === operation.id), false);
  assert.equal(local.getSyncState(session.matchId).knownRemoteRevisions[syncEntityKey("EVENT", operation.entityId)], 7);
  assert.equal(local.getSummary(session.matchId).conflicts, 0);
});

test("hidratación remota de partido conserva una captura local pendiente", () => {
  const storage = new MemoryStorage();
  const repository = new LocalMatchRepository({ storage, now: () => 10, idFactory: idFactory() });
  const local = createSession("remote-does-not-overwrite-offline");
  assert.equal(repository.save(local).ok, true);
  const pending = repository.getSyncState(local.matchId).outbox.map((operation) => operation.id);
  const remote = { ...local, minute: 8, periodMinutes: { ...local.periodMinutes, 1: 8 } };
  assert.equal(repository.hydrateRemote(remote, { match: 2 }), true);
  assert.equal(repository.load(local.matchId)?.minute, 0);
  assert.deepEqual(repository.getSyncState(local.matchId).outbox.map((operation) => operation.id), pending);
});

test("errores remotos se clasifican sin confundir permisos con offline", () => {
  const permission = classifyRemoteError({ code: "permission-denied", message: "no" });
  assert.equal(permission.kind, "PERMISSION");
  assert.equal(permission.retryable, false);
  const transient = classifyRemoteError({ code: "unavailable", message: "later" });
  assert.equal(transient.kind, "TRANSIENT");
  assert.equal(transient.retryable, true);
});

test("RC2: outbox de captura conserva IDs deportivos y no sale antes de verificar el lease", () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory() });
  const matchId = "capture-gated";
  const session = createSession(matchId);
  setRuntimeCaptureContext(matchId, {
    captureSessionId: "capture-1", accessId: "access-1", deviceInstallId: "device-1",
    mode: "VERIFIED", syncAllowed: false,
  });
  local.save(session);
  const state = local.getSyncState(matchId);
  assert.ok(state.outbox.length >= 2);
  assert.ok(state.outbox.every((operation) => operation.captureSessionId === "capture-1"));
  const eventOperation = state.outbox.find((operation) => operation.entityType === "EVENT");
  assert.equal(eventOperation?.entityId, session.events[0].id);
  assert.equal((eventOperation?.payload as typeof session.events[0]).id, session.events[0].id);
  assert.equal(local.claimNextOperation(matchId), null);

  setRuntimeCaptureContext(matchId, {
    captureSessionId: "capture-1", accessId: "access-1", deviceInstallId: "device-1",
    mode: "VERIFIED", syncAllowed: true,
  });
  assert.equal(local.claimNextOperation(matchId)?.captureSessionId, "capture-1");
  resetRuntimeCaptureContextsForTests();
});

test("RC2: revocación preserva la operación y una edición posterior no la reactiva", () => {
  const storage = new MemoryStorage();
  let now = 100;
  const local = new LocalMatchRepository({ storage, now: () => now, idFactory: idFactory() });
  const matchId = "capture-revoked";
  const session = createSession(matchId);
  setRuntimeCaptureContext(matchId, {
    captureSessionId: "capture-1", accessId: "access-1", deviceInstallId: "device-1",
    mode: "VERIFIED", syncAllowed: true,
  });
  local.save(session);
  const operation = local.claimNextOperation(matchId);
  assert.ok(operation);
  local.markError(matchId, operation.id, "PERMISSION", "Acceso revocado", false);
  now = 101;
  local.save({ ...session, minute: 1, periodMinutes: { ...session.periodMinutes, 1: 1 } });
  const retained = local.getSyncState(matchId).outbox.find((item) => item.id === operation.id);
  assert.equal(retained?.status, "ERROR");
  assert.equal(retained?.errorKind, "PERMISSION");
  assert.equal(retained?.nextAttemptAt, Number.MAX_SAFE_INTEGER);
  assert.notEqual(local.claimNextOperation(matchId)?.id, operation.id);
  resetRuntimeCaptureContextsForTests();
});

test("RC2: takeover durante offline convierte la captura anterior en conflicto sin perder payload", () => {
  const storage = new MemoryStorage();
  const local = new LocalMatchRepository({ storage, idFactory: idFactory(), now: () => 500 });
  const matchId = "capture-taken-over";
  const session = createSession(matchId);
  setRuntimeCaptureContext(matchId, {
    captureSessionId: "capture-old", accessId: "access-old", deviceInstallId: "device-old",
    mode: "VERIFIED", syncAllowed: false,
  });
  local.save(session);
  const before = local.getSyncState(matchId).outbox;
  assert.ok(before.length > 0);
  local.markCaptureSessionLost(matchId, "capture-old", {
    captureSessionId: "capture-new", accessId: "access-new", deviceInstallId: "device-new", status: "ACTIVE",
  });
  const after = local.getSyncState(matchId);
  assert.equal(after.outbox.length, before.length);
  assert.ok(after.outbox.every((operation) => operation.status === "CONFLICT"));
  assert.deepEqual(after.outbox.map((operation) => operation.payload), before.map((operation) => operation.payload));
  assert.equal(after.conflicts.length, before.length);
  assert.equal(local.claimNextOperation(matchId), null);
  resetRuntimeCaptureContextsForTests();
});

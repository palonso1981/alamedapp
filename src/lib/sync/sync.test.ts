import assert from "node:assert/strict";
import test from "node:test";

import {
  createFoulEvent,
  createLiveThreatEvent,
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
import { LocalMatchRepository } from "./localMatchRepository";
import {
  classifyRemoteError,
  InMemoryRemoteMatchRepository,
} from "./remoteMatchRepository";
import { MatchSyncCoordinator } from "./syncCoordinator";

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
  assert.equal(migrated?.storageVersion, 2);
  assert.equal(migrated?.sync.outbox.length, 2);

  repository.save(repository.load(session.matchId)!);
  assert.equal(repository.getSyncState(session.matchId).outbox.length, 2);
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

test("errores remotos se clasifican sin confundir permisos con offline", () => {
  const permission = classifyRemoteError({ code: "permission-denied", message: "no" });
  assert.equal(permission.kind, "PERMISSION");
  assert.equal(permission.retryable, false);
  const transient = classifyRemoteError({ code: "unavailable", message: "later" });
  assert.equal(transient.kind, "TRANSIENT");
  assert.equal(transient.retryable, true);
});

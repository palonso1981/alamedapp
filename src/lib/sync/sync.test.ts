import assert from "node:assert/strict";
import test from "node:test";

import {
  createFoulEvent,
  createFoulCountAdjustmentEvent,
  createGameStateEvent,
  createLiveThreatEvent,
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
} from "./remoteMatchRepository";
import { MatchSyncCoordinator } from "./syncCoordinator";
import { migrateMatchSyncState } from "./syncTypes";

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
  ];
  local.save({ ...session, events });
  assert.equal(local.load(session.matchId)?.events.length, events.length);
  assert.ok(local.getSummary(session.matchId).pending > 0);
  await coordinator.syncMatch(session.matchId);
  for (const id of ["restart-sync", "adjust-sync", "pj-rival-sync"]) {
    assert.equal((remote.documents.get(`${session.matchId}:event:${id}`)?.payload as { id?: string })?.id, id);
  }
  assert.equal(local.getSummary(session.matchId).pending, 0);
});

test("errores remotos se clasifican sin confundir permisos con offline", () => {
  const permission = classifyRemoteError({ code: "permission-denied", message: "no" });
  assert.equal(permission.kind, "PERMISSION");
  assert.equal(permission.retryable, false);
  const transient = classifyRemoteError({ code: "unavailable", message: "later" });
  assert.equal(transient.kind, "TRANSIENT");
  assert.equal(transient.retryable, true);
});

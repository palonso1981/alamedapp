import {
  browserMatchStorage,
  loadMatchRecord,
  LocalStorageAdapter,
  SaveMatchResult,
  saveMatchRecord,
} from "../matchPersistence";
import { MatchEvent, MatchSession } from "../../types";
import { updateMatchCatalog } from "../matchCatalog";
import { canAccessTeam, canMutateSports } from "../access/accessDomain";
import { getRuntimeAccessGrant } from "../access/accessRuntime";
import { captureOperationCanSync, getRuntimeCaptureContext } from "../captureLease";
import {
  emptyMatchSyncState,
  matchTombstoneAlreadyApplied,
  MATCH_REMOTE_SCHEMA_VERSION,
  MatchRemoteMetadata,
  MatchSyncConflict,
  MatchSyncOperation,
  MatchSyncSummary,
  PersistedMatchSyncState,
  RemoteMatchEntitySnapshot,
  summarizeSyncState,
  SyncErrorKind,
  SyncOperationKind,
  SyncOperationPayload,
  syncEntityKey,
  syncPayloadsEqual,
  SyncEntityType,
} from "./syncTypes";

const LOCAL_ONLY_MATCH_IDS = new Set(["prueba", "prueba-8", "prueba-porteria"]);

export interface LocalMatchRepositoryOptions {
  storage?: LocalStorageAdapter | null;
  now?: () => number;
  idFactory?: () => string;
}

export type LocalMatchSaveResult =
  | (Extract<SaveMatchResult, { ok: true }> & { pending: number })
  | Extract<SaveMatchResult, { ok: false }>;

export function isRemoteSyncEligibleMatch(matchId: string): boolean {
  return !LOCAL_ONLY_MATCH_IDS.has(matchId);
}

export function matchRemoteMetadata(session: MatchSession): MatchRemoteMetadata {
  return {
    schemaVersion: MATCH_REMOTE_SCHEMA_VERSION,
    matchId: session.matchId,
    players: session.players,
    staff: session.staff,
    activePeriod: session.period,
    minute: session.minute,
    periodMinutes: session.periodMinutes,
    closedPeriods: session.closedPeriods ?? [],
    periodCloseSnapshots: session.periodCloseSnapshots ?? {},
    reviewPeriod: session.reviewPeriod,
    reviewMinute: session.reviewMinute,
    matchFinished: session.matchFinished ?? false,
    reviewStatus: session.reviewStatus,
    reviewRevision: session.reviewRevision,
    reviewStartedAt: session.reviewStartedAt,
    reviewValidatedAt: session.reviewValidatedAt,
    reviewReopenedAt: session.reviewReopenedAt,
    videoSegments: session.videoSegments ?? [],
    videoEventOverrides: session.videoEventOverrides ?? [],
    videoAnalysisClips: session.videoAnalysisClips ?? [],
    preparation: session.preparation,
  };
}

function defaultIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

function enqueueLatest(
  state: PersistedMatchSyncState,
  input: {
    matchId: string;
    entityType: SyncEntityType;
    entityId: string;
    kind: SyncOperationKind;
    payload: SyncOperationPayload;
  },
  now: number,
  idFactory: () => string,
  capture: ReturnType<typeof getRuntimeCaptureContext>,
): PersistedMatchSyncState {
  const key = syncEntityKey(input.entityType, input.entityId);
  const compactableIndex = state.outbox.findIndex(
    (operation) =>
      syncEntityKey(operation.entityType, operation.entityId) === key &&
      operation.captureSessionId === capture?.captureSessionId &&
      (operation.status === "PENDING" ||
        operation.status === "ERROR" ||
        operation.status === "CONFLICT"),
  );
  const compactedOperation =
    compactableIndex >= 0 ? state.outbox[compactableIndex] : null;
  const keepsConflict = compactedOperation?.status === "CONFLICT";
  const keepsTerminalError = compactedOperation?.status === "ERROR" &&
    ["PERMISSION", "INVALID_DATA", "FATAL"].includes(String(compactedOperation.errorKind));
  const baseRevision = state.knownRemoteRevisions[key] ?? 0;
  const operation: MatchSyncOperation = {
    id:
      compactedOperation ? compactedOperation.id : idFactory(),
    matchId: input.matchId,
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    payload: input.payload,
    baseRevision:
      compactedOperation ? compactedOperation.baseRevision : baseRevision,
    clientUpdatedAt: now,
    attempts: compactedOperation?.attempts ?? 0,
    status: keepsConflict ? "CONFLICT" : keepsTerminalError ? "ERROR" : "PENDING",
    nextAttemptAt: keepsConflict || keepsTerminalError
      ? compactedOperation.nextAttemptAt
      : 0,
    lastError: keepsConflict || keepsTerminalError ? compactedOperation.lastError : undefined,
    errorKind: keepsConflict || keepsTerminalError ? compactedOperation.errorKind : undefined,
    captureSessionId: capture?.captureSessionId,
    captureAccessId: capture?.accessId,
    captureDeviceInstallId: capture?.deviceInstallId,
  };
  const outbox = [...state.outbox];
  if (compactableIndex >= 0) outbox[compactableIndex] = operation;
  else outbox.push(operation);
  return {
    ...state,
    outbox,
    conflicts: keepsConflict
      ? state.conflicts.map((conflict) =>
          conflict.operationId === operation.id
            ? { ...conflict, localPayload: input.payload }
            : conflict,
        )
      : state.conflicts,
    lastLocalMutationAt: now,
    lastError: keepsConflict || keepsTerminalError ? state.lastError : null,
    lastErrorKind: keepsConflict || keepsTerminalError ? state.lastErrorKind : null,
  };
}

function buildNextSyncState(
  previous: MatchSession | null,
  current: MatchSession,
  initialState: PersistedMatchSyncState,
  now: number,
  idFactory: () => string,
): PersistedMatchSyncState {
  let state = initialState;
  const capture = getRuntimeCaptureContext(current.matchId);
  const previousMetadata = previous ? matchRemoteMetadata(previous) : null;
  const currentMetadata = matchRemoteMetadata(current);
  if (!previousMetadata || !syncPayloadsEqual(previousMetadata, currentMetadata)) {
    state = enqueueLatest(
      state,
      {
        matchId: current.matchId,
        entityType: "MATCH",
        entityId: current.matchId,
        // El partido es la raíz del agregado. Su borrado funcional se publica
        // como un único tombstone remoto; los eventos permanecen debajo para
        // recuperación/auditoría, pero la hidratación deja de descubrirlos al
        // ignorar la raíz eliminada.
        kind: current.preparation?.deletedAt ? "TOMBSTONE" : "UPSERT",
        payload: currentMetadata,
      },
      now,
      idFactory,
      capture,
    );
  }

  const previousEvents = new Map(
    (previous?.events ?? []).map((event) => [event.id, event]),
  );
  const currentEvents = new Map(current.events.map((event) => [event.id, event]));
  for (const event of current.events) {
    const prior = previousEvents.get(event.id);
    if (prior && syncPayloadsEqual(prior, event)) continue;
    state = enqueueLatest(
      state,
      {
        matchId: current.matchId,
        entityType: "EVENT",
        entityId: event.id,
        kind: "UPSERT",
        payload: event,
      },
      now,
      idFactory,
      capture,
    );
  }
  previousEvents.forEach((event, eventId) => {
    if (currentEvents.has(eventId)) return;
    state = enqueueLatest(
      state,
      {
        matchId: current.matchId,
        entityType: "EVENT",
        entityId: eventId,
        kind: "TOMBSTONE",
        payload: event,
      },
      now,
      idFactory,
      capture,
    );
  });
  return state;
}

export class LocalMatchRepository {
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly inFlightOperationIds = new Set<string>();
  private readonly storageOverride: LocalStorageAdapter | null | undefined;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: LocalMatchRepositoryOptions = {}) {
    this.storageOverride = options.storage;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  private storage(): LocalStorageAdapter | null {
    return this.storageOverride === undefined
      ? browserMatchStorage()
      : this.storageOverride;
  }

  private withLiveInFlightState(sync: PersistedMatchSyncState): PersistedMatchSyncState {
    return {
      ...sync,
      outbox: sync.outbox.map((operation) =>
        this.inFlightOperationIds.has(operation.id)
          ? { ...operation, status: "SYNCING" as const }
          : operation,
      ),
    };
  }

  load(matchId: string): MatchSession | null {
    return loadMatchRecord(matchId, this.storage())?.session ?? null;
  }

  /**
   * Refresca desde remoto sin generar outbox. Una copia local sin trabajo
   * pendiente es solo caché y puede sustituirse por la versión autoritativa;
   * cualquier outbox o conflicto conserva íntegramente el trabajo offline.
   */
  hydrateRemote(session: MatchSession, knownRemoteRevisions: Record<string, number>): boolean {
    const storage = this.storage();
    const existing = loadMatchRecord(session.matchId, storage);
    if (existing && (existing.sync.outbox.length > 0 || existing.sync.conflicts.length > 0)) {
      return true;
    }
    const result = saveMatchRecord(session, {
      ...emptyMatchSyncState(),
      knownRemoteRevisions,
      lastSyncedAt: this.now(),
    }, storage, this.now());
    if (result.ok) updateMatchCatalog(session, storage);
    return result.ok;
  }

  getSyncState(matchId: string): PersistedMatchSyncState {
    const sync = loadMatchRecord(matchId, this.storage())?.sync ?? emptyMatchSyncState();
    return this.withLiveInFlightState(sync);
  }

  getSummary(matchId: string): MatchSyncSummary {
    return summarizeSyncState(this.getSyncState(matchId));
  }

  /**
   * Recuperación conservadora: elimina solo operaciones demostrablemente
   * idénticas al remoto. Una divergencia basada en 0 queda bloqueada como
   * conflicto, conservando ambos payloads y sin habilitar una sobrescritura.
   */
  reconcileRemoteSnapshots(matchId: string, snapshots: readonly RemoteMatchEntitySnapshot[]): { reconciled: number; protected: number; unchanged: number } {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return { reconciled: 0, protected: 0, unchanged: 0 };
    const remote = new Map(snapshots.map((snapshot) => [syncEntityKey(snapshot.entityType, snapshot.entityId), snapshot]));
    const reconciledIds = new Set<string>();
    const protectedIds = new Set<string>();
    const revisions = { ...record.sync.knownRemoteRevisions };
    const conflicts = [...record.sync.conflicts];
    const outbox = record.sync.outbox.map((operation) => {
      const key = syncEntityKey(operation.entityType, operation.entityId);
      const snapshot = remote.get(key);
      if (!snapshot) return operation;
      if (snapshot.exists) revisions[key] = snapshot.revision;
      if (snapshot.exists && matchTombstoneAlreadyApplied(operation, snapshot)) {
        reconciledIds.add(operation.id);
        return operation;
      }
      const sameRemoval = snapshot.exists && snapshot.removed === (operation.kind === "TOMBSTONE");
      if (sameRemoval && syncPayloadsEqual(operation.payload, snapshot.payload)) {
        reconciledIds.add(operation.id);
        return operation;
      }
      if (snapshot.exists && operation.baseRevision === 0) {
        protectedIds.add(operation.id);
        const conflict: MatchSyncConflict = {
          operationId: operation.id,
          entityKey: key,
          detectedAt: this.now(),
          localPayload: operation.payload,
          remoteRevision: snapshot.revision,
          remotePayload: snapshot.payload,
        };
        const index = conflicts.findIndex((item) => item.operationId === operation.id);
        if (index >= 0) conflicts[index] = conflict;
        else conflicts.push(conflict);
        return {
          ...operation,
          status: "CONFLICT" as const,
          errorKind: "CONFLICT" as const,
          lastError: "El remoto existe y falta una revisión base fiable. Se conservan ambas versiones.",
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
        };
      }
      return operation;
    }).filter((operation) => !reconciledIds.has(operation.id));
    reconciledIds.forEach((id) => this.inFlightOperationIds.delete(id));
    const retainedIds = new Set(outbox.map((operation) => operation.id));
    const retainedConflicts = conflicts.filter((conflict) => retainedIds.has(conflict.operationId));
    const now = this.now();
    const result = saveMatchRecord(record.session, {
      ...record.sync,
      outbox,
      knownRemoteRevisions: revisions,
      conflicts: retainedConflicts,
      lastSyncedAt: reconciledIds.size > 0 ? now : record.sync.lastSyncedAt,
      lastError: retainedConflicts.length > 0
        ? "Quedan cambios locales distintos del remoto que requieren revisión."
        : outbox.length > 0 ? record.sync.lastError : null,
      lastErrorKind: retainedConflicts.length > 0
        ? "CONFLICT"
        : outbox.length > 0 ? record.sync.lastErrorKind : null,
    }, storage, now);
    if (result.ok) this.notify(matchId);
    return { reconciled: reconciledIds.size, protected: protectedIds.size, unchanged: outbox.length - protectedIds.size };
  }

  save(session: MatchSession): LocalMatchSaveResult {
    const grant = getRuntimeAccessGrant();
    if (grant !== undefined) {
      const clubId = session.preparation?.clubId;
      const teamId = session.preparation?.teamId;
      if (!canMutateSports(grant) || !clubId || !canAccessTeam(grant, clubId, teamId)) {
        return { ok: false, unavailable: false, message: "Este acceso no puede modificar este partido." };
      }
    }
    const storage = this.storage();
    const previousRecord = loadMatchRecord(session.matchId, storage);
    const now = this.now();
    let sync = this.withLiveInFlightState(previousRecord?.sync ?? emptyMatchSyncState());
    if (isRemoteSyncEligibleMatch(session.matchId)) {
      sync = buildNextSyncState(
        previousRecord?.storageVersion === 1 ? null : previousRecord?.session ?? null,
        session,
        sync,
        now,
        this.idFactory,
      );
    }
    const result = saveMatchRecord(session, sync, storage, now);
    if (result.ok) {
      updateMatchCatalog(session, storage);
      this.notify(session.matchId);
    }
    return result.ok
      ? { ...result, pending: summarizeSyncState(sync).pending }
      : result;
  }

  claimNextOperation(matchId: string): MatchSyncOperation | null {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return null;
    const now = this.now();
    const sync = this.withLiveInFlightState(record.sync);
    const index = sync.outbox.findIndex(
      (operation) =>
        (operation.status === "PENDING" || operation.status === "ERROR") &&
        captureOperationCanSync(matchId, operation.captureSessionId) &&
        operation.nextAttemptAt <= now,
    );
    if (index < 0) return null;
    const operation: MatchSyncOperation = {
      ...sync.outbox[index],
      status: "SYNCING",
      attempts: sync.outbox[index].attempts + 1,
      lastError: undefined,
      errorKind: undefined,
    };
    const outbox = [...sync.outbox];
    outbox[index] = operation;
    const result = saveMatchRecord(
      record.session,
      { ...sync, outbox, lastError: null, lastErrorKind: null },
      storage,
      now,
    );
    if (!result.ok) return null;
    this.inFlightOperationIds.add(operation.id);
    this.notify(matchId);
    return operation;
  }

  markSynced(matchId: string, operationId: string, remoteRevision: number): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    const operation = record.sync.outbox.find((item) => item.id === operationId);
    if (!operation) return;
    this.inFlightOperationIds.delete(operationId);
    const key = syncEntityKey(operation.entityType, operation.entityId);
    const outbox = record.sync.outbox
      .filter((item) => item.id !== operationId)
      .map((item) =>
        syncEntityKey(item.entityType, item.entityId) === key &&
        item.baseRevision === operation.baseRevision
          ? { ...item, baseRevision: remoteRevision }
          : item,
      );
    const now = this.now();
    saveMatchRecord(
      record.session,
      {
        ...record.sync,
        outbox,
        knownRemoteRevisions: {
          ...record.sync.knownRemoteRevisions,
          [key]: remoteRevision,
        },
        lastSyncedAt: now,
        lastError: null,
        lastErrorKind: null,
      },
      storage,
      now,
    );
    this.notify(matchId);
  }

  markError(
    matchId: string,
    operationId: string,
    kind: SyncErrorKind,
    message: string,
    retryable: boolean,
  ): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    this.inFlightOperationIds.delete(operationId);
    const now = this.now();
    const outbox = record.sync.outbox.map((operation) =>
      operation.id === operationId
        ? {
            ...operation,
            status: "ERROR" as const,
            errorKind: kind,
            lastError: message,
            nextAttemptAt: retryable
              ? now + Math.min(60_000, 1_000 * 2 ** Math.min(operation.attempts, 6))
              : Number.MAX_SAFE_INTEGER,
          }
        : operation,
    );
    saveMatchRecord(
      record.session,
      { ...record.sync, outbox, lastError: message, lastErrorKind: kind },
      storage,
      now,
    );
    this.notify(matchId);
  }

  markConflict(
    matchId: string,
    operationId: string,
    remoteRevision: number,
    remotePayload: unknown,
  ): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    const operation = record.sync.outbox.find((item) => item.id === operationId);
    if (!operation) return;
    this.inFlightOperationIds.delete(operationId);
    const now = this.now();
    const captureControlLost = typeof remotePayload === "object" && remotePayload !== null &&
      "kind" in remotePayload && (remotePayload as { kind?: unknown }).kind === "CAPTURE_LEASE_MISMATCH";
    const conflictMessage = captureControlLost
      ? "Control del partido perdido. Los cambios locales se conservan sin sobrescribir la otra captura."
      : "El remoto cambió desde la revisión local conocida.";
    const conflict: MatchSyncConflict = {
      operationId,
      entityKey: syncEntityKey(operation.entityType, operation.entityId),
      detectedAt: now,
      localPayload: operation.payload,
      remoteRevision,
      remotePayload,
    };
    const outbox = record.sync.outbox.map((item) =>
      item.id === operationId
        ? {
            ...item,
            status: "CONFLICT" as const,
            errorKind: "CONFLICT" as const,
            lastError: conflictMessage,
          }
        : item,
    );
    saveMatchRecord(
      record.session,
      {
        ...record.sync,
        outbox,
        conflicts: [
          ...record.sync.conflicts.filter((item) => item.operationId !== operationId),
          conflict,
        ],
        lastError: captureControlLost ? conflictMessage : "Conflicto detectado. No se ha sobrescrito el remoto.",
        lastErrorKind: "CONFLICT",
      },
      storage,
      now,
    );
    this.notify(matchId);
  }

  markCaptureSessionLost(matchId: string, captureSessionId: string, remoteLease: unknown): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    const affected = record.sync.outbox.filter((operation) =>
      operation.captureSessionId === captureSessionId &&
      (operation.status === "PENDING" || operation.status === "SYNCING" || operation.status === "ERROR"),
    );
    if (affected.length === 0) return;
    const now = this.now();
    const operationIds = new Set(affected.map((operation) => operation.id));
    operationIds.forEach((operationId) => this.inFlightOperationIds.delete(operationId));
    const conflictMessage = "Control del partido perdido. Los cambios locales se conservan sin sobrescribir la otra captura.";
    const remotePayload = { kind: "CAPTURE_LEASE_MISMATCH", lease: remoteLease ?? null };
    const outbox = record.sync.outbox.map((operation) =>
      operationIds.has(operation.id)
        ? { ...operation, status: "CONFLICT" as const, errorKind: "CONFLICT" as const, lastError: conflictMessage }
        : operation,
    );
    const conflicts = [
      ...record.sync.conflicts.filter((conflict) => !operationIds.has(conflict.operationId)),
      ...affected.map((operation) => ({
        operationId: operation.id,
        entityKey: syncEntityKey(operation.entityType, operation.entityId),
        detectedAt: now,
        localPayload: operation.payload,
        remoteRevision: record.sync.knownRemoteRevisions[syncEntityKey(operation.entityType, operation.entityId)] ?? 0,
        remotePayload,
      })),
    ];
    saveMatchRecord(record.session, {
      ...record.sync,
      outbox,
      conflicts,
      lastError: conflictMessage,
      lastErrorKind: "CONFLICT",
    }, storage, now);
    this.notify(matchId);
  }

  retryErrors(matchId: string): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    const outbox = record.sync.outbox.map((operation) =>
      operation.status === "ERROR" && operation.nextAttemptAt !== Number.MAX_SAFE_INTEGER
        ? {
            ...operation,
            status: "PENDING" as const,
            nextAttemptAt: 0,
            lastError: undefined,
            errorKind: undefined,
          }
        : operation,
    );
    saveMatchRecord(
      record.session,
      { ...record.sync, outbox, lastError: null, lastErrorKind: null },
      storage,
      this.now(),
    );
    this.notify(matchId);
  }

  /** Reactiva un PERMISSION solo después de revalidar explícitamente Access. */
  retryPermissionErrorsAfterAccessValidation(matchId: string): void {
    const storage = this.storage();
    const record = loadMatchRecord(matchId, storage);
    if (!record) return;
    const outbox = record.sync.outbox.map((operation) =>
      operation.status === "ERROR" && operation.errorKind === "PERMISSION"
        ? {
            ...operation,
            status: "PENDING" as const,
            nextAttemptAt: 0,
            lastError: undefined,
            errorKind: undefined,
          }
        : operation,
    );
    saveMatchRecord(
      record.session,
      { ...record.sync, outbox, lastError: null, lastErrorKind: null },
      storage,
      this.now(),
    );
    this.notify(matchId);
  }

  subscribe(matchId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(matchId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(matchId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(matchId);
    };
  }

  private notify(matchId: string): void {
    this.listeners.get(matchId)?.forEach((listener) => listener());
  }
}

export const browserMatchRepository = new LocalMatchRepository();

export function eventFromOperation(operation: MatchSyncOperation): MatchEvent | null {
  return operation.entityType === "EVENT" ? (operation.payload as MatchEvent) : null;
}

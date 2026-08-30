import { browserMatchStorage, LocalStorageAdapter } from "../matchPersistence";
import { MasterPlayer, MasterStaffMember, TeamRoster } from "../../types";
import { emptyRoster } from "../rosterDomain";
import {
  emptyTeamSyncState,
  summarizeTeamSync,
  teamEntityKey,
  TeamEntityType,
  TeamSyncConflict,
  TeamSyncOperation,
  TeamSyncPayload,
  TeamSyncState,
} from "./teamSyncTypes";
import { MatchSyncSummary, SyncErrorKind } from "./syncTypes";

const TEAM_STORAGE_VERSION = 1 as const;
const TEAM_STORAGE_PREFIX = "alamedapp:team:v1:";

interface TeamEnvelope {
  storageVersion: typeof TEAM_STORAGE_VERSION;
  savedAt: number;
  roster: TeamRoster;
  sync: TeamSyncState;
}

export interface LocalTeamRepositoryOptions {
  storage?: LocalStorageAdapter | null;
  now?: () => number;
  idFactory?: () => string;
}

function storageKey(teamId: string): string {
  return `${TEAM_STORAGE_PREFIX}${encodeURIComponent(teamId)}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validPlayer(value: unknown): value is MasterPlayer {
  if (typeof value !== "object" || value === null) return false;
  const player = value as Partial<MasterPlayer>;
  return (
    typeof player.playerId === "string" &&
    typeof player.fullName === "string" &&
    typeof player.displayName === "string" &&
    typeof player.number === "number" &&
    (player.role === "GOALKEEPER" || player.role === "FIELD") &&
    typeof player.active === "boolean" &&
    typeof player.createdAt === "number" &&
    typeof player.updatedAt === "number"
  );
}

function validStaff(value: unknown): value is MasterStaffMember {
  if (typeof value !== "object" || value === null) return false;
  const member = value as Partial<MasterStaffMember>;
  return (
    typeof member.staffId === "string" &&
    typeof member.fullName === "string" &&
    typeof member.displayName === "string" &&
    ["HEAD_COACH", "ASSISTANT_COACH", "DELEGATE", "FITNESS_COACH", "OTHER"].includes(
      String(member.role),
    ) &&
    typeof member.active === "boolean" &&
    typeof member.createdAt === "number" &&
    typeof member.updatedAt === "number"
  );
}

function validOperation(value: unknown, teamId: string): value is TeamSyncOperation {
  if (typeof value !== "object" || value === null) return false;
  const operation = value as Partial<TeamSyncOperation>;
  return (
    typeof operation.id === "string" &&
    operation.teamId === teamId &&
    (operation.entityType === "PLAYER" || operation.entityType === "STAFF") &&
    typeof operation.entityId === "string" &&
    operation.kind === "UPSERT" &&
    typeof operation.baseRevision === "number" &&
    typeof operation.clientUpdatedAt === "number" &&
    typeof operation.attempts === "number" &&
    ["PENDING", "SYNCING", "ERROR", "CONFLICT"].includes(String(operation.status)) &&
    typeof operation.nextAttemptAt === "number" &&
    (operation.entityType === "PLAYER"
      ? validPlayer(operation.payload)
      : validStaff(operation.payload))
  );
}

function migrateSync(value: unknown, teamId: string): TeamSyncState {
  if (typeof value !== "object" || value === null) return emptyTeamSyncState();
  const source = value as Partial<TeamSyncState>;
  if (source.schemaVersion !== 1) return emptyTeamSyncState();
  const valid = Array.isArray(source.outbox)
    ? source.outbox.filter((operation) => validOperation(operation, teamId)).map(
        (operation) => ({
          ...operation,
          status: operation.status === "SYNCING" ? "PENDING" as const : operation.status,
        }),
      )
    : [];
  const latestConflict = new Map<string, number>();
  valid.forEach((operation, index) => {
    if (operation.status !== "CONFLICT") return;
    const key = teamEntityKey(operation.entityType, operation.entityId);
    const prior = latestConflict.get(key);
    if (prior === undefined || valid[prior].clientUpdatedAt <= operation.clientUpdatedAt) {
      latestConflict.set(key, index);
    }
  });
  const outbox = valid.filter(
    (operation, index) =>
      operation.status !== "CONFLICT" ||
      latestConflict.get(teamEntityKey(operation.entityType, operation.entityId)) === index,
  );
  const retained = new Set(outbox.map((operation) => operation.id));
  const revisions =
    source.knownRemoteRevisions && typeof source.knownRemoteRevisions === "object"
      ? Object.fromEntries(
          Object.entries(source.knownRemoteRevisions).filter(
            ([, revision]) => typeof revision === "number" && revision >= 0,
          ),
        )
      : {};
  return {
    schemaVersion: 1,
    outbox,
    knownRemoteRevisions: revisions,
    lastLocalMutationAt:
      typeof source.lastLocalMutationAt === "number" ? source.lastLocalMutationAt : null,
    lastSyncedAt: typeof source.lastSyncedAt === "number" ? source.lastSyncedAt : null,
    lastError: typeof source.lastError === "string" ? source.lastError : null,
    lastErrorKind: source.lastErrorKind ?? null,
    conflicts: Array.isArray(source.conflicts)
      ? source.conflicts.filter(
          (conflict) =>
            typeof conflict === "object" &&
            conflict !== null &&
            retained.has((conflict as TeamSyncConflict).operationId),
        ) as TeamSyncConflict[]
      : [],
  };
}

function readEnvelope(
  teamId: string,
  storage: LocalStorageAdapter | null,
): TeamEnvelope | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(teamId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TeamEnvelope>;
    if (
      parsed.storageVersion !== TEAM_STORAGE_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !parsed.roster ||
      parsed.roster.teamId !== teamId ||
      !Array.isArray(parsed.roster.players) ||
      !parsed.roster.players.every(validPlayer) ||
      !Array.isArray(parsed.roster.staff) ||
      !parsed.roster.staff.every(validStaff)
    ) {
      return null;
    }
    return {
      storageVersion: TEAM_STORAGE_VERSION,
      savedAt: parsed.savedAt,
      roster: parsed.roster,
      sync: migrateSync(parsed.sync, teamId),
    };
  } catch {
    return null;
  }
}

function enqueue(
  state: TeamSyncState,
  teamId: string,
  entityType: TeamEntityType,
  entityId: string,
  payload: TeamSyncPayload,
  now: number,
  idFactory: () => string,
): TeamSyncState {
  const key = teamEntityKey(entityType, entityId);
  const index = state.outbox.findIndex(
    (operation) =>
      teamEntityKey(operation.entityType, operation.entityId) === key &&
      ["PENDING", "ERROR", "CONFLICT"].includes(operation.status),
  );
  const previous = index >= 0 ? state.outbox[index] : undefined;
  const keepsConflict = previous?.status === "CONFLICT";
  const operation: TeamSyncOperation = {
    id: previous?.id ?? idFactory(),
    teamId,
    entityType,
    entityId,
    kind: "UPSERT",
    payload,
    baseRevision: previous?.baseRevision ?? state.knownRemoteRevisions[key] ?? 0,
    clientUpdatedAt: now,
    attempts: previous?.attempts ?? 0,
    status: keepsConflict ? "CONFLICT" : "PENDING",
    nextAttemptAt: keepsConflict ? previous?.nextAttemptAt ?? 0 : 0,
    lastError: keepsConflict ? previous?.lastError : undefined,
    errorKind: keepsConflict ? previous?.errorKind : undefined,
  };
  const outbox = [...state.outbox];
  if (index >= 0) outbox[index] = operation;
  else outbox.push(operation);
  return {
    ...state,
    outbox,
    conflicts: keepsConflict
      ? state.conflicts.map((conflict) =>
          conflict.operationId === operation.id
            ? { ...conflict, localPayload: payload }
            : conflict,
        )
      : state.conflicts,
    lastLocalMutationAt: now,
    lastError: keepsConflict ? state.lastError : null,
    lastErrorKind: keepsConflict ? state.lastErrorKind : null,
  };
}

export class LocalTeamRepository {
  private readonly storageOverride: LocalStorageAdapter | null | undefined;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(options: LocalTeamRepositoryOptions = {}) {
    this.storageOverride = options.storage;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  }

  private storage(): LocalStorageAdapter | null {
    return this.storageOverride === undefined ? browserMatchStorage() : this.storageOverride;
  }

  private write(teamId: string, roster: TeamRoster, sync: TeamSyncState): boolean {
    const storage = this.storage();
    if (!storage) return false;
    try {
      storage.setItem(
        storageKey(teamId),
        JSON.stringify({
          storageVersion: TEAM_STORAGE_VERSION,
          savedAt: this.now(),
          roster,
          sync,
        } satisfies TeamEnvelope),
      );
      return true;
    } catch {
      return false;
    }
  }

  load(teamId: string): TeamRoster {
    return readEnvelope(teamId, this.storage())?.roster ?? emptyRoster(teamId);
  }

  getSyncState(teamId: string): TeamSyncState {
    return readEnvelope(teamId, this.storage())?.sync ?? emptyTeamSyncState();
  }

  getSummary(teamId: string): MatchSyncSummary {
    return summarizeTeamSync(this.getSyncState(teamId));
  }

  save(roster: TeamRoster): boolean {
    const previous = readEnvelope(roster.teamId, this.storage());
    let sync = previous?.sync ?? emptyTeamSyncState();
    const now = this.now();
    const previousPlayers = new Map(
      (previous?.roster.players ?? []).map((player) => [player.playerId, player]),
    );
    for (const player of roster.players) {
      if (sameValue(previousPlayers.get(player.playerId), player)) continue;
      sync = enqueue(sync, roster.teamId, "PLAYER", player.playerId, player, now, this.idFactory);
    }
    const previousStaff = new Map(
      (previous?.roster.staff ?? []).map((member) => [member.staffId, member]),
    );
    for (const member of roster.staff) {
      if (sameValue(previousStaff.get(member.staffId), member)) continue;
      sync = enqueue(sync, roster.teamId, "STAFF", member.staffId, member, now, this.idFactory);
    }
    const saved = this.write(roster.teamId, roster, sync);
    if (saved) this.notify(roster.teamId);
    return saved;
  }

  claimNextOperation(teamId: string): TeamSyncOperation | null {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return null;
    const index = record.sync.outbox.findIndex(
      (operation) =>
        (operation.status === "PENDING" || operation.status === "ERROR") &&
        operation.nextAttemptAt <= this.now(),
    );
    if (index < 0) return null;
    const operation: TeamSyncOperation = {
      ...record.sync.outbox[index],
      status: "SYNCING",
      attempts: record.sync.outbox[index].attempts + 1,
      lastError: undefined,
      errorKind: undefined,
    };
    const outbox = [...record.sync.outbox];
    outbox[index] = operation;
    if (!this.write(teamId, record.roster, { ...record.sync, outbox })) return null;
    this.notify(teamId);
    return operation;
  }

  markSynced(teamId: string, operationId: string, remoteRevision: number): void {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return;
    const operation = record.sync.outbox.find((item) => item.id === operationId);
    if (!operation) return;
    const key = teamEntityKey(operation.entityType, operation.entityId);
    const outbox = record.sync.outbox
      .filter((item) => item.id !== operationId)
      .map((item) =>
        teamEntityKey(item.entityType, item.entityId) === key &&
        item.baseRevision === operation.baseRevision
          ? { ...item, baseRevision: remoteRevision }
          : item,
      );
    this.write(teamId, record.roster, {
      ...record.sync,
      outbox,
      knownRemoteRevisions: { ...record.sync.knownRemoteRevisions, [key]: remoteRevision },
      lastSyncedAt: this.now(),
      lastError: null,
      lastErrorKind: null,
    });
    this.notify(teamId);
  }

  markError(
    teamId: string,
    operationId: string,
    kind: SyncErrorKind,
    message: string,
    retryable: boolean,
  ): void {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return;
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
    this.write(teamId, record.roster, {
      ...record.sync,
      outbox,
      lastError: message,
      lastErrorKind: kind,
    });
    this.notify(teamId);
  }

  markConflict(
    teamId: string,
    operationId: string,
    remoteRevision: number,
    remotePayload: unknown,
  ): void {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return;
    const operation = record.sync.outbox.find((item) => item.id === operationId);
    if (!operation) return;
    const conflict: TeamSyncConflict = {
      operationId,
      entityKey: teamEntityKey(operation.entityType, operation.entityId),
      detectedAt: this.now(),
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
            lastError: "La ficha remota cambió desde la revisión local conocida.",
          }
        : item,
    );
    this.write(teamId, record.roster, {
      ...record.sync,
      outbox,
      conflicts: [
        ...record.sync.conflicts.filter((item) => item.operationId !== operationId),
        conflict,
      ],
      lastError: "Conflicto detectado. La ficha local se conserva.",
      lastErrorKind: "CONFLICT",
    });
    this.notify(teamId);
  }

  retryErrors(teamId: string): void {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return;
    const outbox = record.sync.outbox.map((operation) =>
      operation.status === "ERROR"
        ? {
            ...operation,
            status: "PENDING" as const,
            nextAttemptAt: 0,
            lastError: undefined,
            errorKind: undefined,
          }
        : operation,
    );
    this.write(teamId, record.roster, {
      ...record.sync,
      outbox,
      lastError: null,
      lastErrorKind: null,
    });
    this.notify(teamId);
  }

  subscribe(teamId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(teamId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(teamId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(teamId);
    };
  }

  private notify(teamId: string): void {
    this.listeners.get(teamId)?.forEach((listener) => listener());
  }
}

export const browserTeamRepository = new LocalTeamRepository();

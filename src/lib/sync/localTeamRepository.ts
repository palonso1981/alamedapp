import { browserMatchStorage, LocalStorageAdapter } from "../matchPersistence";
import {
  MasterPlayer,
  MasterStaffMember,
  Season,
  SeasonPlayer,
  SeasonStaff,
  TeamProfile,
  TeamRoster,
  TeamWorkspace,
} from "../../types";
import { defaultTeamProfile, emptyTeamWorkspace } from "../seasonDomain";
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

const TEAM_STORAGE_VERSION = 2 as const;
const TEAM_STORAGE_PREFIX = "alamedapp:team:v1:";

interface TeamEnvelope {
  storageVersion: typeof TEAM_STORAGE_VERSION;
  savedAt: number;
  roster: TeamWorkspace;
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
    (player.dateOfBirth === undefined || typeof player.dateOfBirth === "string") &&
    (player.primaryPosition === undefined || ["GOALKEEPER", "FIXO", "WINGER", "PIVOT", "UNIVERSAL"].includes(String(player.primaryPosition))) &&
    (player.dominantFoot === undefined || ["RIGHT", "LEFT", "BOTH"].includes(String(player.dominantFoot))) &&
    (player.canPlayGoalkeeper === undefined || typeof player.canPlayGoalkeeper === "boolean") &&
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

function validTeam(value: unknown, teamId: string): value is TeamProfile {
  if (typeof value !== "object" || value === null) return false;
  const team = value as Partial<TeamProfile>;
  return (
    team.teamId === teamId &&
    typeof team.name === "string" &&
    typeof team.shortName === "string" &&
    typeof team.active === "boolean" &&
    typeof team.createdAt === "number" &&
    typeof team.updatedAt === "number"
  );
}

function validSeason(value: unknown, teamId: string): value is Season {
  if (typeof value !== "object" || value === null) return false;
  const season = value as Partial<Season>;
  return (
    typeof season.seasonId === "string" &&
    season.teamId === teamId &&
    typeof season.label === "string" &&
    typeof season.current === "boolean" &&
    typeof season.active === "boolean" &&
    typeof season.createdAt === "number" &&
    typeof season.updatedAt === "number"
  );
}

function validSeasonPlayer(value: unknown, teamId: string): value is SeasonPlayer {
  if (typeof value !== "object" || value === null) return false;
  const membership = value as Partial<SeasonPlayer>;
  return (
    membership.teamId === teamId &&
    typeof membership.seasonId === "string" &&
    typeof membership.playerId === "string" &&
    typeof membership.number === "number" &&
    typeof membership.active === "boolean" &&
    typeof membership.createdAt === "number" &&
    typeof membership.updatedAt === "number"
  );
}

function validSeasonStaff(value: unknown, teamId: string): value is SeasonStaff {
  if (typeof value !== "object" || value === null) return false;
  const membership = value as Partial<SeasonStaff>;
  return (
    membership.teamId === teamId &&
    typeof membership.seasonId === "string" &&
    typeof membership.staffId === "string" &&
    ["HEAD_COACH", "ASSISTANT_COACH", "DELEGATE", "FITNESS_COACH", "OTHER"].includes(
      String(membership.role),
    ) &&
    typeof membership.active === "boolean" &&
    typeof membership.createdAt === "number" &&
    typeof membership.updatedAt === "number"
  );
}

function validPayload(
  entityType: TeamEntityType,
  payload: unknown,
  teamId: string,
): payload is TeamSyncPayload {
  if (entityType === "TEAM") return validTeam(payload, teamId);
  if (entityType === "PLAYER") return validPlayer(payload);
  if (entityType === "STAFF") return validStaff(payload);
  if (entityType === "SEASON") return validSeason(payload, teamId);
  if (entityType === "SEASON_PLAYER") return validSeasonPlayer(payload, teamId);
  return validSeasonStaff(payload, teamId);
}

function validOperation(value: unknown, teamId: string): value is TeamSyncOperation {
  if (typeof value !== "object" || value === null) return false;
  const operation = value as Partial<TeamSyncOperation>;
  return (
    typeof operation.id === "string" &&
    operation.teamId === teamId &&
    ["TEAM", "PLAYER", "STAFF", "SEASON", "SEASON_PLAYER", "SEASON_STAFF"].includes(
      String(operation.entityType),
    ) &&
    typeof operation.entityId === "string" &&
    operation.kind === "UPSERT" &&
    typeof operation.baseRevision === "number" &&
    typeof operation.clientUpdatedAt === "number" &&
    typeof operation.attempts === "number" &&
    ["PENDING", "SYNCING", "ERROR", "CONFLICT"].includes(String(operation.status)) &&
    typeof operation.nextAttemptAt === "number" &&
    validPayload(operation.entityType as TeamEntityType, operation.payload, teamId)
  );
}

function migrateSync(value: unknown, teamId: string): TeamSyncState {
  if (typeof value !== "object" || value === null) return emptyTeamSyncState();
  const source = value as Partial<TeamSyncState> & { schemaVersion?: number };
  if (Number(source.schemaVersion) !== 1 && Number(source.schemaVersion) !== 2) {
    return emptyTeamSyncState();
  }
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
    schemaVersion: 2,
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
    const parsed = JSON.parse(raw) as {
      storageVersion?: number;
      savedAt?: number;
      roster?: Partial<TeamWorkspace>;
      sync?: unknown;
    };
    if (
      (parsed.storageVersion !== 1 && parsed.storageVersion !== TEAM_STORAGE_VERSION) ||
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
    const workspace: TeamWorkspace = parsed.storageVersion === 1
      ? {
          teamId,
          team: defaultTeamProfile(teamId, parsed.savedAt),
          players: parsed.roster.players,
          staff: parsed.roster.staff,
          seasons: [],
          seasonPlayers: [],
          seasonStaff: [],
        }
      : {
          teamId,
          team: validTeam(parsed.roster.team, teamId)
            ? parsed.roster.team
            : defaultTeamProfile(teamId, parsed.savedAt),
          players: parsed.roster.players,
          staff: parsed.roster.staff,
          seasons: Array.isArray(parsed.roster.seasons)
            ? parsed.roster.seasons.filter((season) => validSeason(season, teamId))
            : [],
          seasonPlayers: Array.isArray(parsed.roster.seasonPlayers)
            ? parsed.roster.seasonPlayers.filter((membership) =>
                validSeasonPlayer(membership, teamId),
              )
            : [],
          seasonStaff: Array.isArray(parsed.roster.seasonStaff)
            ? parsed.roster.seasonStaff.filter((membership) =>
                validSeasonStaff(membership, teamId),
              )
            : [],
        };
    return {
      storageVersion: TEAM_STORAGE_VERSION,
      savedAt: parsed.savedAt,
      roster: workspace,
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
  private readonly inFlightOperationIds = new Set<string>();

  constructor(options: LocalTeamRepositoryOptions = {}) {
    this.storageOverride = options.storage;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  }

  private storage(): LocalStorageAdapter | null {
    return this.storageOverride === undefined ? browserMatchStorage() : this.storageOverride;
  }

  private withLiveInFlightState(sync: TeamSyncState): TeamSyncState {
    return {
      ...sync,
      outbox: sync.outbox.map((operation) =>
        this.inFlightOperationIds.has(operation.id)
          ? { ...operation, status: "SYNCING" as const }
          : operation,
      ),
    };
  }

  private write(teamId: string, roster: TeamWorkspace, sync: TeamSyncState): boolean {
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

  load(teamId: string): TeamWorkspace {
    return readEnvelope(teamId, this.storage())?.roster ?? emptyTeamWorkspace(teamId);
  }

  getSyncState(teamId: string): TeamSyncState {
    const sync = readEnvelope(teamId, this.storage())?.sync ?? emptyTeamSyncState();
    return this.withLiveInFlightState(sync);
  }

  getSummary(teamId: string): MatchSyncSummary {
    return summarizeTeamSync(this.getSyncState(teamId));
  }

  save(roster: TeamWorkspace | TeamRoster): boolean {
    const workspace: TeamWorkspace = "team" in roster
      ? roster
      : {
          ...emptyTeamWorkspace(roster.teamId, this.now()),
          players: roster.players,
          staff: roster.staff,
        };
    const previous = readEnvelope(workspace.teamId, this.storage());
    let sync = this.withLiveInFlightState(previous?.sync ?? emptyTeamSyncState());
    const now = this.now();
    if (!previous || !sameValue(previous.roster.team, workspace.team)) {
      sync = enqueue(sync, workspace.teamId, "TEAM", workspace.teamId, workspace.team, now, this.idFactory);
    }
    const previousPlayers = new Map(
      (previous?.roster.players ?? []).map((player) => [player.playerId, player]),
    );
    for (const player of workspace.players) {
      if (sameValue(previousPlayers.get(player.playerId), player)) continue;
      sync = enqueue(sync, workspace.teamId, "PLAYER", player.playerId, player, now, this.idFactory);
    }
    const previousStaff = new Map(
      (previous?.roster.staff ?? []).map((member) => [member.staffId, member]),
    );
    for (const member of workspace.staff) {
      if (sameValue(previousStaff.get(member.staffId), member)) continue;
      sync = enqueue(sync, workspace.teamId, "STAFF", member.staffId, member, now, this.idFactory);
    }
    const previousSeasons = new Map(
      (previous?.roster.seasons ?? []).map((season) => [season.seasonId, season]),
    );
    for (const season of workspace.seasons) {
      if (sameValue(previousSeasons.get(season.seasonId), season)) continue;
      sync = enqueue(sync, workspace.teamId, "SEASON", season.seasonId, season, now, this.idFactory);
    }
    const previousSeasonPlayers = new Map(
      (previous?.roster.seasonPlayers ?? []).map((membership) => [
        `${membership.seasonId}:${membership.playerId}`,
        membership,
      ]),
    );
    for (const membership of workspace.seasonPlayers) {
      const entityId = `${membership.seasonId}:${membership.playerId}`;
      if (sameValue(previousSeasonPlayers.get(entityId), membership)) continue;
      sync = enqueue(
        sync,
        workspace.teamId,
        "SEASON_PLAYER",
        entityId,
        membership,
        now,
        this.idFactory,
      );
    }
    const previousSeasonStaff = new Map(
      (previous?.roster.seasonStaff ?? []).map((membership) => [
        `${membership.seasonId}:${membership.staffId}`,
        membership,
      ]),
    );
    for (const membership of workspace.seasonStaff) {
      const entityId = `${membership.seasonId}:${membership.staffId}`;
      if (sameValue(previousSeasonStaff.get(entityId), membership)) continue;
      sync = enqueue(
        sync,
        workspace.teamId,
        "SEASON_STAFF",
        entityId,
        membership,
        now,
        this.idFactory,
      );
    }
    const saved = this.write(workspace.teamId, workspace, sync);
    if (saved) this.notify(workspace.teamId);
    return saved;
  }

  claimNextOperation(teamId: string): TeamSyncOperation | null {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return null;
    const sync = this.withLiveInFlightState(record.sync);
    const index = sync.outbox.findIndex(
      (operation) =>
        (operation.status === "PENDING" || operation.status === "ERROR") &&
        operation.nextAttemptAt <= this.now(),
    );
    if (index < 0) return null;
    const operation: TeamSyncOperation = {
      ...sync.outbox[index],
      status: "SYNCING",
      attempts: sync.outbox[index].attempts + 1,
      lastError: undefined,
      errorKind: undefined,
    };
    const outbox = [...sync.outbox];
    outbox[index] = operation;
    if (!this.write(teamId, record.roster, { ...sync, outbox })) return null;
    this.inFlightOperationIds.add(operation.id);
    this.notify(teamId);
    return operation;
  }

  markSynced(teamId: string, operationId: string, remoteRevision: number): void {
    const record = readEnvelope(teamId, this.storage());
    if (!record) return;
    const operation = record.sync.outbox.find((item) => item.id === operationId);
    if (!operation) return;
    this.inFlightOperationIds.delete(operationId);
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
    this.inFlightOperationIds.delete(operationId);
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

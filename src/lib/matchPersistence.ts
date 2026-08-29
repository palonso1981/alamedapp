import {
  assertValidChronology,
  normalizeMatchClock,
  REGULATION_MATCH_CLOCK,
  synchronizeThreatSequencePhases,
} from "./matchEngine";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  MatchEvent,
  MatchSession,
  Player,
  StaffMember,
} from "../types";
import {
  emptyMatchSyncState,
  migrateMatchSyncState,
  PersistedMatchSyncState,
} from "./sync/syncTypes";

export const MATCH_LOCAL_STORAGE_VERSION = 2 as const;
const LEGACY_MATCH_LOCAL_STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = "alamedapp:match:v1:";

export interface LocalStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PersistedMatchSession {
  matchId: string;
  players: Player[];
  staff: StaffMember[];
  period: number;
  minute: number;
  periodMinutes: Record<number, number>;
  closedPeriods: number[];
  periodCloseSnapshots?: Record<number, number>;
  reviewPeriod?: number;
  reviewMinute?: number;
  matchFinished: boolean;
  events: MatchEvent[];
  past: MatchEvent[][];
  future: MatchEvent[][];
}

interface PersistedMatchEnvelope {
  storageVersion:
    | typeof LEGACY_MATCH_LOCAL_STORAGE_VERSION
    | typeof MATCH_LOCAL_STORAGE_VERSION;
  savedAt: number;
  session: PersistedMatchSession;
  sync?: PersistedMatchSyncState;
}

export interface PersistedMatchRecord {
  session: MatchSession;
  sync: PersistedMatchSyncState;
  storageVersion: number;
  savedAt: number;
}

export type SaveMatchResult =
  | { ok: true; savedAt: number }
  | { ok: false; unavailable: boolean; message: string };

export function matchStorageKey(matchId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(matchId)}`;
}

export function browserMatchStorage(): LocalStorageAdapter | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlayer(value: unknown): value is Player {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.number === "number" &&
    (value.photoUrl === undefined || typeof value.photoUrl === "string")
  );
}

function isStaffMember(value: unknown): value is StaffMember {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    (value.photoUrl === undefined || typeof value.photoUrl === "string")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasEventBase(value: Record<string, unknown>, matchId: string): boolean {
  return (
    value.schemaVersion === MATCH_EVENT_SCHEMA_VERSION &&
    value.matchId === matchId &&
    typeof value.id === "string" &&
    Number.isInteger(value.period) &&
    Number.isInteger(value.minute) &&
    Number.isInteger(value.order) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    (value.deletedAt === null || typeof value.deletedAt === "number") &&
    typeof value.pendingReview === "boolean"
  );
}

function isOrigin(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function isGoalkeeperReference(value: unknown): boolean {
  return (
    isObject(value) &&
    (value.status === "PENDING" ||
      (value.status === "PLAYER" &&
        typeof value.playerId === "string" &&
        (value.resolution === undefined ||
          value.resolution === "REPLAY" ||
          value.resolution === "MANUAL")))
  );
}

function isDefensiveDetail(value: unknown): boolean {
  if (!isObject(value) || (value.version !== 1 && value.version !== 2)) return false;
  const common =
    isObject(value.goalTarget) &&
    (value.goalTarget.geometryVersion === 1 ||
      value.goalTarget.geometryVersion === 2) &&
    isOrigin(value.goalTarget) &&
    isGoalkeeperReference(value.goalkeeper) &&
    (value.saveOutcome === undefined ||
      value.saveOutcome === "CATCH" ||
      value.saveOutcome === "REBOUND" ||
      value.saveOutcome === "CLEARANCE");
  if (!common) return false;
  if (value.version === 1) {
    return value.keeperBodyZone === undefined ||
      value.keeperBodyZone === "UPPER" ||
      value.keeperBodyZone === "LOWER";
  }
  return value.keeperBodyPart === undefined || [
    "HEAD", "TORSO", "LEFT_ARM_HAND", "RIGHT_ARM_HAND",
    "LEFT_LEG_FOOT", "RIGHT_LEG_FOOT",
  ].includes(String(value.keeperBodyPart));
}

function isEvent(value: unknown, matchId: string): value is MatchEvent {
  if (!isObject(value) || !hasEventBase(value, matchId)) {
    return false;
  }
  if (value.type === "lineup_initialized") {
    return (
      isStringArray(value.squadPlayerIds) && isStringArray(value.onCourtPlayerIds)
    );
  }
  if (value.type === "substitution") {
    return (
      typeof value.playerOutId === "string" &&
      typeof value.playerInId === "string" &&
      (value.relatedCardEventId === undefined ||
        typeof value.relatedCardEventId === "string")
    );
  }
  if (value.type === "game_state_changed") {
    return (
      (value.state === "SUPERIORITY" ||
        value.state === "FLYING_GOALKEEPER") &&
      typeof value.active === "boolean" &&
      (value.playerId === undefined || typeof value.playerId === "string")
    );
  }
  if (value.type === "foul_recorded") {
    return (
      (value.side === "FOR" || value.side === "AGAINST") &&
      (value.source === "live" || value.source === "legacy_local") &&
      (value.playerId === undefined || typeof value.playerId === "string") &&
      (value.origin === undefined || isOrigin(value.origin)) &&
      (value.source !== "live" || typeof value.playerId === "string")
    );
  }
  if (value.type === "card_recorded") {
    return (
      (value.side === "FOR" || value.side === "AGAINST") &&
      (value.color === "YELLOW" || value.color === "RED") &&
      (value.playerId === undefined || typeof value.playerId === "string") &&
      (value.staffId === undefined || typeof value.staffId === "string")
    );
  }
  if (value.type !== "threat_recorded") {
    return false;
  }

  const validPhase = [
    "POSITIONAL",
    "TRANSITION",
    "SET_PIECE_CORNER",
    "SET_PIECE_FREE_KICK",
    "SET_PIECE_KICK_IN",
    "FLYING_GOALKEEPER",
    "PENALTY",
    "DOUBLE_PENALTY",
    "UNSPECIFIED",
  ].includes(String(value.phase));
  const commonThreat =
    (value.side === "FOR" || value.side === "AGAINST") &&
    (value.playerId === undefined || typeof value.playerId === "string") &&
    (value.sequenceId === undefined || typeof value.sequenceId === "string") &&
    (value.parentEventId === undefined ||
      typeof value.parentEventId === "string") &&
    (value.defensive === undefined || isDefensiveDetail(value.defensive)) &&
    (value.assist === undefined ||
      (isObject(value.assist) &&
        (value.assist.status === "NONE" ||
          value.assist.status === "PENDING" ||
          (value.assist.status === "PLAYER" &&
            typeof value.assist.playerId === "string")))) &&
    isOrigin(value.origin) &&
    validPhase;

  if (value.source === "live") {
    return (
      commonThreat &&
      value.phase !== "UNSPECIFIED" &&
      ["GOL", "PARADA", "FUERA"].includes(String(value.outcome))
    );
  }
  return (
    value.source === "legacy_import" &&
    commonThreat &&
    ["GOL", "PARADA", "FUERA", "BLOQUEADO"].includes(String(value.outcome))
  );
}

function migrateEvent(value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }
  let migrated = value;
  if (migrated.type === "foul_recorded" && migrated.source === undefined) {
    migrated = { ...migrated, source: "legacy_local" };
  }
  if (migrated.type === "threat_recorded" && migrated.sequenceId === undefined) {
    migrated = { ...migrated, sequenceId: migrated.id };
  }
  if (migrated.pendingReview === undefined) {
    migrated = { ...migrated, pendingReview: false };
  }
  return migrated;
}

function migrateEventList(value: unknown): unknown {
  return Array.isArray(value) ? value.map(migrateEvent) : value;
}

function migrateChronology(value: unknown, matchId: unknown): unknown {
  const migrated = migrateEventList(value);
  return typeof matchId === "string" && isEventList(migrated, matchId)
    ? synchronizeThreatSequencePhases(migrated)
    : migrated;
}

function migratePersistedSession(value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }
  const clock = normalizeMatchClock(
    typeof value.period === "number" ? value.period : 1,
    typeof value.minute === "number" ? value.minute : 0,
  );
  const persistedPeriodMinutes = isObject(value.periodMinutes)
    ? value.periodMinutes
    : {};
  const periodMinutes = Object.fromEntries(
    Array.from(
      { length: REGULATION_MATCH_CLOCK.regulationPeriods },
      (_, index) => index + 1,
    ).map((period) => {
      const candidate = persistedPeriodMinutes[String(period)];
      const minute =
        typeof candidate === "number"
          ? normalizeMatchClock(period, candidate).minute
          : period === clock.period
            ? clock.minute
            : 0;
      return [period, minute];
    }),
  );
  const reviewPeriod =
    typeof value.reviewPeriod === "number" &&
    Number.isInteger(value.reviewPeriod) &&
    value.reviewPeriod >= 1 &&
    value.reviewPeriod <= REGULATION_MATCH_CLOCK.regulationPeriods
      ? value.reviewPeriod
      : undefined;
  const reviewMinute =
    reviewPeriod !== undefined && typeof value.reviewMinute === "number"
      ? normalizeMatchClock(reviewPeriod, value.reviewMinute).minute
      : undefined;
  const periodCloseSnapshots = isObject(value.periodCloseSnapshots)
    ? Object.fromEntries(
        Object.entries(value.periodCloseSnapshots).flatMap(([period, minute]) => {
          const numericPeriod = Number(period);
          return Number.isInteger(numericPeriod) &&
            numericPeriod >= 1 &&
            numericPeriod <= REGULATION_MATCH_CLOCK.regulationPeriods &&
            typeof minute === "number"
            ? [[numericPeriod, normalizeMatchClock(numericPeriod, minute).minute]]
            : [];
        }),
      )
    : {};
  return {
    ...value,
    ...clock,
    staff: Array.isArray(value.staff) ? value.staff : [],
    periodMinutes,
    closedPeriods: Array.isArray(value.closedPeriods)
      ? value.closedPeriods.filter(
          (period): period is number =>
            typeof period === "number" &&
            Number.isInteger(period) &&
            period >= 1 &&
            period <= REGULATION_MATCH_CLOCK.regulationPeriods,
        )
      : [],
    periodCloseSnapshots,
    ...(reviewPeriod === undefined
      ? { reviewPeriod: undefined, reviewMinute: undefined }
      : { reviewPeriod, reviewMinute }),
    matchFinished: value.matchFinished === true,
    events: migrateChronology(value.events, value.matchId),
    past: Array.isArray(value.past)
      ? value.past.map((events) => migrateChronology(events, value.matchId))
      : value.past,
    future: Array.isArray(value.future)
      ? value.future.map((events) => migrateChronology(events, value.matchId))
      : value.future,
  };
}

function validPeriodMinutes(value: unknown): value is Record<number, number> {
  if (!isObject(value)) {
    return false;
  }
  return Array.from(
    { length: REGULATION_MATCH_CLOCK.regulationPeriods },
    (_, index) => index + 1,
  ).every((period) => {
    const minute = value[String(period)];
    return (
      typeof minute === "number" &&
      Number.isInteger(minute) &&
      minute >= 0 &&
      minute <= REGULATION_MATCH_CLOCK.periodDurationMinutes
    );
  });
}

function isEventList(value: unknown, matchId: string): value is MatchEvent[] {
  return Array.isArray(value) && value.every((event) => isEvent(event, matchId));
}

function validPersistedSession(
  value: unknown,
  expectedMatchId: string,
): value is PersistedMatchSession {
  if (
    !isObject(value) ||
    value.matchId !== expectedMatchId ||
    !Array.isArray(value.players) ||
    !value.players.every(isPlayer) ||
    !Array.isArray(value.staff) ||
    !value.staff.every(isStaffMember) ||
    typeof value.period !== "number" ||
    !Number.isInteger(value.period) ||
    value.period < 1 ||
    value.period > REGULATION_MATCH_CLOCK.regulationPeriods ||
    typeof value.minute !== "number" ||
    !Number.isInteger(value.minute) ||
    value.minute < 0 ||
    value.minute > REGULATION_MATCH_CLOCK.periodDurationMinutes ||
    !validPeriodMinutes(value.periodMinutes) ||
    value.periodMinutes[value.period] !== value.minute ||
    !Array.isArray(value.closedPeriods) ||
    !value.closedPeriods.every(
      (period) =>
        typeof period === "number" &&
        Number.isInteger(period) &&
        period >= 1 &&
        period <= REGULATION_MATCH_CLOCK.regulationPeriods,
    ) ||
    !isObject(value.periodCloseSnapshots) ||
    !Object.entries(value.periodCloseSnapshots).every(([period, minute]) => {
      const numericPeriod = Number(period);
      return (
        Number.isInteger(numericPeriod) &&
        numericPeriod >= 1 &&
        numericPeriod <= REGULATION_MATCH_CLOCK.regulationPeriods &&
        typeof minute === "number" &&
        Number.isInteger(minute) &&
        minute >= 0 &&
        minute <= REGULATION_MATCH_CLOCK.periodDurationMinutes
      );
    }) ||
    (value.reviewPeriod !== undefined &&
      (typeof value.reviewPeriod !== "number" ||
        !Number.isInteger(value.reviewPeriod) ||
        !(value.closedPeriods as number[]).includes(value.reviewPeriod) ||
        value.reviewPeriod === value.period ||
        typeof value.reviewMinute !== "number" ||
        !Number.isInteger(value.reviewMinute) ||
        value.reviewMinute < 0 ||
        value.reviewMinute > REGULATION_MATCH_CLOCK.periodDurationMinutes)) ||
    (value.reviewPeriod === undefined && value.reviewMinute !== undefined) ||
    typeof value.matchFinished !== "boolean" ||
    !isEventList(value.events, expectedMatchId) ||
    !Array.isArray(value.past) ||
    !value.past.every((events) => isEventList(events, expectedMatchId)) ||
    !Array.isArray(value.future) ||
    !value.future.every((events) => isEventList(events, expectedMatchId))
  ) {
    return false;
  }

  try {
    const players = value.players as Player[];
    const events = value.events as MatchEvent[];
    const past = value.past as MatchEvent[][];
    const future = value.future as MatchEvent[][];

    const staffIds = new Set((value.staff as StaffMember[]).map((member) => member.id));
    const validStaffReferences = [events, ...past, ...future].every(
      (chronology) =>
        chronology.every(
          (event) =>
            event.type !== "card_recorded" ||
            !event.staffId ||
            staffIds.has(event.staffId),
        ),
    );
    if (!validStaffReferences) {
      return false;
    }

    assertValidChronology(players, events);
    past.forEach((chronology) => assertValidChronology(players, chronology));
    future.forEach((chronology) => assertValidChronology(players, chronology));
    return true;
  } catch {
    return false;
  }
}

export function saveMatchSession(
  session: MatchSession,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
  now = Date.now(),
): SaveMatchResult {
  const sync = loadMatchRecord(session.matchId, storage)?.sync ?? emptyMatchSyncState();
  return saveMatchRecord(session, sync, storage, now);
}

export function saveMatchRecord(
  session: MatchSession,
  sync: PersistedMatchSyncState,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
  now = Date.now(),
): SaveMatchResult {
  if (!storage) {
    return {
      ok: false,
      unavailable: true,
      message: "El almacenamiento local no está disponible.",
    };
  }

  const envelope: PersistedMatchEnvelope = {
    storageVersion: MATCH_LOCAL_STORAGE_VERSION,
    savedAt: now,
    session: {
      matchId: session.matchId,
      players: session.players,
      staff: session.staff,
      period: session.period,
      minute: session.minute,
      periodMinutes: session.periodMinutes,
      closedPeriods: session.closedPeriods ?? [],
      periodCloseSnapshots: session.periodCloseSnapshots ?? {},
      reviewPeriod: session.reviewPeriod,
      reviewMinute: session.reviewMinute,
      matchFinished: session.matchFinished ?? false,
      events: session.events,
      past: session.past,
      future: session.future,
    },
    sync,
  };

  try {
    storage.setItem(matchStorageKey(session.matchId), JSON.stringify(envelope));
    return { ok: true, savedAt: now };
  } catch {
    return {
      ok: false,
      unavailable: false,
      message: "No se pudo guardar el partido en el dispositivo.",
    };
  }
}

export function loadMatchSession(
  matchId: string,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): MatchSession | null {
  return loadMatchRecord(matchId, storage)?.session ?? null;
}

export function loadMatchRecord(
  matchId: string,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): PersistedMatchRecord | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(matchStorageKey(matchId));
    if (!raw) {
      return null;
    }
    const envelope: unknown = JSON.parse(raw);
    const migratedSession = isObject(envelope)
      ? migratePersistedSession(envelope.session)
      : null;
    if (
      !isObject(envelope) ||
      (envelope.storageVersion !== LEGACY_MATCH_LOCAL_STORAGE_VERSION &&
        envelope.storageVersion !== MATCH_LOCAL_STORAGE_VERSION) ||
      typeof envelope.savedAt !== "number" ||
      !validPersistedSession(migratedSession, matchId)
    ) {
      return null;
    }

    return {
      session: {
        ...migratedSession,
        lastError: null,
        persistenceStatus: "saved",
        lastSavedAt: envelope.savedAt,
      },
      sync:
        envelope.storageVersion === MATCH_LOCAL_STORAGE_VERSION
          ? migrateMatchSyncState(envelope.sync, matchId)
          : emptyMatchSyncState(),
      storageVersion: envelope.storageVersion,
      savedAt: envelope.savedAt,
    };
  } catch {
    return null;
  }
}

import { assertValidChronology } from "./matchEngine";
import {
  MATCH_EVENT_SCHEMA_VERSION,
  MatchEvent,
  MatchSession,
  Player,
} from "../types";

export const MATCH_LOCAL_STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = "alamedapp:match:v1:";

export interface LocalStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PersistedMatchSession {
  matchId: string;
  players: Player[];
  period: number;
  minute: number;
  events: MatchEvent[];
  past: MatchEvent[][];
  future: MatchEvent[][];
}

interface PersistedMatchEnvelope {
  storageVersion: typeof MATCH_LOCAL_STORAGE_VERSION;
  savedAt: number;
  session: PersistedMatchSession;
}

export type SaveMatchResult =
  | { ok: true; savedAt: number }
  | { ok: false; unavailable: boolean; message: string };

export function matchStorageKey(matchId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(matchId)}`;
}

function browserStorage(): LocalStorageAdapter | null {
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
    typeof value.number === "number"
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
    (value.deletedAt === null || typeof value.deletedAt === "number")
  );
}

function isOrigin(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
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
      typeof value.playerInId === "string"
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
    typeof value.period !== "number" ||
    !Number.isInteger(value.period) ||
    value.period < 1 ||
    typeof value.minute !== "number" ||
    !Number.isInteger(value.minute) ||
    value.minute < 0 ||
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
  storage: LocalStorageAdapter | null = browserStorage(),
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
      period: session.period,
      minute: session.minute,
      events: session.events,
      past: session.past,
      future: session.future,
    },
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
  storage: LocalStorageAdapter | null = browserStorage(),
): MatchSession | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(matchStorageKey(matchId));
    if (!raw) {
      return null;
    }
    const envelope: unknown = JSON.parse(raw);
    if (
      !isObject(envelope) ||
      envelope.storageVersion !== MATCH_LOCAL_STORAGE_VERSION ||
      typeof envelope.savedAt !== "number" ||
      !validPersistedSession(envelope.session, matchId)
    ) {
      return null;
    }

    return {
      ...envelope.session,
      lastError: null,
      persistenceStatus: "saved",
      lastSavedAt: envelope.savedAt,
    };
  } catch {
    return null;
  }
}

import { browserMatchStorage, LocalStorageAdapter } from "./matchPersistence";
import { CDA_CLUB_ID, MatchLifecycleStatus, MatchSession, MatchVenue } from "../types";
import { canAccessTeam } from "./access/accessDomain";
import { getRuntimeAccessGrant } from "./access/accessRuntime";

const CATALOG_KEY = "alamedapp:matches:index:v1";

export interface MatchCatalogEntry {
  matchId: string;
  clubId?: string;
  teamId?: string;
  seasonId?: string;
  opponent: string;
  venue: MatchVenue;
  date: string;
  time?: string;
  status: MatchLifecycleStatus;
  updatedAt: number;
  archivedAt?: number;
  deletedAt?: number;
  eventCount?: number;
  playerIds?: string[];
  staffIds?: string[];
}

function validEntry(value: unknown): value is MatchCatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<MatchCatalogEntry>;
  return (
    typeof entry.matchId === "string" &&
    (entry.clubId === undefined || typeof entry.clubId === "string") &&
    (entry.teamId === undefined || typeof entry.teamId === "string") &&
    (entry.seasonId === undefined || typeof entry.seasonId === "string") &&
    typeof entry.opponent === "string" &&
    (entry.venue === "HOME" || entry.venue === "AWAY") &&
    typeof entry.date === "string" &&
    ["DRAFT", "READY", "LIVE", "FINISHED"].includes(String(entry.status)) &&
    typeof entry.updatedAt === "number"
  );
}

function readMatchCatalog(
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): MatchCatalogEntry[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(CATALOG_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(validEntry).sort((a, b) => b.date.localeCompare(a.date))
      : [];
  } catch {
    return [];
  }
}

export function listMatchCatalog(
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): MatchCatalogEntry[] {
  const entries = readMatchCatalog(storage);
  const grant = getRuntimeAccessGrant();
  if (grant === undefined) return entries;
  return entries.filter((entry) =>
    canAccessTeam(grant, matchCatalogClubId(entry), entry.teamId),
  );
}

export function visibleMatchCatalog(
  entries: readonly MatchCatalogEntry[],
  includeArchived = false,
): MatchCatalogEntry[] {
  return entries.filter((entry) => !entry.deletedAt && (includeArchived || !entry.archivedAt));
}

export function matchCatalogClubId(entry: MatchCatalogEntry): string {
  return entry.clubId ?? CDA_CLUB_ID;
}

export function updateMatchCatalog(
  session: MatchSession,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): void {
  const preparation = session.preparation;
  if (!storage || !preparation) return;
  const entry: MatchCatalogEntry = {
    matchId: session.matchId,
    clubId: preparation.clubId ?? CDA_CLUB_ID,
    teamId: preparation.teamId,
    seasonId: preparation.seasonId,
    opponent: preparation.opponent,
    venue: preparation.venue,
    date: preparation.date,
    time: preparation.time,
    status: session.matchFinished ? "FINISHED" : preparation.status,
    updatedAt: preparation.updatedAt,
    archivedAt: preparation.archivedAt,
    deletedAt: preparation.deletedAt,
    eventCount: session.events.length,
    playerIds: session.players.map((player) => player.id),
    staffIds: session.staff.map((member) => member.id),
  };
  // El indice durable conserva tambien las entradas invisibles para el acceso
  // activo; aplicar scope aqui perderia datos locales al guardar un partido.
  const entries = readMatchCatalog(storage).filter((item) => item.matchId !== session.matchId);
  try {
    storage.setItem(CATALOG_KEY, JSON.stringify([...entries, entry]));
  } catch {
    // La sesión principal sigue siendo la copia durable; el índice es reconstruible.
  }
}

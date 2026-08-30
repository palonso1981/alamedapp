import { browserMatchStorage, LocalStorageAdapter } from "./matchPersistence";
import { MatchLifecycleStatus, MatchSession, MatchVenue } from "../types";

const CATALOG_KEY = "alamedapp:matches:index:v1";

export interface MatchCatalogEntry {
  matchId: string;
  opponent: string;
  venue: MatchVenue;
  date: string;
  time?: string;
  status: MatchLifecycleStatus;
  updatedAt: number;
}

function validEntry(value: unknown): value is MatchCatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<MatchCatalogEntry>;
  return (
    typeof entry.matchId === "string" &&
    typeof entry.opponent === "string" &&
    (entry.venue === "HOME" || entry.venue === "AWAY") &&
    typeof entry.date === "string" &&
    ["DRAFT", "READY", "LIVE", "FINISHED"].includes(String(entry.status)) &&
    typeof entry.updatedAt === "number"
  );
}

export function listMatchCatalog(
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

export function updateMatchCatalog(
  session: MatchSession,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): void {
  const preparation = session.preparation;
  if (!storage || !preparation) return;
  const entry: MatchCatalogEntry = {
    matchId: session.matchId,
    opponent: preparation.opponent,
    venue: preparation.venue,
    date: preparation.date,
    time: preparation.time,
    status: session.matchFinished ? "FINISHED" : preparation.status,
    updatedAt: preparation.updatedAt,
  };
  const entries = listMatchCatalog(storage).filter((item) => item.matchId !== session.matchId);
  try {
    storage.setItem(CATALOG_KEY, JSON.stringify([...entries, entry]));
  } catch {
    // La sesión principal sigue siendo la copia durable; el índice es reconstruible.
  }
}

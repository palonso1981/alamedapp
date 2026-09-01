import { browserMatchStorage, LocalStorageAdapter } from "./matchPersistence";
import { ClubRegistryState, defaultClubRegistry } from "./clubDomain";
import { CDA_CLUB_ID } from "../types";

const CLUB_REGISTRY_KEY = "alamedapp:clubs:index:v1";

function valid(value: unknown): value is ClubRegistryState {
  if (typeof value !== "object" || value === null) return false;
  const registry = value as Partial<ClubRegistryState>;
  return registry.schemaVersion === 1 &&
    Array.isArray(registry.clubIds) &&
    registry.clubIds.every((id) => typeof id === "string") &&
    typeof registry.currentClubId === "string";
}

export function loadClubRegistry(
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): ClubRegistryState {
  if (!storage) return defaultClubRegistry();
  try {
    const parsed = JSON.parse(storage.getItem(CLUB_REGISTRY_KEY) ?? "null") as unknown;
    if (!valid(parsed)) return defaultClubRegistry();
    const clubIds = Array.from(new Set([CDA_CLUB_ID, ...parsed.clubIds]));
    return {
      schemaVersion: 1,
      clubIds,
      currentClubId: clubIds.includes(parsed.currentClubId) ? parsed.currentClubId : CDA_CLUB_ID,
    };
  } catch {
    return defaultClubRegistry();
  }
}

export function saveClubRegistry(
  registry: ClubRegistryState,
  storage: LocalStorageAdapter | null = browserMatchStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CLUB_REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch {
    return false;
  }
}

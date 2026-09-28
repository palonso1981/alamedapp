import { AccessStorage, browserAccessStorage } from "./access/accessPersistence";
import { loadLocalCaptureSession } from "./captureLease";
import { LocalStorageAdapter, loadMatchRecord } from "./matchPersistence";
import { browserMatchRepository, VolatileMatchRecovery } from "./sync/localMatchRepository";

export const RECOVERY_BUNDLE_SCHEMA_VERSION = 1 as const;

type RecoveryStorage = AccessStorage & LocalStorageAdapter;

export function createMatchRecoveryBundle(
  matchId: string,
  storage: RecoveryStorage | null = browserAccessStorage(),
  now = Date.now(),
  volatile: VolatileMatchRecovery | null = null,
) {
  const record = volatile?.record ?? loadMatchRecord(matchId, storage);
  if (!record) throw new Error("No existe una copia local recuperable de este partido.");
  return {
    schemaVersion: RECOVERY_BUNDLE_SCHEMA_VERSION,
    kind: "ALAMEDAPP_MATCH_RECOVERY" as const,
    exportedAt: now,
    matchId,
    localStorageVersion: record.storageVersion,
    savedAt: record.savedAt,
    durability: volatile ? "MEMORY_ONLY" as const : "LOCAL_DURABLE" as const,
    storageFailure: volatile?.diagnostic ?? null,
    captureSession: loadLocalCaptureSession(matchId, storage),
    session: record.session,
    sync: record.sync,
  };
}

export function downloadMatchRecoveryBundle(matchId: string): void {
  const bundle = createMatchRecoveryBundle(
    matchId,
    browserAccessStorage(),
    Date.now(),
    browserMatchRepository.getVolatileFailure(matchId),
  );
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `alamedapp-recovery-${matchId}-${bundle.exportedAt}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

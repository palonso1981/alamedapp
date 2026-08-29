import { LocalMatchRepository } from "./localMatchRepository";
import {
  classifyRemoteError,
  RemoteMatchRepository,
} from "./remoteMatchRepository";
import { MatchSyncSummary } from "./syncTypes";

export interface SyncCoordinatorOptions {
  isOnline?: () => boolean;
  maxOperationsPerRun?: number;
  debug?: (message: string, data?: unknown) => void;
}

export class MatchSyncCoordinator {
  private readonly running = new Map<string, Promise<MatchSyncSummary>>();
  private readonly isOnline: () => boolean;
  private readonly maxOperationsPerRun: number;
  private readonly debug?: (message: string, data?: unknown) => void;

  constructor(
    private readonly local: LocalMatchRepository,
    private readonly remote: RemoteMatchRepository,
    options: SyncCoordinatorOptions = {},
  ) {
    this.isOnline =
      options.isOnline ??
      (() => typeof navigator === "undefined" || navigator.onLine);
    this.maxOperationsPerRun = options.maxOperationsPerRun ?? 250;
    this.debug = options.debug;
  }

  syncMatch(matchId: string): Promise<MatchSyncSummary> {
    const existing = this.running.get(matchId);
    if (existing) return existing;
    // Defer process until the running promise is registered. claim/mark methods
    // notify subscribers synchronously and a subscriber may request another sync.
    const running = Promise.resolve().then(() => this.process(matchId)).finally(() => {
      this.running.delete(matchId);
    });
    this.running.set(matchId, running);
    return running;
  }

  retryMatch(matchId: string): Promise<MatchSyncSummary> {
    this.local.retryErrors(matchId);
    return this.syncMatch(matchId);
  }

  private async process(matchId: string): Promise<MatchSyncSummary> {
    if (!this.isOnline()) return this.local.getSummary(matchId);
    let processed = 0;
    while (processed < this.maxOperationsPerRun && this.isOnline()) {
      const operation = this.local.claimNextOperation(matchId);
      if (!operation) break;
      processed += 1;
      this.debug?.("sync:attempt", {
        matchId,
        operationId: operation.id,
        entityType: operation.entityType,
        entityId: operation.entityId,
        attempt: operation.attempts,
      });
      try {
        const result = await this.remote.apply(operation);
        if (result.status === "CONFLICT") {
          this.local.markConflict(
            matchId,
            operation.id,
            result.remoteRevision,
            result.remotePayload,
          );
          this.debug?.("sync:conflict", {
            matchId,
            operationId: operation.id,
            remoteRevision: result.remoteRevision,
          });
          break;
        }
        this.local.markSynced(matchId, operation.id, result.revision);
        this.debug?.("sync:success", {
          matchId,
          operationId: operation.id,
          result: result.status,
          revision: result.revision,
        });
      } catch (error) {
        const classified = classifyRemoteError(error);
        this.local.markError(
          matchId,
          operation.id,
          classified.kind,
          classified.message,
          classified.retryable,
        );
        this.debug?.("sync:error", {
          matchId,
          operationId: operation.id,
          kind: classified.kind,
          retryable: classified.retryable,
        });
        break;
      }
    }
    return this.local.getSummary(matchId);
  }
}

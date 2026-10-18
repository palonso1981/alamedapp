import { replayMatch } from "./matchEngine";

type ReplayPlayers = Parameters<typeof replayMatch>[0];
type ReplayEvents = Parameters<typeof replayMatch>[1];
type ReplayOptions = Parameters<typeof replayMatch>[2];
type ReplayResult = ReturnType<typeof replayMatch>;

interface DashboardReplayMetrics {
  hits: number;
  misses: number;
}

let cache = new WeakMap<object, WeakMap<object, Map<string, ReplayResult>>>();
const metrics: DashboardReplayMetrics = { hits: 0, misses: 0 };

function optionKey(options?: ReplayOptions): string {
  if (!options) return "FULL";
  return JSON.stringify({
    currentClock: options.currentClock ?? null,
    throughClock: options.throughClock ?? null,
    throughPosition: options.throughPosition ?? null,
    periodDurationMinutes: options.periodDurationMinutes ?? null,
    foulThresholds: options.foulAccumulationRules?.thresholds ?? null,
  });
}

/**
 * Dashboard-only replay memoization.
 *
 * Match sessions are immutable snapshots in the UI. Using the players/events
 * array identities therefore gives us automatic invalidation when hydration or
 * an edit replaces either source array, without changing event-sourcing
 * semantics or making this cache a source of truth.
 */
export function replayDashboardMatch(
  players: ReplayPlayers,
  events: ReplayEvents,
  options?: ReplayOptions,
): ReplayResult {
  const playersKey = players as object;
  const eventsKey = events as object;
  let byEvents = cache.get(playersKey);
  if (!byEvents) {
    byEvents = new WeakMap<object, Map<string, ReplayResult>>();
    cache.set(playersKey, byEvents);
  }
  let byClock = byEvents.get(eventsKey);
  if (!byClock) {
    byClock = new Map<string, ReplayResult>();
    byEvents.set(eventsKey, byClock);
  }
  const key = optionKey(options);
  const current = byClock.get(key);
  if (current) {
    metrics.hits += 1;
    return current;
  }
  metrics.misses += 1;
  const calculated = replayMatch(players, events, options);
  byClock.set(key, calculated);
  return calculated;
}

export function dashboardReplayMetrics(): Readonly<DashboardReplayMetrics> {
  return { ...metrics };
}

export function resetDashboardReplayCache(): void {
  cache = new WeakMap<object, WeakMap<object, Map<string, ReplayResult>>>();
  metrics.hits = 0;
  metrics.misses = 0;
}

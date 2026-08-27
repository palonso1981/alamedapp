import {
  GoalAssist,
  INFERIORITY_SLOT_ID,
  MatchEvent,
  TimelineEntry,
} from "../types";
import { sortEvents } from "./matchEngine";

export type TimelineFilter = "ALL" | "PENDING";

export function filterTimelineEvents(
  events: MatchEvent[],
  filter: TimelineFilter,
): MatchEvent[] {
  const visible = events.filter((event) => event.type !== "lineup_initialized");
  return sortEvents(
    filter === "PENDING"
      ? visible.filter(
          (event) => event.pendingReview && event.deletedAt === null,
        )
      : visible,
  ).reverse();
}

export function assistCandidates(
  lineupPlayerIds: readonly string[],
  scorerId?: string,
): string[] {
  return lineupPlayerIds.filter(
    (playerId) => playerId !== scorerId && playerId !== INFERIORITY_SLOT_ID,
  );
}

export function assistCandidatesForEntry(entry: TimelineEntry): string[] {
  const event = entry.event;
  return event.type === "threat_recorded"
    ? assistCandidates(entry.lineupPlayerIds, event.playerId)
    : [];
}

export function assistNeedsReview(assist?: GoalAssist): boolean {
  return assist?.status === "PENDING";
}

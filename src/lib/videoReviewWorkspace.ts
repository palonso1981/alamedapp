import {
  appendEvent,
  createCardEvent,
  createFoulCountAdjustmentEvent,
  createFoulEvent,
  createGameStateEvent,
  createLineupInitializedEvent,
  createLiveThreatEvent,
  createPossessionLostEvent,
  createRestartEvent,
  createSubstitutionEvent,
  getNextOrder,
  MatchIntegrityError,
  moveEventWithinMinute,
  replayMatch,
  sortEvents,
} from "./matchEngine";
import { videoSyncSegmentId } from "./videoIndex";
import {
  CardColor,
  EventPosition,
  GameStateKind,
  LiveThreatOutcome,
  LiveThreatPhase,
  MatchEvent,
  MatchSession,
  MatchVideoEventOverride,
  MatchVideoSegment,
  NormalizedCoordinates,
  RestartKind,
  RestartSpatialSide,
  ThreatSide,
} from "../types";

export type VideoReviewEventInput =
  | { kind: "THREAT"; side: ThreatSide; playerId?: string; origin: NormalizedCoordinates; outcome: LiveThreatOutcome; phase: LiveThreatPhase }
  | { kind: "LOSS"; playerId: string }
  | { kind: "FOUL"; side: ThreatSide; playerId?: string | null; origin?: NormalizedCoordinates }
  | { kind: "CARD"; side: ThreatSide; color: CardColor; playerId?: string; staffId?: string }
  | { kind: "RESTART"; side: ThreatSide; restart: RestartKind; spatialSide: RestartSpatialSide }
  | { kind: "SUBSTITUTION"; playerOutId: string; playerInId: string }
  | { kind: "GAME_STATE"; state: GameStateKind; active: boolean; playerId?: string; side?: ThreatSide }
  | { kind: "FOUL_ADJUSTMENT"; side: ThreatSide; delta: 1 | -1 };

export interface VideoReviewCreation {
  event: MatchEvent;
  override: MatchVideoEventOverride;
  referenceEventId?: string;
}

export interface VideoReviewWorkspaceState {
  hasSquad: boolean;
  hasInitialLineup: boolean;
  sportsEventCount: number;
  mode: "EMPTY" | "LINEUP_ONLY" | "PARTIAL_OR_COMPLETE";
}

export function inspectVideoReviewWorkspace(session: MatchSession): VideoReviewWorkspaceState {
  const active = session.events.filter((event) => event.deletedAt === null);
  const hasInitialLineup = active.some((event) => event.type === "lineup_initialized" && event.period === 1);
  const sportsEventCount = active.filter((event) => event.type !== "lineup_initialized").length;
  return {
    hasSquad: session.players.length >= 5,
    hasInitialLineup,
    sportsEventCount,
    mode: !hasInitialLineup ? "EMPTY" : sportsEventCount === 0 ? "LINEUP_ONLY" : "PARTIAL_OR_COMPLETE",
  };
}

export function preciseVideoSecond(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 10) / 10);
}

export function shiftPreciseVideoSecond(value: number, delta: -5 | -1 | 1 | 5): number {
  return preciseVideoSecond(value + delta);
}

export function formatPreciseVideoTime(value: number): string {
  const safe = preciseVideoSecond(value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function createVideoReviewLineup(
  session: MatchSession,
  period: number,
  onCourtPlayerIds: string[],
  goalkeeperPlayerId: string,
  now = Date.now(),
): MatchEvent {
  const unique = Array.from(new Set(onCourtPlayerIds));
  const squad = session.players.map((player) => player.id);
  if (unique.length !== 5 || unique.some((playerId) => !squad.includes(playerId))) {
    throw new Error("El quinteto inicial requiere cinco jugadores convocados distintos.");
  }
  if (!unique.includes(goalkeeperPlayerId)) throw new Error("El portero funcional debe formar parte del quinteto.");
  if (session.events.some((event) => event.deletedAt === null && event.type === "lineup_initialized" && event.period === period)) {
    throw new Error(`P${period} ya tiene un quinteto inicial.`);
  }
  return createLineupInitializedEvent({
    id: `${session.matchId}:video-review:lineup:p${period}`,
    matchId: session.matchId,
    position: { period, minute: 0, order: 1 },
    squadPlayerIds: squad,
    onCourtPlayerIds: unique,
    goalkeeperPlayerId,
    provenance: "VIDEO",
    now,
  });
}

function eventAtPosition(
  session: MatchSession,
  position: EventPosition,
  input: VideoReviewEventInput,
  id: string,
  now: number,
): MatchEvent {
  const base = { id, matchId: session.matchId, position, provenance: "VIDEO" as const, now };
  if (input.kind === "THREAT") return createLiveThreatEvent({ ...base, ...input, assist: input.side === "FOR" && input.outcome === "GOL" ? { status: "PENDING" } : undefined, pendingReview: input.side === "FOR" && input.outcome === "GOL" });
  if (input.kind === "LOSS") return createPossessionLostEvent({ ...base, playerId: input.playerId });
  if (input.kind === "FOUL") return createFoulEvent({ ...base, side: input.side, playerId: input.playerId, origin: input.origin });
  if (input.kind === "CARD") return createCardEvent({ ...base, side: input.side, color: input.color, playerId: input.playerId, staffId: input.staffId });
  if (input.kind === "RESTART") return createRestartEvent({ ...base, side: input.side, restart: input.restart, spatialSide: input.spatialSide });
  if (input.kind === "SUBSTITUTION") return createSubstitutionEvent({ ...base, playerOutId: input.playerOutId, playerInId: input.playerInId });
  if (input.kind === "GAME_STATE") return createGameStateEvent({ ...base, state: input.state, active: input.active, playerId: input.playerId, side: input.side });
  return createFoulCountAdjustmentEvent({ ...base, side: input.side, delta: input.delta });
}

export function createVideoReviewEvent(
  session: MatchSession,
  segment: MatchVideoSegment,
  position: Pick<EventPosition, "period" | "minute">,
  videoSecond: number,
  input: VideoReviewEventInput,
  options: { referenceEventId?: string; id?: string; now?: number } = {},
): VideoReviewCreation {
  if (!segment.periods.includes(position.period as 1 | 2)) throw new Error("La parte de vídeo no cubre el periodo deportivo elegido.");
  const now = options.now ?? Date.now();
  const id = options.id ?? globalThis.crypto.randomUUID();
  const event = eventAtPosition(session, {
    ...position,
    order: getNextOrder(session.events, position.period, position.minute),
  }, input, id, now);
  return {
    event,
    referenceEventId: options.referenceEventId,
    override: {
      matchId: session.matchId,
      eventId: id,
      segmentId: segment.id,
      syncSegmentId: videoSyncSegmentId(segment.id, position.period as 1 | 2),
      videoSecond: preciseVideoSecond(videoSecond),
      status: "VERIFIED",
      timeSource: "manual",
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Aplica la misma inserción/orden/replay canónicos que Directo y Revisión. */
export function applyVideoReviewCreation(session: MatchSession, creation: VideoReviewCreation): MatchSession {
  let events: MatchEvent[];
  try {
    events = appendEvent(session.players, session.events, creation.event);
  } catch (error) {
    if (!(error instanceof MatchIntegrityError)) throw error;
    const candidate = sortEvents([...session.events, creation.event]);
    const issues = replayMatch(session.players, candidate).issues;
    // Revisión histórica puede revelar errores posteriores preexistentes. El
    // nuevo evento debe ser válido; las consecuencias posteriores se exponen
    // como advertencias y jamás se reasignan automáticamente.
    if (issues.some((issue) => issue.eventId === creation.event.id)) throw error;
    events = candidate;
  }
  const reference = creation.referenceEventId
    ? events.find((event) => event.id === creation.referenceEventId && event.period === creation.event.period && event.minute === creation.event.minute)
    : undefined;
  if (reference) {
    try {
      events = moveEventWithinMinute(session.players, events, creation.event.id, reference.id, "AFTER");
    } catch (error) {
      if (!(error instanceof MatchIntegrityError)) throw error;
      const activeGroup = sortEvents(events).filter((event) => event.deletedAt === null && event.period === creation.event.period && event.minute === creation.event.minute && event.id !== creation.event.id);
      const referenceIndex = activeGroup.findIndex((event) => event.id === reference.id);
      activeGroup.splice(referenceIndex + 1, 0, creation.event);
      const orderById = new Map(activeGroup.map((event, index) => [event.id, index + 1]));
      events = sortEvents(events.map((event) => orderById.has(event.id) ? { ...event, order: orderById.get(event.id)! } : event));
    }
  }
  const overrides = [
    ...(session.videoEventOverrides ?? []).filter((item) => item.eventId !== creation.event.id),
    creation.override,
  ];
  return { ...session, events, videoEventOverrides: overrides };
}

export function replayVideoReviewAt(session: MatchSession, period: number, minute: number, order = Number.MAX_SAFE_INTEGER) {
  return replayMatch(session.players, session.events, { throughPosition: { period, minute, order } });
}

export function videoReviewReferenceAtOrBefore(session: MatchSession, period: number, minute: number): MatchEvent | undefined {
  return sortEvents(session.events)
    .filter((event) => event.deletedAt === null && (event.period < period || (event.period === period && event.minute <= minute)))
    .at(-1);
}

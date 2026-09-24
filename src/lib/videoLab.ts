import { isVideoReviewableEvent } from "./videoReview";
import { replayMatch, sortEvents } from "./matchEngine";
import { normalizeLeadSeconds, videoEventTime } from "./videoIndex";
import {
  MatchEvent,
  MatchSession,
  MatchVideoPeriod,
  MatchVideoSegment,
} from "../types";

export type VideoLabTimeSource = "observedAt" | "createdAt" | "manual";
export type VideoLabVerificationStatus = "AUTO" | "VERIFIED";
export type VideoLabTemporalFamily = "NORMAL" | "PREPARATORY_RESTART" | "LANDMARK";

export interface VideoLabSyncSegment {
  id: string;
  physicalSegmentId: string;
  period: MatchVideoPeriod;
  videoId: string;
  label: string;
  leadSeconds: number;
  anchors: MatchVideoSegment["anchors"];
}

export interface VideoLabAnchorDiagnostic {
  count: number;
  spreadSeconds: number;
  status: "NONE" | "SINGLE" | "COHERENT" | "DRIFT_WARNING";
  /** Diferencias respecto al anchor primario; nunca alteran por sí solas la estimación. */
  deltasFromPrimary: number[];
}

export interface VideoLabVerification {
  eventId: string;
  syncSegmentId: string;
  videoSecond: number;
  status: "VERIFIED";
  timeSource: "manual";
}

export interface VideoLabTimelineRow {
  event: MatchEvent;
  temporalFamily: VideoLabTemporalFamily;
  clipEligible: boolean;
  syncSegmentId?: string;
  videoId?: string;
  estimatedSecond?: number;
  openSecond?: number;
  leadSeconds: number;
  status: VideoLabVerificationStatus;
  timeSource?: VideoLabTimeSource;
  diagnostic: VideoLabAnchorDiagnostic;
}

export type VideoLabVerificationMap = Record<string, VideoLabVerification>;

const EMPTY_DIAGNOSTIC: VideoLabAnchorDiagnostic = {
  count: 0,
  spreadSeconds: 0,
  status: "NONE",
  deltasFromPrimary: [],
};

export function buildVideoLabSyncSegments(session: MatchSession): VideoLabSyncSegment[] {
  return (session.videoSegments ?? []).flatMap((segment) =>
    segment.periods.map((period) => ({
      id: `${segment.id}:P${period}`,
      physicalSegmentId: segment.id,
      period,
      videoId: segment.videoId,
      label: `${segment.label} · P${period}`,
      leadSeconds: normalizeLeadSeconds(segment.leadSeconds),
      anchors: segment.anchors.filter((anchor) => {
        const event = session.events.find((candidate) => candidate.id === anchor.eventId);
        return event?.period === period;
      }),
    })),
  );
}

export function isVideoLabTimelineEvent(event: MatchEvent): boolean {
  return event.deletedAt === null && !["lineup_initialized", "foul_count_adjusted"].includes(event.type);
}

export function videoLabTemporalFamily(event: MatchEvent): VideoLabTemporalFamily {
  if (event.type === "restart_recorded") return "PREPARATORY_RESTART";
  if (event.type === "substitution" || event.type === "game_state_changed") return "LANDMARK";
  return "NORMAL";
}

export function isVideoLabClipEligible(event: MatchEvent): boolean {
  return event.type !== "substitution" && isVideoReviewableEvent(event);
}

function resolveAutomatic(
  session: MatchSession,
  event: MatchEvent,
  segment: VideoLabSyncSegment,
): Pick<VideoLabTimelineRow, "estimatedSecond" | "openSecond" | "timeSource" | "diagnostic"> {
  const eventTime = videoEventTime(event);
  if (!eventTime || segment.anchors.length === 0) return { diagnostic: EMPTY_DIAGNOSTIC };
  const eventById = new Map(session.events.map((candidate) => [candidate.id, candidate]));
  const offsets = segment.anchors.flatMap((anchor) => {
    const anchorEvent = eventById.get(anchor.eventId);
    const anchorTime = anchorEvent ? videoEventTime(anchorEvent) : null;
    return anchorEvent?.period === segment.period && anchorTime
      ? [anchor.videoSecond - anchorTime.timestamp / 1000]
      : [];
  });
  if (offsets.length === 0) return { diagnostic: EMPTY_DIAGNOSTIC };

  // El primer anchor válido es el origen operativo. Los siguientes diagnostican
  // deriva; la interpolación futura será una decisión explícita, no una mediana oculta.
  const primaryOffset = offsets[0];
  const estimatedSecond = Math.max(0, Math.round(eventTime.timestamp / 1000 + primaryOffset));
  const deltasFromPrimary = offsets.slice(1).map((offset) => offset - primaryOffset);
  const spreadSeconds = offsets.length > 1 ? Math.max(...offsets) - Math.min(...offsets) : 0;
  return {
    estimatedSecond,
    openSecond: Math.max(0, estimatedSecond - segment.leadSeconds),
    timeSource: eventTime.source,
    diagnostic: {
      count: offsets.length,
      spreadSeconds,
      status: offsets.length === 1 ? "SINGLE" : spreadSeconds <= 5 ? "COHERENT" : "DRIFT_WARNING",
      deltasFromPrimary,
    },
  };
}

export function buildVideoLabTimeline(
  session: MatchSession,
  verifications: VideoLabVerificationMap = {},
): VideoLabTimelineRow[] {
  const syncSegments = buildVideoLabSyncSegments(session);
  return sortEvents(session.events)
    .filter(isVideoLabTimelineEvent)
    .map((event) => {
      const segment = syncSegments.find((candidate) => candidate.period === event.period);
      const leadSeconds = segment?.leadSeconds ?? 6;
      const verification = verifications[event.id];
      const persistedOverride = segment
        ? (session.videoEventOverrides ?? []).find((candidate) => candidate.eventId === event.id && candidate.segmentId === segment.physicalSegmentId)
        : undefined;
      const verifiedSecond = verification && verification.syncSegmentId === segment?.id
        ? verification.videoSecond
        : persistedOverride?.videoSecond;
      if (segment && verifiedSecond !== undefined) {
        return {
          event,
          temporalFamily: videoLabTemporalFamily(event),
          clipEligible: isVideoLabClipEligible(event),
          syncSegmentId: segment.id,
          videoId: segment.videoId,
          estimatedSecond: verifiedSecond,
          openSecond: Math.max(0, verifiedSecond - leadSeconds),
          leadSeconds,
          status: "VERIFIED" as const,
          timeSource: "manual" as const,
          diagnostic: resolveAutomatic(session, event, segment).diagnostic,
        };
      }
      const automatic = segment ? resolveAutomatic(session, event, segment) : { diagnostic: EMPTY_DIAGNOSTIC };
      return {
        event,
        temporalFamily: videoLabTemporalFamily(event),
        clipEligible: isVideoLabClipEligible(event),
        syncSegmentId: segment?.id,
        videoId: segment?.videoId,
        leadSeconds,
        status: "AUTO" as const,
        ...automatic,
      };
    });
}

export function verifyVideoLabEvent(
  current: VideoLabVerificationMap,
  row: VideoLabTimelineRow,
  videoSecond = row.estimatedSecond,
): VideoLabVerificationMap {
  if (!row.syncSegmentId || videoSecond === undefined || !Number.isFinite(videoSecond)) return current;
  return {
    ...current,
    [row.event.id]: {
      eventId: row.event.id,
      syncSegmentId: row.syncSegmentId,
      videoSecond: Math.max(0, Math.round(videoSecond)),
      status: "VERIFIED",
      timeSource: "manual",
    },
  };
}

export function shiftVideoSecond(current: number, delta: -5 | -1 | 1 | 5): number {
  return Math.max(0, Math.round(current + delta));
}

export function videoLabSeekSecond(row: VideoLabTimelineRow): number | null {
  return row.openSecond ?? row.estimatedSecond ?? null;
}

export function nextVideoLabRow(
  rows: readonly VideoLabTimelineRow[],
  syncSegmentId: string,
  currentEventId: string,
): VideoLabTimelineRow | null {
  const segmentRows = rows.filter((row) => row.syncSegmentId === syncSegmentId);
  if (segmentRows.length < 2) return null;
  const index = segmentRows.findIndex((row) => row.event.id === currentEventId);
  if (index < 0 || index === segmentRows.length - 1) return null;
  return segmentRows[index + 1];
}

export function currentVideoLabRow(
  rows: readonly VideoLabTimelineRow[],
  syncSegmentId: string,
  currentSecond: number,
): VideoLabTimelineRow | null {
  return rows
    .filter((row) => row.syncSegmentId === syncSegmentId && row.estimatedSecond !== undefined)
    .reduce<VideoLabTimelineRow | null>((current, row) => {
      const candidateSecond = row.estimatedSecond ?? Infinity;
      const currentBest = current?.estimatedSecond ?? -1;
      return candidateSecond <= currentSecond && candidateSecond > currentBest ? row : current;
    }, null);
}

export type VideoLabDraft =
  | {
      kind: "SPORTS_EVENT";
      provenance: "VIDEO";
      referenceEventId: string;
      placement: "BEFORE" | "AFTER";
      period: number;
      minute: number;
      onCourtPlayerIds: string[];
    }
  | {
      kind: "TACTICAL_NOTE";
      referenceEventId: string;
      videoSecond: number;
      affectsStatistics: false;
    };

/** Prepara una inserción deportiva revisable sin mutar cronología ni estadísticas. */
export function proposeVideoSportsInsertion(
  session: MatchSession,
  referenceEventId: string,
  placement: "BEFORE" | "AFTER",
): Extract<VideoLabDraft, { kind: "SPORTS_EVENT" }> | null {
  const ordered = sortEvents(session.events).filter((event) => event.deletedAt === null);
  const index = ordered.findIndex((event) => event.id === referenceEventId);
  if (index < 0) return null;
  const reference = ordered[index];
  const through = placement === "AFTER" ? reference : ordered[index - 1];
  const replay = replayMatch(session.players, session.events, {
    throughPosition: through
      ? { period: through.period, minute: through.minute, order: through.order }
      : { period: reference.period, minute: reference.minute, order: -1 },
  });
  return {
    kind: "SPORTS_EVENT",
    provenance: "VIDEO",
    referenceEventId,
    placement,
    period: reference.period,
    minute: reference.minute,
    onCourtPlayerIds: replay.onCourtPlayerIds,
  };
}

export function createVideoTacticalNoteDraft(
  referenceEventId: string,
  videoSecond: number,
): Extract<VideoLabDraft, { kind: "TACTICAL_NOTE" }> {
  return {
    kind: "TACTICAL_NOTE",
    referenceEventId,
    videoSecond: Math.max(0, Math.round(videoSecond)),
    affectsStatistics: false,
  };
}

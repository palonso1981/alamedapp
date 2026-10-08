import {
  MatchEvent,
  MatchSession,
  MatchVideoAnchor,
  MatchVideoCalibration,
  MatchVideoEventOverride,
  MatchVideoPeriod,
  MatchVideoSegment,
  MatchVideoSyncCheck,
} from "../types";

export const DEFAULT_VIDEO_LEAD_SECONDS = 6;
export const MAX_VIDEO_LEAD_SECONDS = 20;
export const COHERENT_ANCHOR_SPREAD_SECONDS = 5;

export type VideoResolutionQuality =
  | "MANUAL"
  | "SINGLE_ANCHOR"
  | "MULTI_ANCHOR_COHERENT"
  | "MULTI_ANCHOR_WARNING";

export type VideoPositionResolution =
  | { status: "NO_VIDEO" }
  | { status: "NO_POSITION"; segmentId: string }
  | { status: "PENDING_SYNC"; segmentId: string; videoId: string }
  | {
      status: "RESOLVED";
      segmentId: string;
      videoId: string;
      estimatedSecond: number;
      openSecond: number;
      leadSeconds: number;
      url: string;
      quality: VideoResolutionQuality;
      anchorSpreadSeconds: number;
    };

export type VideoEventTime = {
  timestamp: number;
  source: "observedAt" | "createdAt";
};

/** Instante audiovisual fiable: la primera intención de captura prevalece sobre el guardado. */
export function videoEventTime(event: MatchEvent): VideoEventTime | null {
  if (event.provenance !== "LIVE") return null;
  if (event.videoTiming === "RETROSPECTIVE") return null;
  if (Number.isFinite(event.observedAt) && (event.observedAt ?? 0) > 0) {
    return { timestamp: event.observedAt!, source: "observedAt" };
  }
  return Number.isFinite(event.createdAt) && event.createdAt > 0
    ? { timestamp: event.createdAt, source: "createdAt" }
    : null;
}

export function parseYouTubeVideoId(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate: string | null = null;
  if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(kind)) candidate = id ?? null;
    }
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function parseVideoTimestamp(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  const seconds = numbers.at(-1) ?? NaN;
  const minutes = numbers.at(-2) ?? NaN;
  if (seconds > 59 || minutes > 59 || !numbers.every(Number.isSafeInteger)) return null;
  const hours = parts.length === 3 ? numbers[0] : 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatVideoTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function isVideoTimeResolvable(event: MatchEvent): boolean {
  return videoEventTime(event) !== null;
}

export function youtubeBaseUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** URL externa de una jugada concreta; comparte el mismo openSecond que el player interno. */
export function buildYouTubeWatchAtUrl(videoId: string, second: number): string {
  return `${youtubeBaseUrl(videoId)}&t=${Math.max(0, Math.round(second))}s`;
}

export function videoSyncSegmentId(segmentId: string, period: MatchVideoPeriod): string {
  return `${segmentId}:P${period}`;
}

export function compatibleVideoSegments(session: MatchSession, event: MatchEvent): MatchVideoSegment[] {
  return (session.videoSegments ?? [])
    .filter((segment) => segment.periods.includes(event.period as MatchVideoPeriod))
    .sort((a, b) => {
      const calibrated = (segment: MatchVideoSegment) => Number(
        segment.anchors.some((anchor) => session.events.find((item) => item.id === anchor.eventId)?.period === event.period) ||
        (session.videoCalibrations ?? []).some((item) => item.segmentId === segment.id && item.period === event.period),
      );
      const anchored = calibrated(b) - calibrated(a);
      return anchored || a.periods.length - b.periods.length || a.createdAt - b.createdAt;
    });
}

function compareEventPosition(left: MatchEvent, right: MatchEvent): number {
  return left.period - right.period || left.minute - right.minute || left.order - right.order || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export type AutomaticVideoPosition = {
  segment: MatchVideoSegment;
  syncSegmentId: string;
  estimatedSecond: number;
  openSecond: number;
  leadSeconds: number;
  timeSource: VideoEventTime["source"];
  calibrationId?: string;
  calibrationKind: "LEGACY_INITIAL" | MatchVideoCalibration["kind"];
  anchorSpreadSeconds: number;
  quality: Exclude<VideoResolutionQuality, "MANUAL">;
};

/**
 * Resolver AUTO canónico. Una calibración inicial define el offset base y cada
 * recalibración explícita lo sustituye únicamente desde su evento en adelante.
 * Las anchors legacy conservan la primera referencia válida de cada periodo;
 * nunca se reinterpretan silenciosamente como recalibraciones.
 */
export function resolveAutomaticEventVideoPosition(
  session: MatchSession,
  eventId: string,
): AutomaticVideoPosition | null {
  const event = session.events.find((candidate) => candidate.id === eventId);
  if (!event) return null;
  const eventTime = videoEventTime(event);
  const segment = compatibleVideoSegments(session, event)[0];
  if (!eventTime || !segment) return null;
  const period = event.period as MatchVideoPeriod;
  const syncSegmentId = videoSyncSegmentId(segment.id, period);
  const events = session.events.filter((candidate) => candidate.period === period).sort(compareEventPosition);
  const eventIndex = events.findIndex((candidate) => candidate.id === event.id);
  const eventById = new Map(session.events.map((candidate) => [candidate.id, candidate]));
  const calibrations = (session.videoCalibrations ?? [])
    .filter((item) => item.segmentId === segment.id && item.syncSegmentId === syncSegmentId && item.period === period)
    .flatMap((item) => {
      const calibrationEvent = eventById.get(item.eventId);
      const calibrationTime = calibrationEvent ? videoEventTime(calibrationEvent) : null;
      const index = calibrationEvent ? events.findIndex((candidate) => candidate.id === calibrationEvent.id) : -1;
      return calibrationEvent && calibrationTime && index >= 0
        ? [{ calibration: item, calibrationTime, index }]
        : [];
    });
  const initial = calibrations
    .filter((item) => item.calibration.kind === "INITIAL")
    .sort((a, b) => b.calibration.updatedAt - a.calibration.updatedAt)[0];
  const recalibration = calibrations
    .filter((item) => item.calibration.kind === "RECALIBRATION" && item.index <= eventIndex)
    .sort((a, b) => b.index - a.index || b.calibration.updatedAt - a.calibration.updatedAt)[0];

  let videoSecond: number;
  let referenceTime: VideoEventTime;
  let calibrationId: string | undefined;
  let calibrationKind: AutomaticVideoPosition["calibrationKind"];
  if (recalibration) {
    videoSecond = recalibration.calibration.videoSecond;
    referenceTime = recalibration.calibrationTime;
    calibrationId = recalibration.calibration.id;
    calibrationKind = "RECALIBRATION";
  } else if (initial) {
    videoSecond = initial.calibration.videoSecond;
    referenceTime = initial.calibrationTime;
    calibrationId = initial.calibration.id;
    calibrationKind = "INITIAL";
  } else {
    const legacyAnchors = segment.anchors.flatMap((anchor) => {
      const anchorEvent = eventById.get(anchor.eventId);
      const anchorTime = anchorEvent ? videoEventTime(anchorEvent) : null;
      return anchorEvent?.period === period && anchorTime ? [{ anchor, anchorTime }] : [];
    });
    const legacy = legacyAnchors[0];
    if (!legacy) return null;
    videoSecond = legacy.anchor.videoSecond;
    referenceTime = legacy.anchorTime;
    calibrationKind = "LEGACY_INITIAL";
  }

  const offset = videoSecond - referenceTime.timestamp / 1000;
  const estimatedSecond = Math.max(0, Math.round(eventTime.timestamp / 1000 + offset));
  const leadSeconds = normalizeLeadSeconds(segment.leadSeconds);
  const legacyOffsets = segment.anchors.flatMap((anchor) => {
    const anchorEvent = eventById.get(anchor.eventId);
    const anchorTime = anchorEvent ? videoEventTime(anchorEvent) : null;
    return anchorEvent?.period === period && anchorTime ? [anchor.videoSecond - anchorTime.timestamp / 1000] : [];
  });
  const anchorSpreadSeconds = legacyOffsets.length > 1 ? Math.max(...legacyOffsets) - Math.min(...legacyOffsets) : 0;
  return {
    segment,
    syncSegmentId,
    estimatedSecond,
    openSecond: Math.max(0, estimatedSecond - leadSeconds),
    leadSeconds,
    timeSource: eventTime.source,
    calibrationId,
    calibrationKind,
    anchorSpreadSeconds,
    quality: legacyOffsets.length <= 1
      ? "SINGLE_ANCHOR"
      : anchorSpreadSeconds <= COHERENT_ANCHOR_SPREAD_SECONDS
        ? "MULTI_ANCHOR_COHERENT"
        : "MULTI_ANCHOR_WARNING",
  };
}

export function resolveEventVideoPosition(
  session: MatchSession,
  eventId: string,
): VideoPositionResolution {
  const event = session.events.find((candidate) => candidate.id === eventId);
  if (!event) return { status: "NO_VIDEO" };
  const compatible = compatibleVideoSegments(session, event);
  const override = (session.videoEventOverrides ?? []).find((candidate) =>
    candidate.eventId === event.id &&
    Number.isSafeInteger(candidate.videoSecond) && candidate.videoSecond >= 0 &&
    compatible.some((segment) => segment.id === candidate.segmentId),
  );
  if (override) {
    const segment = compatible.find((candidate) => candidate.id === override.segmentId)!;
    const leadSeconds = normalizeLeadSeconds(segment.leadSeconds);
    const openSecond = Math.max(0, override.videoSecond - leadSeconds);
    return {
      status: "RESOLVED", segmentId: segment.id, videoId: segment.videoId,
      estimatedSecond: override.videoSecond, openSecond, leadSeconds,
      url: buildYouTubeWatchAtUrl(segment.videoId, openSecond), quality: "MANUAL",
      anchorSpreadSeconds: 0,
    };
  }
  const segment = compatible[0];
  if (!segment) return { status: "NO_VIDEO" };
  if (!isVideoTimeResolvable(event)) return { status: "NO_POSITION", segmentId: segment.id };
  const automatic = resolveAutomaticEventVideoPosition(session, event.id);
  if (!automatic) return { status: "PENDING_SYNC", segmentId: segment.id, videoId: segment.videoId };
  return {
    status: "RESOLVED",
    segmentId: automatic.segment.id,
    videoId: automatic.segment.videoId,
    estimatedSecond: automatic.estimatedSecond,
    openSecond: automatic.openSecond,
    leadSeconds: automatic.leadSeconds,
    url: buildYouTubeWatchAtUrl(automatic.segment.videoId, automatic.openSecond),
    quality: automatic.quality,
    anchorSpreadSeconds: automatic.anchorSpreadSeconds,
  };
}

export function normalizeLeadSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VIDEO_LEAD_SECONDS;
  return Math.min(MAX_VIDEO_LEAD_SECONDS, Math.max(0, Math.round(value)));
}

export function createVideoSegment(input: {
  id?: string;
  urlOrVideoId: string;
  label?: string;
  periods: MatchVideoPeriod[];
  leadSeconds?: number;
  now?: number;
}): MatchVideoSegment {
  const videoId = parseYouTubeVideoId(input.urlOrVideoId);
  const periods = Array.from(new Set(input.periods)).filter((period): period is MatchVideoPeriod => period === 1 || period === 2);
  if (!videoId) throw new Error("La URL o ID de YouTube no es válido.");
  if (periods.length === 0) throw new Error("Indica si el vídeo corresponde a P1, P2 o ambas partes.");
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? globalThis.crypto.randomUUID(),
    provider: "YOUTUBE",
    videoId,
    label: input.label?.trim() || (periods.length === 2 ? "Partido completo" : periods[0] === 1 ? "1ª parte" : "2ª parte"),
    periods,
    leadSeconds: normalizeLeadSeconds(input.leadSeconds ?? DEFAULT_VIDEO_LEAD_SECONDS),
    anchors: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertVideoSegment(session: MatchSession, segment: MatchVideoSegment): MatchSession {
  const segments = session.videoSegments ?? [];
  const previous = segments.find((candidate) => candidate.id === segment.id);
  const normalized = {
    ...segment,
    periods: Array.from(new Set(segment.periods)),
    leadSeconds: normalizeLeadSeconds(segment.leadSeconds),
    anchors: previous && previous.videoId !== segment.videoId ? [] : segment.anchors,
  };
  const calibrationChanged = Boolean(previous && (
    previous.videoId !== segment.videoId ||
    previous.periods.join(",") !== normalized.periods.join(",") ||
    JSON.stringify(previous.anchors) !== JSON.stringify(normalized.anchors)
  ));
  return {
    ...session,
    videoSegments: previous
      ? segments.map((candidate) => candidate.id === normalized.id ? normalized : candidate)
      : [...segments, normalized],
    videoEventOverrides: previous && previous.videoId !== segment.videoId
      ? (session.videoEventOverrides ?? []).filter((item) => item.segmentId !== segment.id)
      : session.videoEventOverrides,
    videoCalibrations: previous && previous.videoId !== segment.videoId
      ? (session.videoCalibrations ?? []).filter((item) => item.segmentId !== segment.id)
      : session.videoCalibrations,
    videoSyncChecks: calibrationChanged
      ? (session.videoSyncChecks ?? []).filter((item) => item.segmentId !== segment.id)
      : session.videoSyncChecks,
  };
}

export function removeVideoSegment(session: MatchSession, segmentId: string): MatchSession {
  return {
    ...session,
    videoSegments: (session.videoSegments ?? []).filter((segment) => segment.id !== segmentId),
    videoEventOverrides: (session.videoEventOverrides ?? []).filter((item) => item.segmentId !== segmentId),
    videoCalibrations: (session.videoCalibrations ?? []).filter((item) => item.segmentId !== segmentId),
    videoSyncChecks: (session.videoSyncChecks ?? []).filter((item) => item.segmentId !== segmentId),
  };
}

export function upsertVideoCalibration(
  session: MatchSession,
  input: Omit<MatchVideoCalibration, "matchId" | "createdAt" | "updatedAt"> & { now?: number },
): MatchSession {
  const segment = (session.videoSegments ?? []).find((candidate) => candidate.id === input.segmentId);
  const event = session.events.find((candidate) => candidate.id === input.eventId);
  if (!segment || !event) throw new Error("No se encontró el vídeo o el evento elegido.");
  if (event.period !== input.period || !segment.periods.includes(input.period)) throw new Error("La calibración no pertenece al periodo del evento.");
  if (input.syncSegmentId !== videoSyncSegmentId(segment.id, input.period)) throw new Error("El segmento de sincronización no es coherente.");
  if (!videoEventTime(event)) throw new Error("Este evento no conserva un instante LIVE fiable.");
  if (!Number.isSafeInteger(input.videoSecond) || input.videoSecond < 0) throw new Error("El tiempo de vídeo no es válido.");
  const now = input.now ?? Date.now();
  const previous = (session.videoCalibrations ?? []).find((item) => item.id === input.id);
  const calibration: MatchVideoCalibration = {
    id: input.id,
    matchId: session.matchId,
    segmentId: input.segmentId,
    syncSegmentId: input.syncSegmentId,
    period: input.period,
    eventId: input.eventId,
    videoSecond: input.videoSecond,
    kind: input.kind,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const withoutSuperseded = (session.videoCalibrations ?? []).filter((item) =>
    item.id !== input.id &&
    !(input.kind === "INITIAL" && item.syncSegmentId === input.syncSegmentId && item.kind === "INITIAL") &&
    !(input.kind === "RECALIBRATION" && item.syncSegmentId === input.syncSegmentId && item.kind === "RECALIBRATION" && item.eventId === input.eventId),
  );
  return {
    ...session,
    videoCalibrations: [...withoutSuperseded, calibration],
    // Toda calibración nueva cambia el modelo temporal del periodo y obliga a
    // volver a comprobar sus controles; nunca toca overrides VERIFIED.
    videoSyncChecks: (session.videoSyncChecks ?? []).filter((item) => item.syncSegmentId !== input.syncSegmentId),
  };
}

export function confirmVideoSyncCheck(
  session: MatchSession,
  input: Omit<MatchVideoSyncCheck, "matchId" | "status" | "createdAt" | "updatedAt"> & { now?: number },
): MatchSession {
  const event = session.events.find((candidate) => candidate.id === input.eventId);
  if (!event || event.period !== input.period || !videoEventTime(event)) throw new Error("El punto de control no es fiable.");
  const now = input.now ?? Date.now();
  const previous = (session.videoSyncChecks ?? []).find((item) => item.syncSegmentId === input.syncSegmentId && item.eventId === input.eventId);
  const check: MatchVideoSyncCheck = {
    id: previous?.id ?? input.id,
    matchId: session.matchId,
    segmentId: input.segmentId,
    syncSegmentId: input.syncSegmentId,
    period: input.period,
    eventId: input.eventId,
    status: "CONFIRMED",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ...session,
    videoSyncChecks: [
      ...(session.videoSyncChecks ?? []).filter((item) => !(item.syncSegmentId === input.syncSegmentId && item.eventId === input.eventId)),
      check,
    ],
  };
}

export function upsertVideoEventOverride(
  session: MatchSession,
  input: {
    eventId: string;
    segmentId: string;
    syncSegmentId?: string;
    videoSecond: number;
    status?: "VERIFIED";
    timeSource?: "observedAt" | "createdAt" | "manual";
    now?: number;
  },
): MatchSession {
  const event = session.events.find((candidate) => candidate.id === input.eventId);
  const segment = (session.videoSegments ?? []).find((candidate) => candidate.id === input.segmentId);
  if (!event || !segment) throw new Error("No se encontró el vídeo o el evento elegido.");
  if (!segment.periods.includes(event.period as MatchVideoPeriod)) throw new Error("El evento no pertenece a una parte cubierta por este vídeo.");
  if (!Number.isSafeInteger(input.videoSecond) || input.videoSecond < 0) throw new Error("El tiempo de vídeo no es válido.");
  const now = input.now ?? Date.now();
  const previous = (session.videoEventOverrides ?? []).find((item) => item.eventId === input.eventId);
  const override: MatchVideoEventOverride = {
    matchId: session.matchId,
    eventId: input.eventId,
    segmentId: input.segmentId,
    syncSegmentId: input.syncSegmentId ?? input.segmentId,
    videoSecond: input.videoSecond,
    status: input.status ?? "VERIFIED",
    timeSource: input.timeSource ?? "manual",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ...session,
    videoEventOverrides: previous
      ? (session.videoEventOverrides ?? []).map((item) => item.eventId === input.eventId ? override : item)
      : [...(session.videoEventOverrides ?? []), override],
  };
}

export function removeVideoEventOverride(session: MatchSession, eventId: string): MatchSession {
  return { ...session, videoEventOverrides: (session.videoEventOverrides ?? []).filter((item) => item.eventId !== eventId) };
}

export function addVideoAnchor(
  session: MatchSession,
  segmentId: string,
  anchor: MatchVideoAnchor,
): MatchSession {
  const segment = (session.videoSegments ?? []).find((candidate) => candidate.id === segmentId);
  const event = session.events.find((candidate) => candidate.id === anchor.eventId);
  if (!segment || !event) throw new Error("No se encontró el vídeo o el evento elegido.");
  if (!isVideoTimeResolvable(event)) throw new Error("Este evento no conserva un instante de captura fiable.");
  if (!segment.periods.includes(event.period as MatchVideoPeriod)) throw new Error("El evento no pertenece a una parte cubierta por este vídeo.");
  if (!Number.isSafeInteger(anchor.videoSecond) || anchor.videoSecond < 0) throw new Error("El tiempo de vídeo no es válido.");
  const anchors = [...segment.anchors.filter((item) => item.id !== anchor.id), anchor];
  return upsertVideoSegment(session, { ...segment, anchors, updatedAt: Date.now() });
}

export function removeVideoAnchor(session: MatchSession, segmentId: string, anchorId: string): MatchSession {
  const segment = (session.videoSegments ?? []).find((candidate) => candidate.id === segmentId);
  if (!segment) return session;
  return upsertVideoSegment(session, { ...segment, anchors: segment.anchors.filter((anchor) => anchor.id !== anchorId), updatedAt: Date.now() });
}

import {
  MatchEvent,
  MatchSession,
  MatchVideoAnchor,
  MatchVideoPeriod,
  MatchVideoSegment,
} from "../types";

export const DEFAULT_VIDEO_LEAD_SECONDS = 6;
export const MAX_VIDEO_LEAD_SECONDS = 20;
export const COHERENT_ANCHOR_SPREAD_SECONDS = 5;

export type VideoResolutionQuality =
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
  return event.provenance === "LIVE" && Number.isFinite(event.createdAt) && event.createdAt > 0;
}

export function youtubeDeepLink(videoId: string, second: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.round(second))}s`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compatibleSegments(session: MatchSession, event: MatchEvent): MatchVideoSegment[] {
  return (session.videoSegments ?? [])
    .filter((segment) => segment.periods.includes(event.period as MatchVideoPeriod))
    .sort((a, b) => {
      const anchored = Number(b.anchors.length > 0) - Number(a.anchors.length > 0);
      return anchored || a.periods.length - b.periods.length || a.createdAt - b.createdAt;
    });
}

export function resolveEventVideoPosition(
  session: MatchSession,
  eventId: string,
): VideoPositionResolution {
  const event = session.events.find((candidate) => candidate.id === eventId);
  if (!event) return { status: "NO_VIDEO" };
  const segment = compatibleSegments(session, event)[0];
  if (!segment) return { status: "NO_VIDEO" };
  if (!isVideoTimeResolvable(event)) return { status: "NO_POSITION", segmentId: segment.id };
  const eventById = new Map(session.events.map((candidate) => [candidate.id, candidate]));
  const offsets = segment.anchors.flatMap((anchor) => {
    const anchorEvent = eventById.get(anchor.eventId);
    return anchorEvent && isVideoTimeResolvable(anchorEvent) && segment.periods.includes(anchorEvent.period as MatchVideoPeriod)
      ? [anchor.videoSecond - anchorEvent.createdAt / 1000]
      : [];
  });
  if (offsets.length === 0) return { status: "PENDING_SYNC", segmentId: segment.id, videoId: segment.videoId };
  const calibratedOffset = median(offsets);
  const estimatedSecond = Math.max(0, Math.round(event.createdAt / 1000 + calibratedOffset));
  const leadSeconds = normalizeLeadSeconds(segment.leadSeconds);
  const spread = offsets.length > 1 ? Math.max(...offsets) - Math.min(...offsets) : 0;
  const quality: VideoResolutionQuality = offsets.length === 1
    ? "SINGLE_ANCHOR"
    : spread <= COHERENT_ANCHOR_SPREAD_SECONDS
      ? "MULTI_ANCHOR_COHERENT"
      : "MULTI_ANCHOR_WARNING";
  const openSecond = Math.max(0, estimatedSecond - leadSeconds);
  return {
    status: "RESOLVED",
    segmentId: segment.id,
    videoId: segment.videoId,
    estimatedSecond,
    openSecond,
    leadSeconds,
    url: youtubeDeepLink(segment.videoId, openSecond),
    quality,
    anchorSpreadSeconds: spread,
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
    label: input.label?.trim() || (periods.length === 2 ? "Partido completo" : `Parte ${periods[0]}`),
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
  return {
    ...session,
    videoSegments: previous
      ? segments.map((candidate) => candidate.id === normalized.id ? normalized : candidate)
      : [...segments, normalized],
  };
}

export function removeVideoSegment(session: MatchSession, segmentId: string): MatchSession {
  return { ...session, videoSegments: (session.videoSegments ?? []).filter((segment) => segment.id !== segmentId) };
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

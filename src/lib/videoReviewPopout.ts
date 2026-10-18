export type VideoReviewPopoutCommand =
  | { type: "STATE"; videoId: string; label: string; second: number; playing: boolean; playbackRate: number }
  | { type: "SEEK"; second: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "RATE"; playbackRate: number }
  | { type: "REQUEST_TIME"; requestId: string };

export type VideoReviewPopoutEvent =
  | { type: "READY" }
  | { type: "TIME"; second: number; playing: boolean; playbackRate: number }
  | { type: "CAPTURED_TIME"; requestId: string; second: number }
  | { type: "CLOSED" };

export function videoReviewChannelName(matchId: string): string {
  return `alamedapp:video-review:${matchId}`;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isVideoReviewPopoutCommand(value: unknown): value is VideoReviewPopoutCommand {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const command = value as Partial<VideoReviewPopoutCommand>;
  if (command.type === "PLAY" || command.type === "PAUSE") return true;
  if (command.type === "SEEK") return finiteNonNegative(command.second);
  if (command.type === "RATE") return finitePositive(command.playbackRate);
  if (command.type === "REQUEST_TIME") return typeof command.requestId === "string" && command.requestId.length > 0;
  return command.type === "STATE"
    && typeof command.videoId === "string"
    && command.videoId.length > 0
    && typeof command.label === "string"
    && finiteNonNegative(command.second)
    && typeof command.playing === "boolean"
    && finitePositive(command.playbackRate);
}

export function isVideoReviewPopoutEvent(value: unknown): value is VideoReviewPopoutEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const event = value as Partial<VideoReviewPopoutEvent>;
  if (event.type === "READY" || event.type === "CLOSED") return true;
  if (event.type === "CAPTURED_TIME") return typeof event.requestId === "string" && event.requestId.length > 0 && finiteNonNegative(event.second);
  return event.type === "TIME" && finiteNonNegative(event.second) && typeof event.playing === "boolean" && finitePositive(event.playbackRate);
}

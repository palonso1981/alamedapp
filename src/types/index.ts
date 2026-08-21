export type DominantFoot = "RIGHT" | "LEFT" | "BOTH" | "UNKNOWN";

export interface Player {
  id: string;
  name: string;
  number: number;
  position?: string;
  dominantFoot?: DominantFoot;
}

export interface Match {
  id: string;
  date: string;
  opponent: string;
  homeScore: number;
  awayScore: number;
  isSuperiority: boolean;
  status: "pending" | "ongoing" | "finished";
}

export const MATCH_EVENT_SCHEMA_VERSION = 1 as const;

export interface EventPosition {
  period: number;
  minute: number;
  order: number;
}

interface MatchEventBase extends EventPosition {
  id: string;
  matchId: string;
  schemaVersion: typeof MATCH_EVENT_SCHEMA_VERSION;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface LineupInitializedEvent extends MatchEventBase {
  type: "lineup_initialized";
  squadPlayerIds: string[];
  onCourtPlayerIds: string[];
}

export interface SubstitutionEvent extends MatchEventBase {
  type: "substitution";
  playerOutId: string;
  playerInId: string;
}

export type LiveThreatOutcome = "GOL" | "PARADA" | "FUERA";
export type LegacyThreatOutcome = "BLOQUEADO";
export type ThreatOutcome = LiveThreatOutcome | LegacyThreatOutcome;
export type ThreatSide = "FOR" | "AGAINST";
export type ThreatPhase =
  | "POSITIONAL"
  | "TRANSITION"
  | "SET_PIECE_CORNER"
  | "SET_PIECE_FREE_KICK"
  | "SET_PIECE_KICK_IN"
  | "FLYING_GOALKEEPER"
  | "PENALTY"
  | "DOUBLE_PENALTY"
  | "UNSPECIFIED";

export interface NormalizedCoordinates {
  x: number;
  y: number;
}

interface ThreatEventData {
  side: ThreatSide;
  playerId?: string;
  origin: NormalizedCoordinates;
  phase: ThreatPhase;
}

export interface LiveThreatRecordedEvent extends MatchEventBase, ThreatEventData {
  type: "threat_recorded";
  source: "live";
  outcome: LiveThreatOutcome;
}

export interface LegacyThreatImportedEvent extends MatchEventBase, ThreatEventData {
  type: "threat_recorded";
  source: "legacy_import";
  outcome: ThreatOutcome;
}

export type ThreatRecordedEvent =
  | LiveThreatRecordedEvent
  | LegacyThreatImportedEvent;

export type MatchEvent =
  | LineupInitializedEvent
  | SubstitutionEvent
  | ThreatRecordedEvent;

export type MatchEventType = MatchEvent["type"];

export interface TimelineEntry {
  event: MatchEvent;
  lineupPlayerIds: string[];
  benchPlayerIds: string[];
}

export interface ReplayIssue {
  eventId: string;
  code:
    | "MISSING_LINEUP"
    | "UNKNOWN_PLAYER"
    | "TOO_MANY_ON_COURT"
    | "DUPLICATE_PLAYER"
    | "PLAYER_NOT_ON_COURT"
    | "PLAYER_NOT_ON_BENCH"
    | "INVALID_THREAT_AUTHOR"
    | "INVALID_COORDINATES"
    | "INVALID_POSITION"
    | "DUPLICATE_ORDER"
    | "MATCH_ID_MISMATCH";
  message: string;
}

export interface ReplayResult {
  onCourtPlayerIds: string[];
  benchPlayerIds: string[];
  timeline: TimelineEntry[];
  issues: ReplayIssue[];
}

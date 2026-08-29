export type DominantFoot = "RIGHT" | "LEFT" | "BOTH" | "UNKNOWN";

export interface Player {
  id: string;
  name: string;
  number: number;
  photoUrl?: string;
  position?: string;
  dominantFoot?: DominantFoot;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  photoUrl?: string;
}

export interface Match {
  id: string;
  date: string;
  opponent: string;
  status: "pending" | "ongoing" | "finished";
}

export const MATCH_EVENT_SCHEMA_VERSION = 1 as const;
export const INFERIORITY_SLOT_ID = "slot:inferiority" as const;

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
  /** Marca operativa: el evento sigue siendo válido y computable. */
  pendingReview: boolean;
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
  /** Roja propia que justifica una reducción a la plaza INFERIORIDAD. */
  relatedCardEventId?: string;
}

export type GameStateKind = "SUPERIORITY" | "FLYING_GOALKEEPER";
export type GameContext =
  | "EVEN"
  | "SUPERIORITY"
  | "INFERIORITY"
  | "FLYING_GOALKEEPER";

export interface GameStateChangedEvent extends MatchEventBase {
  type: "game_state_changed";
  state: GameStateKind;
  active: boolean;
  /** Persona que asume funcionalmente la portería cuando se activa P-J. */
  playerId?: string;
}

export type LiveThreatOutcome = "GOL" | "PARADA" | "FUERA";
export type LegacyThreatOutcome = "BLOQUEADO";
export type ThreatOutcome = LiveThreatOutcome | LegacyThreatOutcome;
export type ThreatSide = "FOR" | "AGAINST";
export type DisciplineSide = ThreatSide;
export type CardColor = "YELLOW" | "RED";
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
export type LiveThreatPhase = Exclude<ThreatPhase, "UNSPECIFIED">;

export interface NormalizedCoordinates {
  x: number;
  y: number;
}

export const GOAL_TARGET_GEOMETRY_VERSION = 2 as const;
export type GoalTargetGeometryVersion = 1 | typeof GOAL_TARGET_GEOMETRY_VERSION;

/** Coordenada canónica normalizada sobre el lienzo frontal de portería. */
export interface GoalTargetCoordinates extends NormalizedCoordinates {
  geometryVersion: GoalTargetGeometryVersion;
}

export type KeeperBodyZone = "UPPER" | "LOWER";
export type KeeperBodyPart =
  | "HEAD"
  | "TORSO"
  | "LEFT_ARM_HAND"
  | "RIGHT_ARM_HAND"
  | "LEFT_LEG_FOOT"
  | "RIGHT_LEG_FOOT";
export type SaveOutcome = "CATCH" | "REBOUND" | "CLEARANCE";

export type GoalkeeperReference =
  | {
      status: "PLAYER";
      playerId: string;
      /** REPLAY en captura/recálculo; MANUAL solo al resolver un P-J dudoso. */
      resolution?: "REPLAY" | "MANUAL";
    }
  | { status: "PENDING" };

/**
 * Detalle espacial V1 de una amenaza rival. Es opcional para poder reproducir
 * sesiones locales anteriores; toda captura defensiva nueva lo incorpora.
 */
export interface DefensiveThreatDetailV1 {
  version: 1;
  goalTarget: GoalTargetCoordinates;
  goalkeeper: GoalkeeperReference;
  keeperBodyZone?: KeeperBodyZone;
  saveOutcome?: SaveOutcome;
}

/**
 * Detalle V2: el destino del balón y la intervención del portero son dos
 * gestos independientes. La zona superior/inferior se deriva de bodyPart.
 */
export interface DefensiveThreatDetailV2 {
  version: 2;
  goalTarget: GoalTargetCoordinates;
  goalkeeper: GoalkeeperReference;
  keeperBodyPart?: KeeperBodyPart;
  saveOutcome?: SaveOutcome;
}

export type DefensiveThreatDetail =
  | DefensiveThreatDetailV1
  | DefensiveThreatDetailV2;

export type GoalAssist =
  | { status: "PLAYER"; playerId: string }
  | { status: "NONE" }
  | { status: "PENDING" };

interface ThreatEventData {
  side: ThreatSide;
  playerId?: string;
  origin: NormalizedCoordinates;
  phase: ThreatPhase;
  /**
   * Identifica una secuencia causal de amenazas. En una amenaza independiente
   * coincide con su propio id; las continuaciones heredan el de la raíz.
   */
  sequenceId?: string;
  /** Amenaza inmediatamente anterior que origina esta continuación. */
  parentEventId?: string;
  /** Solo se usa en goles CDA; nunca es una métrica agregada. */
  assist?: GoalAssist;
  /** Detalle espacial defensivo. Ausente únicamente en amenazas legacy. */
  defensive?: DefensiveThreatDetail;
}

export interface LiveThreatRecordedEvent extends MatchEventBase, ThreatEventData {
  type: "threat_recorded";
  source: "live";
  outcome: LiveThreatOutcome;
  phase: LiveThreatPhase;
}

export interface LegacyThreatImportedEvent extends MatchEventBase, ThreatEventData {
  type: "threat_recorded";
  source: "legacy_import";
  outcome: ThreatOutcome;
}

export type ThreatRecordedEvent =
  | LiveThreatRecordedEvent
  | LegacyThreatImportedEvent;

export interface FoulRecordedEvent extends MatchEventBase {
  type: "foul_recorded";
  side: DisciplineSide;
  source: "live" | "legacy_local";
  /** Jugador CDA que comete (FOR) o recibe (AGAINST) la falta. */
  playerId?: string;
  /** Posición opcional, normalizada y enriquecible tras el partido. */
  origin?: NormalizedCoordinates;
}

export interface CardRecordedEvent extends MatchEventBase {
  type: "card_recorded";
  side: DisciplineSide;
  color: CardColor;
  playerId?: string;
  staffId?: string;
}

export type MatchEvent =
  | LineupInitializedEvent
  | SubstitutionEvent
  | ThreatRecordedEvent
  | GameStateChangedEvent
  | FoulRecordedEvent
  | CardRecordedEvent;

export type MatchEventType = MatchEvent["type"];

export interface TimelineEntry {
  event: MatchEvent;
  lineupPlayerIds: string[];
  benchPlayerIds: string[];
  gameContexts: GameContext[];
  /** Número de esta falta dentro de su lado y periodo, derivado por replay. */
  periodFoulNumber?: number;
  /** Acumulado colectivo inmediatamente anterior, derivado por replay. */
  periodFoulsBefore?: number;
  /** Acumulado colectivo inmediatamente posterior, derivado por replay. */
  periodFoulsAfter?: number;
  /** Umbrales configurados alcanzados exactamente por esta falta. */
  reachedFoulThresholds?: number[];
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
    | "MATCH_ID_MISMATCH"
    | "INVALID_FOUL_PLAYER"
    | "INVALID_CARD_PLAYER"
    | "INVALID_EVENT_LINK"
    | "INVALID_ASSIST"
    | "INVALID_GOAL_TARGET"
    | "INVALID_GOALKEEPER"
    | "INVALID_SAVE_DETAIL"
    | "INVALID_CARD_TARGET"
    | "INVALID_INFERIORITY_SLOT"
    | "INVALID_GAME_STATE_PLAYER";
  message: string;
}

export interface ReplayResult {
  onCourtPlayerIds: string[];
  benchPlayerIds: string[];
  timeline: TimelineEntry[];
  playerMinutes: Record<string, PlayerMinutes>;
  score: Score;
  discipline: DisciplineSummary;
  disciplineByPeriod: Record<number, DisciplineSummary>;
  superiorityActive: boolean;
  flyingGoalkeeperActive: boolean;
  flyingGoalkeeperPlayerId?: string;
  inferiorityActive: boolean;
  lineupValidation: LineupValidation;
  dismissedPlayerIds: string[];
  issues: ReplayIssue[];
}

export type LineupValidationCode =
  | "MISSING_PLAYERS"
  | "TOO_MANY_PLAYERS"
  | "UNJUSTIFIED_INFERIORITY"
  | "GOALKEEPER_UNRESOLVED";

export interface InferiorityCause {
  cardEventId: string;
  substitutionEventId: string;
  playerId: string;
  inferredFromLegacy: boolean;
}

export interface LineupValidation {
  valid: boolean;
  captureBlocked: boolean;
  actualPlayersOnCourt: number;
  expectedPlayersOnCourt: number;
  goalkeeper: GoalkeeperReference;
  inferiorityCause?: InferiorityCause;
  reasons: Array<{
    code: LineupValidationCode;
    message: string;
  }>;
}

export interface Score {
  for: number;
  against: number;
}

export interface DisciplineTeamSummary {
  fouls: number;
  yellowCards: number;
  redCards: number;
}

export interface DisciplineSummary {
  for: DisciplineTeamSummary;
  against: DisciplineTeamSummary;
}

export interface PlayerMinutes {
  totalMinutes: number;
  currentStintMinutes: number;
  onCourt: boolean;
}

export type LocalPersistenceStatus = "idle" | "saved" | "error";

export interface MatchSession {
  matchId: string;
  players: Player[];
  staff: StaffMember[];
  period: number;
  minute: number;
  /** Memoria operativa del minutero por periodo; no forma parte de la cronología. */
  periodMinutes: Record<number, number>;
  /** Periodos cerrados explícitamente desde el control de partido. */
  closedPeriods?: number[];
  /** Minuto transcurrido anterior al cierre operativo, usado solo para reanudar. */
  periodCloseSnapshots?: Record<number, number>;
  /** Periodo histórico que se está revisando; `period` continúa siendo el activo. */
  reviewPeriod?: number;
  /** Minuto de inserción/corrección dentro del periodo revisado. */
  reviewMinute?: number;
  /** Cierre operativo local; no sustituye ningún estado deportivo derivado. */
  matchFinished?: boolean;
  events: MatchEvent[];
  past: MatchEvent[][];
  future: MatchEvent[][];
  lastError: string | null;
  persistenceStatus: LocalPersistenceStatus;
  lastSavedAt: number | null;
}


/** Plan previo opcional. Nunca se escribe dentro de la cronología deportiva. */
export interface PlayerParticipationTarget {
  playerId: string;
  targetMinutes: number;
}

export interface MatchParticipationPlan {
  regulationMinutes: number;
  targets: PlayerParticipationTarget[];
}

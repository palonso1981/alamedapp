import {
  GoalAssist,
  GoalTargetCoordinates,
  KeeperBodyPart,
  LiveThreatOutcome,
  LiveThreatPhase,
  NormalizedCoordinates,
  SaveOutcome,
  ThreatSide,
} from "../types";

export type ThreatCaptureStep =
  | "OUTCOME"
  | "GOAL_TARGET"
  | "DETAILS"
  | "PHASE"
  | "ASSIST";

export type ThreatCaptureFlowId =
  | "FOR_ORIGIN_OUTCOME_PHASE"
  | "AGAINST_ORIGIN_GOAL_DETAILS_PHASE";

export interface ThreatCaptureFlowDefinition {
  id: ThreatCaptureFlowId;
  side: ThreatSide;
  steps: readonly ThreatCaptureStep[];
}

/**
 * Los recorridos son configuración de captura, no reglas del evento. El flujo
 * rival usa GOAL_TARGET/DETAILS sin alterar el recorrido ofensivo ni el replay.
 */
export const THREAT_CAPTURE_FLOWS: Readonly<
  Record<ThreatSide, ThreatCaptureFlowDefinition>
> = {
  FOR: {
    id: "FOR_ORIGIN_OUTCOME_PHASE",
    side: "FOR",
    steps: ["OUTCOME", "PHASE"],
  },
  AGAINST: {
    id: "AGAINST_ORIGIN_GOAL_DETAILS_PHASE",
    side: "AGAINST",
    steps: ["GOAL_TARGET", "DETAILS", "PHASE"],
  },
};

export type LiveInteractionState =
  | { kind: "IDLE" }
  | {
      kind: "PLAYER_SELECTED";
      playerId: string;
      location: "COURT" | "BENCH";
    }
  | {
      kind: "THREAT_PENDING";
      eventId: string;
      flowId: ThreatCaptureFlowId;
      side: ThreatSide;
      playerId?: string;
      origin: NormalizedCoordinates;
      step: ThreatCaptureStep;
      phase: LiveThreatPhase | null;
      outcome: LiveThreatOutcome | null;
      assist: GoalAssist | null;
      goalTarget: GoalTargetCoordinates | null;
      keeperBodyPart: KeeperBodyPart | null;
      saveOutcome: SaveOutcome | null;
      sequenceId: string;
      parentEventId?: string;
    }
  | {
      kind: "SECOND_PLAY_OFFER" | "SECOND_PLAY_ARMED";
      parentEventId: string;
      sequenceId: string;
      phase: LiveThreatPhase;
    };

export type LiveInteractionAction =
  | { type: "COURT_PLAYER_TAPPED"; playerId: string }
  | { type: "BENCH_PLAYER_TAPPED"; playerId: string }
  | { type: "COURT_TAPPED"; origin: NormalizedCoordinates; eventId?: string }
  | {
      type: "GOAL_TARGET_SELECTED";
      goalTarget: GoalTargetCoordinates;
      outcome: LiveThreatOutcome;
      keeperBodyPart?: KeeperBodyPart;
    }
  | { type: "SAVE_OUTCOME_SELECTED"; saveOutcome: SaveOutcome }
  | { type: "PHASE_SELECTED"; phase: LiveThreatPhase }
  | { type: "OUTCOME_SELECTED"; outcome: LiveThreatOutcome }
  | { type: "ASSIST_SELECTED"; assist: GoalAssist }
  | { type: "START_SECOND_PLAY" }
  | { type: "END_SEQUENCE" }
  | { type: "CANCEL" };

export type LiveInteractionEffect =
  | {
      type: "RECORD_SUBSTITUTION";
      playerOutId: string;
      playerInId: string;
    }
  | {
      type: "RECORD_THREAT";
      id: string;
      side: ThreatSide;
      playerId?: string;
      origin: NormalizedCoordinates;
      phase: LiveThreatPhase;
      outcome: LiveThreatOutcome;
      assist?: GoalAssist;
      sequenceId: string;
      parentEventId?: string;
      defensiveCapture?: {
        goalTarget: GoalTargetCoordinates;
        keeperBodyPart?: KeeperBodyPart;
        saveOutcome?: SaveOutcome;
      };
    };

export interface LiveInteractionTransition {
  state: LiveInteractionState;
  effect?: LiveInteractionEffect;
}

export const IDLE_LIVE_INTERACTION: LiveInteractionState = { kind: "IDLE" };

function interactionId(): string {
  return globalThis.crypto.randomUUID();
}

function startThreat(
  side: ThreatSide,
  origin: NormalizedCoordinates,
  eventId: string,
  playerId?: string,
  sequence?: {
    parentEventId: string;
    sequenceId: string;
    phase: LiveThreatPhase;
  },
): LiveInteractionState {
  const flow = THREAT_CAPTURE_FLOWS[side];
  const firstStep = flow.steps[0];
  return {
    kind: "THREAT_PENDING",
    eventId,
    flowId: flow.id,
    side,
    playerId,
    origin,
    step: firstStep,
    phase: sequence?.phase ?? null,
    outcome: null,
    assist: null,
    goalTarget: null,
    keeperBodyPart: null,
    saveOutcome: null,
    sequenceId: sequence?.sequenceId ?? eventId,
    parentEventId: sequence?.parentEventId,
  };
}

type PendingThreat = Extract<LiveInteractionState, { kind: "THREAT_PENDING" }>;

function recordDefensiveThreat(
  state: PendingThreat,
  phase: LiveThreatPhase,
): LiveInteractionTransition {
  if (state.side !== "AGAINST" || !state.outcome || !state.goalTarget) {
    return { state };
  }
  const effect: Extract<LiveInteractionEffect, { type: "RECORD_THREAT" }> = {
    type: "RECORD_THREAT",
    id: state.eventId,
    side: "AGAINST",
    origin: state.origin,
    phase,
    outcome: state.outcome,
    sequenceId: state.sequenceId,
    parentEventId: state.parentEventId,
    defensiveCapture: {
      goalTarget: state.goalTarget,
      keeperBodyPart: state.keeperBodyPart ?? undefined,
      saveOutcome: state.saveOutcome ?? undefined,
    },
  };
  return {
    state:
      state.saveOutcome === "REBOUND"
        ? {
            kind: "SECOND_PLAY_OFFER",
            parentEventId: state.eventId,
            sequenceId: state.sequenceId,
            phase,
          }
        : IDLE_LIVE_INTERACTION,
    effect,
  };
}

export function reduceLiveInteraction(
  state: LiveInteractionState,
  action: LiveInteractionAction,
): LiveInteractionTransition {
  if (action.type === "CANCEL" || action.type === "END_SEQUENCE") {
    return { state: IDLE_LIVE_INTERACTION };
  }

  if (action.type === "START_SECOND_PLAY") {
    return state.kind === "SECOND_PLAY_OFFER"
      ? { state: { ...state, kind: "SECOND_PLAY_ARMED" } }
      : { state };
  }

  if (action.type === "COURT_PLAYER_TAPPED") {
    if (
      state.kind === "PLAYER_SELECTED" &&
      state.location === "COURT" &&
      state.playerId === action.playerId
    ) {
      return { state: IDLE_LIVE_INTERACTION };
    }
    return {
      state: {
        kind: "PLAYER_SELECTED",
        playerId: action.playerId,
        location: "COURT",
      },
    };
  }

  if (action.type === "BENCH_PLAYER_TAPPED") {
    if (state.kind === "PLAYER_SELECTED" && state.location === "COURT") {
      return {
        state: IDLE_LIVE_INTERACTION,
        effect: {
          type: "RECORD_SUBSTITUTION",
          playerOutId: state.playerId,
          playerInId: action.playerId,
        },
      };
    }
    if (
      state.kind === "PLAYER_SELECTED" &&
      state.location === "BENCH" &&
      state.playerId === action.playerId
    ) {
      return { state: IDLE_LIVE_INTERACTION };
    }
    return {
      state: {
        kind: "PLAYER_SELECTED",
        playerId: action.playerId,
        location: "BENCH",
      },
    };
  }

  if (action.type === "COURT_TAPPED") {
    if (state.kind === "THREAT_PENDING") {
      return { state: { ...state, origin: action.origin } };
    }
    if (state.kind === "SECOND_PLAY_ARMED") {
      return {
        state: startThreat(
          "AGAINST",
          action.origin,
          action.eventId ?? interactionId(),
          undefined,
          state,
        ),
      };
    }
    const ownThreat =
      state.kind === "PLAYER_SELECTED" && state.location === "COURT";
    return {
      state: startThreat(
        ownThreat ? "FOR" : "AGAINST",
        action.origin,
        action.eventId ?? interactionId(),
        ownThreat ? state.playerId : undefined,
      ),
    };
  }

  if (state.kind !== "THREAT_PENDING") {
    return { state };
  }

  if (action.type === "OUTCOME_SELECTED") {
    if (state.side !== "FOR" || state.step !== "OUTCOME") {
      return { state };
    }
    return {
      state: {
        ...state,
        outcome: action.outcome,
        step: "PHASE",
      },
    };
  }

  if (action.type === "GOAL_TARGET_SELECTED") {
    if (state.side !== "AGAINST" || state.step !== "GOAL_TARGET") {
      return { state };
    }
    const targeted: PendingThreat = {
      ...state,
      goalTarget: action.goalTarget,
      outcome: action.outcome,
      keeperBodyPart: action.keeperBodyPart ?? null,
      saveOutcome: null,
      step: action.outcome === "PARADA" ? "DETAILS" : "PHASE",
    };
    return action.outcome !== "PARADA" && targeted.parentEventId && targeted.phase
      ? recordDefensiveThreat(targeted, targeted.phase)
      : { state: targeted };
  }

  if (action.type === "SAVE_OUTCOME_SELECTED") {
    if (state.side !== "AGAINST" || state.step !== "DETAILS") {
      return { state };
    }
    const detailed: PendingThreat = {
      ...state,
      saveOutcome: action.saveOutcome,
      step: "PHASE",
    };
    return detailed.parentEventId && detailed.phase
      ? recordDefensiveThreat(detailed, detailed.phase)
      : { state: detailed };
  }

  if (action.type === "PHASE_SELECTED") {
    if (state.step !== "PHASE" || !state.outcome) {
      return { state };
    }
    if (state.side === "FOR" && state.outcome === "GOL") {
      return {
        state: { ...state, phase: action.phase, step: "ASSIST" },
      };
    }
    if (state.side === "AGAINST") {
      // Una continuación nunca llega a PHASE: se completa en el paso anterior
      // con la fase heredada. Este guard evita divergencias ante acciones stale.
      if (state.parentEventId) return { state };
      return recordDefensiveThreat(state, action.phase);
    }
    return {
      state: IDLE_LIVE_INTERACTION,
      effect: {
        type: "RECORD_THREAT",
        id: state.eventId,
        side: state.side,
        playerId: state.playerId,
        origin: state.origin,
        phase: action.phase,
        outcome: state.outcome,
        sequenceId: state.sequenceId,
        parentEventId: state.parentEventId,
      },
    };
  }

  if (
    action.type !== "ASSIST_SELECTED" ||
    state.step !== "ASSIST" ||
    !state.outcome ||
    !state.phase
  ) {
    return { state };
  }
  return {
    state: IDLE_LIVE_INTERACTION,
    effect: {
      type: "RECORD_THREAT",
      id: state.eventId,
      side: state.side,
      playerId: state.playerId,
      origin: state.origin,
      phase: state.phase,
      outcome: state.outcome,
      assist: action.assist,
      sequenceId: state.sequenceId,
      parentEventId: state.parentEventId,
    },
  };
}

export function showsThreatControls(state: LiveInteractionState): boolean {
  return state.kind === "THREAT_PENDING";
}

import {
  GoalAssist,
  LiveThreatOutcome,
  LiveThreatPhase,
  NormalizedCoordinates,
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
  | "AGAINST_ORIGIN_OUTCOME_PHASE";

export interface ThreatCaptureFlowDefinition {
  id: ThreatCaptureFlowId;
  side: ThreatSide;
  steps: readonly ThreatCaptureStep[];
}

/**
 * Los recorridos son configuración de captura, no reglas del evento. El flujo
 * rival puede sustituir sus pasos por GOAL_TARGET/DETAILS cuando llegue la
 * portería defensiva sin alterar el recorrido ofensivo ni el replay.
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
    id: "AGAINST_ORIGIN_OUTCOME_PHASE",
    side: "AGAINST",
    steps: ["OUTCOME", "PHASE"],
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
      flowId: ThreatCaptureFlowId;
      side: ThreatSide;
      playerId?: string;
      origin: NormalizedCoordinates;
      step: "OUTCOME" | "PHASE" | "ASSIST";
      phase: LiveThreatPhase | null;
      outcome: LiveThreatOutcome | null;
      assist: GoalAssist | null;
    };

export type LiveInteractionAction =
  | { type: "COURT_PLAYER_TAPPED"; playerId: string }
  | { type: "BENCH_PLAYER_TAPPED"; playerId: string }
  | { type: "COURT_TAPPED"; origin: NormalizedCoordinates }
  | { type: "PHASE_SELECTED"; phase: LiveThreatPhase }
  | { type: "OUTCOME_SELECTED"; outcome: LiveThreatOutcome }
  | { type: "ASSIST_SELECTED"; assist: GoalAssist }
  | { type: "CANCEL" };

export type LiveInteractionEffect =
  | {
      type: "RECORD_SUBSTITUTION";
      playerOutId: string;
      playerInId: string;
    }
  | {
      type: "RECORD_THREAT";
      side: ThreatSide;
      playerId?: string;
      origin: NormalizedCoordinates;
      phase: LiveThreatPhase;
      outcome: LiveThreatOutcome;
      assist?: GoalAssist;
    };

export interface LiveInteractionTransition {
  state: LiveInteractionState;
  effect?: LiveInteractionEffect;
}

export const IDLE_LIVE_INTERACTION: LiveInteractionState = { kind: "IDLE" };

function startThreat(
  side: ThreatSide,
  origin: NormalizedCoordinates,
  playerId?: string,
): LiveInteractionState {
  const flow = THREAT_CAPTURE_FLOWS[side];
  const firstStep = flow.steps[0];
  if (firstStep !== "OUTCOME") {
    throw new Error(`El flujo ${flow.id} todavía no tiene capturador para ${firstStep}.`);
  }
  return {
    kind: "THREAT_PENDING",
    flowId: flow.id,
    side,
    playerId,
    origin,
    step: "OUTCOME",
    phase: null,
    outcome: null,
    assist: null,
  };
}

export function reduceLiveInteraction(
  state: LiveInteractionState,
  action: LiveInteractionAction,
): LiveInteractionTransition {
  if (action.type === "CANCEL") {
    return { state: IDLE_LIVE_INTERACTION };
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
    const ownThreat =
      state.kind === "PLAYER_SELECTED" && state.location === "COURT";
    return {
      state: startThreat(
        ownThreat ? "FOR" : "AGAINST",
        action.origin,
        ownThreat ? state.playerId : undefined,
      ),
    };
  }

  if (state.kind !== "THREAT_PENDING") {
    return { state };
  }

  if (action.type === "OUTCOME_SELECTED") {
    if (state.step !== "OUTCOME") {
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

  if (action.type === "PHASE_SELECTED") {
    if (state.step !== "PHASE" || !state.outcome) {
      return { state };
    }
    if (state.side === "FOR" && state.outcome === "GOL") {
      return {
        state: { ...state, phase: action.phase, step: "ASSIST" },
      };
    }
    return {
      state: IDLE_LIVE_INTERACTION,
      effect: {
        type: "RECORD_THREAT",
        side: state.side,
        playerId: state.playerId,
        origin: state.origin,
        phase: action.phase,
        outcome: state.outcome,
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
      side: state.side,
      playerId: state.playerId,
      origin: state.origin,
      phase: state.phase,
      outcome: state.outcome,
      assist: action.assist,
    },
  };
}

export function showsThreatControls(state: LiveInteractionState): boolean {
  return state.kind === "THREAT_PENDING";
}

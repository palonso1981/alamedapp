import {
  LiveThreatOutcome,
  LiveThreatPhase,
  NormalizedCoordinates,
  ThreatSide,
} from "../types";

export type LiveInteractionState =
  | { kind: "IDLE" }
  | { kind: "PLAYER_SELECTED"; playerId: string }
  | {
      kind: "THREAT_PENDING";
      side: ThreatSide;
      playerId?: string;
      origin: NormalizedCoordinates;
      phase: LiveThreatPhase | null;
      outcome: LiveThreatOutcome | null;
    };

export type LiveInteractionAction =
  | { type: "COURT_PLAYER_TAPPED"; playerId: string }
  | { type: "BENCH_PLAYER_TAPPED"; playerId: string }
  | {
      type: "COURT_TAPPED";
      origin: NormalizedCoordinates;
      defaultPhase?: LiveThreatPhase;
    }
  | { type: "PHASE_SELECTED"; phase: LiveThreatPhase }
  | { type: "OUTCOME_SELECTED"; outcome: LiveThreatOutcome }
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
    };

export interface LiveInteractionTransition {
  state: LiveInteractionState;
  effect?: LiveInteractionEffect;
}

export const IDLE_LIVE_INTERACTION: LiveInteractionState = { kind: "IDLE" };

function completeThreatIfReady(
  state: Extract<LiveInteractionState, { kind: "THREAT_PENDING" }>,
): LiveInteractionTransition {
  if (!state.phase || !state.outcome) {
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
    },
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
    if (state.kind === "PLAYER_SELECTED" && state.playerId === action.playerId) {
      return { state: IDLE_LIVE_INTERACTION };
    }
    return {
      state: { kind: "PLAYER_SELECTED", playerId: action.playerId },
    };
  }

  if (action.type === "BENCH_PLAYER_TAPPED") {
    if (state.kind !== "PLAYER_SELECTED") {
      return { state: IDLE_LIVE_INTERACTION };
    }
    return {
      state: IDLE_LIVE_INTERACTION,
      effect: {
        type: "RECORD_SUBSTITUTION",
        playerOutId: state.playerId,
        playerInId: action.playerId,
      },
    };
  }

  if (action.type === "COURT_TAPPED") {
    if (state.kind === "THREAT_PENDING") {
      return {
        state: {
          ...state,
          origin: action.origin,
        },
      };
    }
    return {
      state: {
        kind: "THREAT_PENDING",
        side: state.kind === "PLAYER_SELECTED" ? "FOR" : "AGAINST",
        playerId:
          state.kind === "PLAYER_SELECTED" ? state.playerId : undefined,
        origin: action.origin,
        phase: action.defaultPhase ?? null,
        outcome: null,
      },
    };
  }

  if (state.kind !== "THREAT_PENDING") {
    return { state };
  }

  if (action.type === "PHASE_SELECTED") {
    return completeThreatIfReady({ ...state, phase: action.phase });
  }

  return completeThreatIfReady({ ...state, outcome: action.outcome });
}

export function showsThreatControls(state: LiveInteractionState): boolean {
  return state.kind === "THREAT_PENDING";
}

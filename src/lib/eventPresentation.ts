import {
  GameContext,
  INFERIORITY_SLOT_ID,
  MatchEvent,
  Player,
} from "../types";

const PHASE_LABELS: Record<string, string> = {
  POSITIONAL: "Posicional",
  TRANSITION: "Transición",
  SET_PIECE_CORNER: "ABP córner",
  SET_PIECE_FREE_KICK: "ABP falta",
  SET_PIECE_KICK_IN: "ABP banda",
  FLYING_GOALKEEPER: "Portero-jugador",
  PENALTY: "Penalti",
  DOUBLE_PENALTY: "Doble penalti",
  UNSPECIFIED: "Sin fase",
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export function playerLabel(players: Player[], playerId?: string): string {
  if (!playerId) {
    return "Rival";
  }
  if (playerId === INFERIORITY_SLOT_ID) {
    return "INFERIORIDAD";
  }
  const player = players.find((candidate) => candidate.id === playerId);
  return player ? `${player.number}. ${player.name}` : playerId;
}

export function eventDescription(event: MatchEvent, players: Player[]): string {
  if (event.type === "substitution") {
    return `↔ ${playerLabel(players, event.playerOutId)} → ${playerLabel(players, event.playerInId)}`;
  }
  if (event.type === "threat_recorded") {
    const actor = event.side === "FOR" ? playerLabel(players, event.playerId) : "Rival";
    return `${event.side === "FOR" ? "↑" : "↓"} ${event.outcome} · ${actor} · ${phaseLabel(event.phase)}`;
  }
  if (event.type === "game_state_changed") {
    const state = event.state === "SUPERIORITY" ? "Superioridad" : "Portero-jugador";
    return `${event.active ? "▶" : "■"} ${state}`;
  }
  if (event.type === "foul_recorded") {
    return `Falta ${event.side === "FOR" ? "propia" : "rival"}`;
  }
  if (event.type === "card_recorded") {
    const card = event.color === "YELLOW" ? "🟨" : "🟥";
    return `${card} ${event.side === "FOR" ? playerLabel(players, event.playerId) : "Rival"}`;
  }
  return "Alineación inicial";
}

export function contextLabel(context: GameContext): string {
  if (context === "SUPERIORITY") return "SUP";
  if (context === "INFERIORITY") return "INF";
  if (context === "FLYING_GOALKEEPER") return "P-J";
  return "5v5";
}

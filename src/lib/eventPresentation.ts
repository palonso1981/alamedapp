import {
  GameContext,
  INFERIORITY_SLOT_ID,
  MatchEvent,
  Player,
  StaffMember,
  TimelineEntry,
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

export function eventDescription(
  event: MatchEvent,
  players: Player[],
  entry?: TimelineEntry,
  staff: StaffMember[] = [],
): string {
  if (event.type === "substitution") {
    return `↔ ${playerLabel(players, event.playerOutId)} → ${playerLabel(players, event.playerInId)}`;
  }
  if (event.type === "threat_recorded") {
    const actor = event.side === "FOR" ? playerLabel(players, event.playerId) : "Rival";
    const assist = event.assist?.status === "PLAYER"
      ? ` · A ${playerLabel(players, event.assist.playerId)}`
      : event.assist?.status === "PENDING"
        ? " · A ?"
        : "";
    const defensive = event.defensive
      ? event.outcome === "PARADA"
        ? ` · ${event.defensive.keeperBodyZone === "UPPER" ? "arriba" : "abajo"} · ${
            event.defensive.saveOutcome === "CATCH"
              ? "blocaje"
              : event.defensive.saveOutcome === "REBOUND"
                ? "rechace"
                : "despeje"
          }`
        : " · destino ✓"
      : event.side === "AGAINST"
        ? " · legacy"
        : "";
    return `${event.side === "FOR" ? "↑" : "↓"} ${event.outcome} · ${actor} · ${phaseLabel(event.phase)}${assist}${defensive}`;
  }
  if (event.type === "game_state_changed") {
    const state = event.state === "SUPERIORITY" ? "Superioridad" : "Portero-jugador";
    return `${event.active ? "▶" : "■"} ${state}`;
  }
  if (event.type === "foul_recorded") {
    const number = entry?.periodFoulNumber
      ? `F${entry.periodFoulNumber}`
      : "F";
    const direction = event.side === "FOR" ? "cometida" : "recibida";
    const player = event.playerId
      ? playerLabel(players, event.playerId)
      : "sin identificar";
    return `${number} · ${player} · ${direction}`;
  }
  if (event.type === "card_recorded") {
    const card = event.color === "YELLOW" ? "🟨" : "🟥";
    const target = event.staffId
      ? staff.find((member) => member.id === event.staffId)?.name ?? event.staffId
      : event.side === "FOR"
        ? playerLabel(players, event.playerId)
        : "Rival";
    return `${card} ${target}`;
  }
  return "Alineación inicial";
}

export function contextLabel(context: GameContext): string {
  if (context === "SUPERIORITY") return "SUP";
  if (context === "INFERIORITY") return "INF";
  if (context === "FLYING_GOALKEEPER") return "P-J";
  return "5v5";
}

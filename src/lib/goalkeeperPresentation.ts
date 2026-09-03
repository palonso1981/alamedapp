import { Player } from "../types";

export function functionalGoalkeeperBadge(
  player: Player,
  functionalGoalkeeperId?: string,
): "PORTERO" | "PORTERO · ROL FUNCIONAL" | null {
  if (player.id !== functionalGoalkeeperId) return null;
  const naturalGoalkeeper = player.naturalPosition === "GOALKEEPER" ||
    (player.naturalPosition === undefined && player.position?.toUpperCase().includes("PORTERO"));
  return naturalGoalkeeper ? "PORTERO" : "PORTERO · ROL FUNCIONAL";
}

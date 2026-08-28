import { NormalizedCoordinates } from "../types";

export const PITCH_ZONE_MODEL_VERSION = 1 as const;
export type PitchZoneColumn = "OWN_THIRD" | "MIDDLE_THIRD" | "FINAL_THIRD";
export type PitchZoneLane = "TOP" | "BOTTOM";
export type PitchZoneV1 = `${PitchZoneColumn}_${PitchZoneLane}`;

/** V1 analítica: tres columnas por dos carriles sobre orientación canónica. */
export function derivePitchZoneV1(point: NormalizedCoordinates): PitchZoneV1 {
  const column: PitchZoneColumn =
    point.x < 1 / 3
      ? "OWN_THIRD"
      : point.x < 2 / 3
        ? "MIDDLE_THIRD"
        : "FINAL_THIRD";
  return `${column}_${point.y < 0.5 ? "TOP" : "BOTTOM"}`;
}

export type GoalZoneColumn = "LEFT" | "CENTER" | "RIGHT";
export type GoalZoneRow = "HIGH" | "LOW";
export type GoalZoneV1 = `${GoalZoneColumn}_${GoalZoneRow}`;
export type GoalOutsideZoneV1 = "OUT_LEFT" | "OUT_RIGHT" | "OUT_HIGH" | "OUT_LOW";

export function deriveGoalZoneV1(
  point: NormalizedCoordinates,
  frame: { left: number; right: number; top: number; bottom: number },
): GoalZoneV1 | GoalOutsideZoneV1 {
  if (point.y < frame.top) return "OUT_HIGH";
  if (point.y > frame.bottom) return "OUT_LOW";
  if (point.x < frame.left) return "OUT_LEFT";
  if (point.x > frame.right) return "OUT_RIGHT";
  const relativeX = (point.x - frame.left) / (frame.right - frame.left);
  const column: GoalZoneColumn =
    relativeX < 1 / 3 ? "LEFT" : relativeX < 2 / 3 ? "CENTER" : "RIGHT";
  const relativeY = (point.y - frame.top) / (frame.bottom - frame.top);
  return `${column}_${relativeY < 0.5 ? "HIGH" : "LOW"}`;
}

import {
  GOAL_TARGET_GEOMETRY_VERSION,
  GoalTargetCoordinates,
  KeeperBodyZone,
  LiveThreatOutcome,
  NormalizedCoordinates,
} from "../types";

export const GOAL_FRAME = {
  left: 0.12,
  right: 0.88,
  top: 0.14,
  bottom: 0.82,
} as const;

export function normalizeGoalTargetPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): GoalTargetCoordinates {
  return {
    geometryVersion: GOAL_TARGET_GEOMETRY_VERSION,
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function isInsideGoalFrame(point: NormalizedCoordinates): boolean {
  return (
    point.x >= GOAL_FRAME.left &&
    point.x <= GOAL_FRAME.right &&
    point.y >= GOAL_FRAME.top &&
    point.y <= GOAL_FRAME.bottom
  );
}

/** Silueta estable y deliberadamente simple para captura táctil. */
export function isInsideGoalkeeper(point: NormalizedCoordinates): boolean {
  const dx = point.x - 0.5;
  const dy = point.y - 0.31;
  const head = dx * dx + dy * dy <= 0.065 * 0.065;
  const torso = point.y >= 0.37 && point.y <= 0.64 && Math.abs(dx) <= 0.12;
  const arms = point.y >= 0.4 && point.y <= 0.55 && Math.abs(dx) <= 0.22;
  const legs =
    point.y > 0.64 &&
    point.y <= 0.82 &&
    ((point.x >= 0.39 && point.x <= 0.49) ||
      (point.x >= 0.51 && point.x <= 0.61));
  return isInsideGoalFrame(point) && (head || torso || arms || legs);
}

export function classifyGoalTarget(
  point: GoalTargetCoordinates,
): LiveThreatOutcome {
  if (!isInsideGoalFrame(point)) return "FUERA";
  if (isInsideGoalkeeper(point)) return "PARADA";
  return "GOL";
}

export function deriveKeeperBodyZone(
  point: GoalTargetCoordinates,
): KeeperBodyZone {
  return point.y < 0.57 ? "UPPER" : "LOWER";
}

export function validGoalTarget(point: GoalTargetCoordinates): boolean {
  return (
    point.geometryVersion === GOAL_TARGET_GEOMETRY_VERSION &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

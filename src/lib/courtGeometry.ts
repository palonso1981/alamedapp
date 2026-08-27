import { NormalizedCoordinates } from "../types";

export const FUTSAL_COURT_ASPECT_RATIO = 2;

/** Orientación de análisis canónica e invariable entre periodos. */
export const CANONICAL_COURT_ORIENTATION = {
  ownGoalSide: "LEFT",
  rivalGoalSide: "RIGHT",
  ownAttackDirection: "RIGHT",
} as const;

export function courtOrientationForPeriod(period: number) {
  void period;
  return CANONICAL_COURT_ORIENTATION;
}

export interface CourtRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalizeCourtPoint(
  clientX: number,
  clientY: number,
  rect: CourtRect,
): NormalizedCoordinates {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function courtHeightForWidth(width: number): number {
  return width / FUTSAL_COURT_ASPECT_RATIO;
}

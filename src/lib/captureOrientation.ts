import { NormalizedCoordinates, RestartSpatialSide, ThreatSide } from "../types";

export type AttackDirection = "LEFT" | "RIGHT";

const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;

/** The canonical model always stores CDA attacking right. */
export function visualToCanonicalPoint<T extends NormalizedCoordinates>(
  point: T,
  direction: AttackDirection,
): T {
  return {
    ...point,
    x: clamp(direction === "RIGHT" ? point.x : 1 - point.x),
    y: clamp(point.y),
  } as T;
}

export function canonicalToVisualPoint<T extends NormalizedCoordinates>(
  point: T,
  direction: AttackDirection,
): T {
  return visualToCanonicalPoint(point, direction);
}

/**
 * La miniportería tiene una convención frontal propia: izquierda visual es
 * siempre izquierda del tirador, con independencia del giro de la pista.
 */
export function frontGoalTargetToCanonical<T extends NormalizedCoordinates>(point: T): T {
  return { ...point, x: clamp(point.x), y: clamp(point.y) } as T;
}

export function sideAtVisualEnd(
  end: "LEFT" | "RIGHT",
  direction: AttackDirection,
): ThreatSide {
  const attackingEnd = direction;
  return end === attackingEnd ? "FOR" : "AGAINST";
}

export function visualRestartToCanonical(input: {
  end: "LEFT" | "RIGHT";
  band: RestartSpatialSide;
  direction: AttackDirection;
}): { side: ThreatSide; spatialSide: RestartSpatialSide } {
  return {
    side: sideAtVisualEnd(input.end, input.direction),
    spatialSide: input.band,
  };
}

export function oppositeDirection(direction: AttackDirection): AttackDirection {
  return direction === "RIGHT" ? "LEFT" : "RIGHT";
}

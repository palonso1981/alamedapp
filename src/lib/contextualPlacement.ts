import { NormalizedCoordinates } from "../types";

export type ContextualHorizontalPlacement = "START" | "CENTER" | "END";
export type ContextualVerticalPlacement = "ABOVE" | "BELOW";

export interface ContextualPlacement {
  horizontal: ContextualHorizontalPlacement;
  vertical: ContextualVerticalPlacement;
}

export function contextualPlacement(
  anchor: NormalizedCoordinates,
): ContextualPlacement {
  return {
    horizontal: anchor.x < 0.34 ? "START" : anchor.x > 0.66 ? "END" : "CENTER",
    vertical: anchor.y >= 0.5 ? "ABOVE" : "BELOW",
  };
}

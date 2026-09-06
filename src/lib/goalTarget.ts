import {
  GOAL_TARGET_GEOMETRY_VERSION,
  GoalTargetCoordinates,
  GoalTargetGeometryVersion,
  KeeperBodyPart,
  KeeperBodyZone,
  LiveThreatOutcome,
} from "../types";

/** Evita que un pointerup distinto o sintético cierre la selección espacial. */
export function completesGoalTargetGesture(activePointerId: number | null, releasedPointerId: number): boolean {
  return activePointerId !== null && activePointerId === releasedPointerId;
}

/**
 * Una zona que aparece después de otro gesto solo puede activarse mediante un
 * pointer nuevo que haya empezado en ella. Esto descarta el pointerup/click de
 * compatibilidad que algunos navegadores entregan sobre contenido recién
 * montado tras seleccionar el destino.
 */
export function completesIndependentPointerGesture(
  activePointerId: number | null,
  releasedPointerId: number,
): boolean {
  return activePointerId !== null && activePointerId === releasedPointerId;
}

const LEGACY_GOAL_FRAME = {
  left: 0.12,
  right: 0.88,
  top: 0.14,
  bottom: 0.82,
} as const;

/** Marco V2 congelado para que las capturas existentes no cambien de sentido. */
const V2_GOAL_FRAME = {
  left: 0.22,
  right: 0.78,
  top: 0.23,
  bottom: 0.78,
} as const;

/**
 * Marco V3 alineado con el SVG visible. La tolerancia de seis milésimas cubre
 * el borde interior de postes/larguero sin absorber un toque claramente fuera.
 */
const GOAL_EDGE_TOUCH_TOLERANCE = 0.006;
export const GOAL_FRAME = {
  left: 0.22 - GOAL_EDGE_TOUCH_TOLERANCE,
  right: 0.78 + GOAL_EDGE_TOUCH_TOLERANCE,
  top: 15 / 64 - GOAL_EDGE_TOUCH_TOLERANCE,
  bottom: 50 / 64 + GOAL_EDGE_TOUCH_TOLERANCE,
} as const;

function frameFor(version: GoalTargetGeometryVersion) {
  if (version === 1) return LEGACY_GOAL_FRAME;
  return version === 2 ? V2_GOAL_FRAME : GOAL_FRAME;
}

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

export function isInsideGoalFrame(point: GoalTargetCoordinates): boolean {
  const frame = frameFor(point.geometryVersion);
  return (
    point.x >= frame.left &&
    point.x <= frame.right &&
    point.y >= frame.top &&
    point.y <= frame.bottom
  );
}

function legacyGoalkeeper(point: GoalTargetCoordinates): boolean {
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
  return head || torso || arms || legs;
}

/** Cuerpo central dibujado; la intervención táctil es deliberadamente mayor. */
export function isInsideGoalkeeperBody(point: GoalTargetCoordinates): boolean {
  if (!isInsideGoalFrame(point)) return false;
  if (point.geometryVersion === 1) return legacyGoalkeeper(point);
  const dx = Math.abs(point.x - 0.5);
  const head = (point.x - 0.5) ** 2 + (point.y - 0.4) ** 2 <= 0.048 ** 2;
  const torso = point.y >= 0.45 && point.y <= 0.62 && dx <= 0.075;
  const arms = point.y >= 0.44 && point.y <= 0.58 && dx <= 0.18;
  const legs = point.y > 0.61 && point.y <= 0.76 && dx <= 0.13;
  return head || torso || arms || legs;
}

/**
 * Zona de alcance V2. Sugiere PARADA también en extensiones de brazos, junto a
 * postes y abajo; el usuario puede confirmar GOL en la misma coordenada cuando
 * el resultado real sea distinto, evitando falsear la posición del balón.
 */
export function isInsideGoalkeeperIntervention(
  point: GoalTargetCoordinates,
): boolean {
  if (!isInsideGoalFrame(point)) return false;
  if (point.geometryVersion === 1) return legacyGoalkeeper(point);
  const dx = Math.abs(point.x - 0.5);
  const upperReach = point.y >= 0.32 && point.y <= 0.55 && dx <= 0.265;
  const lowerReach = point.y > 0.55 && point.y <= 0.765 && dx <= 0.235;
  return isInsideGoalkeeperBody(point) || upperReach || lowerReach;
}

/** Inferencia sugerida por el gesto; en V2 el resultado interior se confirma. */
export function classifyGoalTarget(
  point: GoalTargetCoordinates,
): LiveThreatOutcome {
  if (!isInsideGoalFrame(point)) return "FUERA";
  return isInsideGoalkeeperIntervention(point) ? "PARADA" : "GOL";
}

export function isOutcomeCompatibleWithGoalTarget(
  point: GoalTargetCoordinates,
  outcome: LiveThreatOutcome,
): boolean {
  if (point.geometryVersion === 1) return classifyGoalTarget(point) === outcome;
  return isInsideGoalFrame(point)
    ? outcome === "GOL" || outcome === "PARADA"
    : outcome === "FUERA";
}

export function deriveKeeperBodyZone(
  point: GoalTargetCoordinates,
): KeeperBodyZone {
  return point.y < (point.geometryVersion === 1 ? 0.57 : 0.55)
    ? "UPPER"
    : "LOWER";
}

/** La semántica upper/lower procede de la anatomía, nunca del destino. */
export function deriveKeeperBodyZoneFromPart(
  part: KeeperBodyPart,
): KeeperBodyZone {
  return part === "HEAD" ||
    part === "TORSO" ||
    part === "LEFT_ARM_HAND" ||
    part === "RIGHT_ARM_HAND"
    ? "UPPER"
    : "LOWER";
}

/**
 * Convención frontal: la derecha anatómica del portero aparece a la izquierda
 * de quien registra la acción.
 */
export const KEEPER_BODY_SCREEN_SIDE: Readonly<
  Record<KeeperBodyPart, "LEFT" | "CENTER" | "RIGHT">
> = {
  HEAD: "CENTER",
  TORSO: "CENTER",
  RIGHT_ARM_HAND: "LEFT",
  LEFT_ARM_HAND: "RIGHT",
  RIGHT_LEG_FOOT: "LEFT",
  LEFT_LEG_FOOT: "RIGHT",
};

export interface KeeperBodyHitbox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const KEEPER_BODY_SURFACE = {
  left: 0.15,
  top: 0.125,
  width: 0.7,
  height: 0.75,
} as const;

/**
 * Zonas táctiles normalizadas sobre la silueta frontal. Son deliberadamente
 * más anchas que los trazos visibles y no se solapan, para que un dedo no
 * pueda resolver dos partes corporales distintas.
 */
export const KEEPER_BODY_HITBOXES: Readonly<
  Record<KeeperBodyPart, KeeperBodyHitbox>
> = {
  HEAD: { left: 0.375, top: 0, width: 0.25, height: 0.28 },
  TORSO: { left: 0.34, top: 0.28, width: 0.32, height: 0.27 },
  RIGHT_ARM_HAND: { left: 0, top: 0.28, width: 0.34, height: 0.27 },
  LEFT_ARM_HAND: { left: 0.66, top: 0.28, width: 0.34, height: 0.27 },
  RIGHT_LEG_FOOT: { left: 0.18, top: 0.55, width: 0.3, height: 0.45 },
  LEFT_LEG_FOOT: { left: 0.52, top: 0.55, width: 0.3, height: 0.45 },
};

export function validGoalTarget(point: GoalTargetCoordinates): boolean {
  return (
    (point.geometryVersion === 1 ||
      point.geometryVersion === 2 ||
      point.geometryVersion === GOAL_TARGET_GEOMETRY_VERSION) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export type MetricDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "NEUTRAL";
export type MetricFormat = "NUMBER" | "PERCENT" | "MINUTES" | "POINTS";

export interface MetricDefinition {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  formula: string;
  denominator: string;
  unit: string;
  direction: MetricDirection;
  format: MetricFormat;
}

export interface MetricPairDefinition {
  id: "GOALS" | "THREATS" | "ON_TARGET" | "NEAR";
  label: string;
  differenceLabel: string;
  tooltip: string;
  semanticDirection: "LEFT_POSITIVE";
}

export const PAIRED_METRIC_DEFINITIONS: readonly MetricPairDefinition[] = [
  { id: "GOALS", label: "GF-GC", differenceLabel: "DIF. GOLES", tooltip: "Goles CDA menos goles recibidos.", semanticDirection: "LEFT_POSITIVE" },
  { id: "THREATS", label: "REM-AME", differenceLabel: "BALANCE REM/AME", tooltip: "Remates CDA menos Amenazas recibidas.", semanticDirection: "LEFT_POSITIVE" },
  { id: "ON_TARGET", label: "A PUERTA", differenceLabel: "BALANCE A PUERTA", tooltip: "Remates a puerta menos Amenazas a puerta. A puerta = GOL + PARADA.", semanticDirection: "LEFT_POSITIVE" },
  { id: "NEAR", label: "CERCANOS", differenceLabel: "BALANCE CERCANO", tooltip: "Remates cercanos menos Amenazas cercanas. Cercana = Z1 + Z2 + Z3.", semanticDirection: "LEFT_POSITIVE" },
];

export const METRIC_DEFINITIONS = {
  SCORE_ALAM: { id: "SCORE_ALAM", name: "Score ALAM", abbreviation: "SCORE", description: "Indicador experimental que combina producción individual y comportamiento del equipo con el jugador en pista.", formula: "50% percentiles de goles, asistencias y remates /40 + 50% remates, amenazas invertidas y puntos en pista; ajustado por minutos.", denominator: "Grupo comparable y minutos observados", unit: "puntos", direction: "HIGHER_IS_BETTER", format: "POINTS" },
  ON_COURT_POINTS: { id: "ON_COURT_POINTS", name: "Puntos en pista", abbreviation: "PTS EN PISTA", description: "Puntos 3/1/0 derivados del parcial obtenido exclusivamente durante los minutos del jugador en pista.", formula: "3 victoria · 1 empate · 0 derrota en cada partido durante sus intervalos", denominator: "Partidos con participación", unit: "puntos", direction: "HIGHER_IS_BETTER", format: "POINTS" },
  GOAL_DIFFERENCE: { id: "GOAL_DIFFERENCE", name: "Diferencia de goles en pista", abbreviation: "DIF. GOLES", description: "Goles CDA menos goles rival durante los minutos del jugador en pista.", formula: "GF en pista − GC en pista", denominator: "Minutos en pista", unit: "goles", direction: "HIGHER_IS_BETTER", format: "NUMBER" },
  KEY_MINUTES: { id: "KEY_MINUTES", name: "Minutos clave", abbreviation: "MIN. CLAVE", description: "Minutos disputados con empate o una diferencia máxima de un gol.", formula: "Minutos en pista cuando |GF − GC| ≤ 1", denominator: "Cronología y alineación", unit: "minutos", direction: "NEUTRAL", format: "MINUTES" },
  GOLD_MINUTES: { id: "GOLD_MINUTES", name: "Minutos de oro", abbreviation: "MIN. ORO", description: "Minutos disputados en los últimos cinco minutos del partido con empate o una diferencia máxima de un gol.", formula: "Minutos clave en P2 desde 15:00", denominator: "Cronología y alineación", unit: "minutos", direction: "NEUTRAL", format: "MINUTES" },
  KEY_MINUTES_PERCENTAGE: { id: "KEY_MINUTES_PERCENTAGE", name: "Porcentaje de minutos clave", abbreviation: "% CLAVE", description: "Porcentaje del tiempo total de Minutos Clave del equipo en el que este jugador estuvo en pista.", formula: "Minutos clave del jugador / duración cronológica clave del equipo", denominator: "Minutos clave del equipo; no se multiplica por cinco", unit: "%", direction: "NEUTRAL", format: "PERCENT" },
  GOLD_MINUTES_PERCENTAGE: { id: "GOLD_MINUTES_PERCENTAGE", name: "Porcentaje de minutos de oro", abbreviation: "% ORO", description: "Porcentaje del tiempo total de Minutos de Oro del equipo en el que este jugador estuvo en pista.", formula: "Minutos oro del jugador / duración cronológica oro del equipo", denominator: "Minutos de oro del equipo; no se multiplica por cinco", unit: "%", direction: "NEUTRAL", format: "PERCENT" },
  ON_TARGET: { id: "ON_TARGET", name: "A puerta", abbreviation: "A PUERTA", description: "Acciones cuyo resultado fue gol o parada.", formula: "GOL + PARADA", denominator: "Total de remates o amenazas", unit: "acciones", direction: "HIGHER_IS_BETTER", format: "NUMBER" },
  NEAR_ZONE: { id: "NEAR_ZONE", name: "Zona cercana", abbreviation: "CERCANAS", description: "Acciones originadas en Z1, Z2 o Z3, sin interpretar subjetivamente su peligro.", formula: "Z1 + Z2 + Z3", denominator: "Total de remates o amenazas", unit: "acciones", direction: "NEUTRAL", format: "NUMBER" },
  SAVE_PERCENTAGE: { id: "SAVE_PERCENTAGE", name: "Porcentaje de parada", abbreviation: "% PARADA", description: "Paradas sobre acciones interiores dirigidas a portería.", formula: "PARADAS / (PARADAS + GOLES)", denominator: "Amenazas interiores", unit: "%", direction: "HIGHER_IS_BETTER", format: "PERCENT" },
  THREATS_AGAINST_40: { id: "THREATS_AGAINST_40", name: "Amenazas por 40", abbreviation: "AMENAZAS /40", description: "Amenazas rivales normalizadas a cuarenta minutos observados.", formula: "Amenazas × 40 / minutos", denominator: "Minutos observados", unit: "acciones/40", direction: "LOWER_IS_BETTER", format: "NUMBER" },
  MINUTES: { id: "MINUTES", name: "Minutos", abbreviation: "MIN", description: "Tiempo de participación derivado de alineaciones, sustituciones y reloj.", formula: "Suma de intervalos en pista", denominator: "Cronología", unit: "minutos", direction: "NEUTRAL", format: "MINUTES" },
} as const satisfies Record<string, MetricDefinition>;

export type MetricId = keyof typeof METRIC_DEFINITIONS;

export function metricDefinition(id: MetricId): MetricDefinition {
  return METRIC_DEFINITIONS[id];
}

export function compareMetricValues(id: MetricId, left: number | null, right: number | null): "LEFT" | "RIGHT" | "TIE" | "NONE" {
  if (left === null || right === null || METRIC_DEFINITIONS[id].direction === "NEUTRAL") return "NONE";
  if (left === right) return "TIE";
  const higherWins = METRIC_DEFINITIONS[id].direction === "HIGHER_IS_BETTER";
  return (left > right) === higherWins ? "LEFT" : "RIGHT";
}

import { GoalkeeperAnalysis, PlayerAnalysis } from "./dashboardAnalysis";
import { SaveOutcome } from "../types";

export type GoalkeeperSortKey = "minutes" | "matches" | "threatsAgainst" | "threatsAgainst40" | "saves" | "savePercentage" | "goalsAgainst" | "catchPercentage" | "clearancePercentage" | "reboundPercentage";
export type GoalkeeperSortDirection = "ASC" | "DESC";

export interface GoalkeeperTableRow {
  keeper: GoalkeeperAnalysis;
  player?: PlayerAnalysis;
  matches: number;
}

export const GOALKEEPER_SAVE_OUTCOMES: ReadonlyArray<{ key: SaveOutcome; metric: Extract<GoalkeeperSortKey, "catchPercentage" | "clearancePercentage" | "reboundPercentage">; label: string; shortLabel: string }> = [
  { key: "CATCH", metric: "catchPercentage", label: "Blocaje", shortLabel: "BLO %" },
  { key: "CLEARANCE", metric: "clearancePercentage", label: "Despeje", shortLabel: "DES %" },
  { key: "REBOUND", metric: "reboundPercentage", label: "Rechace", shortLabel: "REC %" },
];

export function goalkeeperClassifiedSaves(keeper: GoalkeeperAnalysis): number {
  return Object.values(keeper.saveOutcomes).reduce((sum, value) => sum + value, 0);
}

export function goalkeeperSaveOutcomePercentage(keeper: GoalkeeperAnalysis, outcome: SaveOutcome): number | null {
  const total = goalkeeperClassifiedSaves(keeper);
  return total > 0 ? keeper.saveOutcomes[outcome] / total * 100 : null;
}

export function goalkeeperSortValue(row: GoalkeeperTableRow, key: GoalkeeperSortKey): number | null {
  if (key === "matches") return row.matches;
  if (key === "catchPercentage") return goalkeeperSaveOutcomePercentage(row.keeper, "CATCH");
  if (key === "clearancePercentage") return goalkeeperSaveOutcomePercentage(row.keeper, "CLEARANCE");
  if (key === "reboundPercentage") return goalkeeperSaveOutcomePercentage(row.keeper, "REBOUND");
  return row.keeper[key];
}

export function sortGoalkeeperRows(rows: readonly GoalkeeperTableRow[], key: GoalkeeperSortKey, direction: GoalkeeperSortDirection): GoalkeeperTableRow[] {
  const sign = direction === "DESC" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = goalkeeperSortValue(left, key);
    const b = goalkeeperSortValue(right, key);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (Number(a) - Number(b)) * sign;
  });
}

export interface GoalkeeperComparisonPanel {
  playerId: string;
  name: string;
  targetPoints: GoalkeeperAnalysis["goalPoints"];
  originPoints: GoalkeeperAnalysis["originPoints"];
}

export function buildGoalkeeperComparisonPanels(goalkeepers: readonly GoalkeeperAnalysis[], ids: readonly [string, string]): GoalkeeperComparisonPanel[] {
  return ids.flatMap((id) => {
    const keeper = goalkeepers.find((candidate) => candidate.playerId === id);
    return keeper ? [{ playerId: keeper.playerId, name: keeper.name, targetPoints: keeper.goalPoints, originPoints: keeper.originPoints }] : [];
  });
}

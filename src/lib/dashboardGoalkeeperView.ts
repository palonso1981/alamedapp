import { GoalkeeperAnalysis, PlayerAnalysis } from "./dashboardAnalysis";

export type GoalkeeperSortKey = "minutes" | "matches" | "threatsAgainst" | "threatsAgainst40" | "saves" | "savePercentage" | "goalsAgainst";
export type GoalkeeperSortDirection = "ASC" | "DESC";

export interface GoalkeeperTableRow {
  keeper: GoalkeeperAnalysis;
  player?: PlayerAnalysis;
  matches: number;
}

export function sortGoalkeeperRows(rows: readonly GoalkeeperTableRow[], key: GoalkeeperSortKey, direction: GoalkeeperSortDirection): GoalkeeperTableRow[] {
  const sign = direction === "DESC" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = key === "matches" ? left.matches : left.keeper[key] ?? -Infinity;
    const b = key === "matches" ? right.matches : right.keeper[key] ?? -Infinity;
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

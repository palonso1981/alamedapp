import { MatchCatalogEntry } from "./matchCatalog";

export interface SearchableMatch extends MatchCatalogEntry {
  competitionLabel?: string;
  competitionType?: "LEAGUE" | "CUP" | "FRIENDLY" | "OTHER" | "UNSPECIFIED";
  matchday?: number;
  scoreLabel?: string;
}

export function toggleMatchSelection(values: readonly string[], matchId: string): string[] {
  return values.includes(matchId) ? values.filter((value) => value !== matchId) : [...values, matchId];
}

export function matchSelectionLabel(matches: readonly SearchableMatch[], values: readonly string[], allLabel = "Todos los partidos"): string {
  if (values.length === 0) return allLabel;
  if (values.length === 1) {
    const selected = matches.find((match) => match.matchId === values[0]);
    return selected ? searchableMatchLabel(selected) : values[0];
  }
  return `${values.length} partidos seleccionados`;
}

export function normalizeDashboardSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim().replace(/\s+/g, " ");
}

export function matchSearchText(match: SearchableMatch): string {
  return normalizeDashboardSearch([
    match.opponent,
    match.date,
    match.competitionLabel,
    match.matchday ? `j${match.matchday} jornada ${match.matchday}` : "",
    match.scoreLabel,
  ].filter(Boolean).join(" "));
}

export function filterSearchableMatches(matches: readonly SearchableMatch[], query: string): SearchableMatch[] {
  const normalized = normalizeDashboardSearch(query);
  if (!normalized) return [...matches];
  return matches.filter((match) => matchSearchText(match).includes(normalized));
}

export function searchableMatchLabel(match: SearchableMatch): string {
  const lead = match.matchday ? `J${match.matchday}` : match.competitionLabel ?? "PARTIDO";
  const date = match.date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${match.date}T00:00:00Z`)) : "Sin fecha";
  return `${lead} · ${match.opponent} · ${date}${match.scoreLabel ? ` · ${match.scoreLabel}` : ""}`;
}

export function adaptiveChartLayout(count: number, width: number): { gap: number; labelEvery: number } {
  const safeWidth = Math.max(240, width);
  const gap = count <= 5 ? 12 : count <= 15 ? 5 : count <= 30 ? 2 : 1;
  const desiredLabels = Math.max(2, Math.floor(safeWidth / 70));
  return { gap, labelEvery: Math.max(1, Math.ceil(Math.max(1, count) / desiredLabels)) };
}

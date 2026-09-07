export function safeDashboardReturnTo(value: string | null | undefined): string | null {
  if (!value || value.includes("\\") || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, "https://alamedapp.local");
    if (parsed.origin !== "https://alamedapp.local") return null;
    if (parsed.pathname !== "/dashboard" && !parsed.pathname.startsWith("/dashboard/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function revisionEventHref(matchId: string, eventId: string, returnTo: string, fixture = false): string {
  const params = new URLSearchParams({ eventId });
  if (fixture) params.set("fixture", "1");
  const safeReturn = safeDashboardReturnTo(returnTo);
  if (safeReturn) params.set("returnTo", safeReturn);
  return `/partido/${encodeURIComponent(matchId)}/revision?${params}`;
}

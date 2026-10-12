"use client";

import Link from "next/link";
import { RefObject, useEffect, useMemo, useState } from "react";
import { DashboardMatchRecord } from "../../lib/dashboardAnalytics";
import { DashboardScopeV2, dashboardActiveFilterCount } from "../../lib/dashboardV2";
import { dashboardVideoHref, dashboardVideoItems, DashboardVideoOverride } from "../../lib/dashboardVideoContext";

export interface DashboardProfileVideoTarget { label: string; override: DashboardVideoOverride; }

export function DashboardProfileSticky({ anchor, backHref, scope, records, matches, targets }: { anchor: RefObject<HTMLElement | null>; backHref: string; scope: DashboardScopeV2; records: DashboardMatchRecord[]; matches: Array<{ matchId: string; opponent: string }>; targets: DashboardProfileVideoTarget[] }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = anchor.current; if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 64));
    observer.observe(node); return () => observer.disconnect();
  }, [anchor]);
  const videos = useMemo(() => targets.map((target) => ({ ...target, count: dashboardVideoItems(records, scope, target.override).length, href: dashboardVideoHref(scope, target.override) })), [records, scope, targets]);
  if (!visible) return null;
  const match = scope.matchIds.length === 1 ? matches.find((item) => item.matchId === scope.matchIds[0])?.opponent ?? "1 partido" : scope.matchIds.length ? `${scope.matchIds.length} partidos` : "Todos los partidos";
  const competition = scope.competition === "ALL" ? "Todas" : scope.competition;
  return <aside data-dashboard-profile-sticky className="fixed inset-x-0 top-20 z-30 mx-auto flex min-h-12 max-w-7xl items-center gap-2 overflow-x-auto border-y border-slate-700 bg-slate-950/95 px-2 py-1 shadow-2xl backdrop-blur sm:top-16">
    <Link href={backHref} className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-[9px] font-black">← DASHBOARD</Link>
    <span className="hidden shrink-0 text-[9px] font-black text-slate-400 sm:inline">{competition} · {match}</span>
    {dashboardActiveFilterCount(scope) > scope.matchIds.length && <button type="button" onClick={() => document.getElementById("dashboard-advanced-filters")?.scrollIntoView({ behavior: "smooth" })} className="shrink-0 rounded-full bg-amber-950 px-2 py-1 text-[9px] font-black text-amber-200">FILTROS · {dashboardActiveFilterCount(scope)}</button>}
    <span className="flex-1"/>{videos.filter((video) => video.count > 0).map((video) => <Link key={video.label} target="_blank" rel="noreferrer" href={video.href} className="shrink-0 rounded-lg bg-violet-950 px-3 py-2 text-[9px] font-black text-violet-200">🎬 {video.label} · {video.count}</Link>)}
  </aside>;
}

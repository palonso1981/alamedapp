export interface DashboardInteractionSample {
  name: string;
  milliseconds: number;
  measuredAt: number;
}

const starts = new Map<string, number>();
const samples: DashboardInteractionSample[] = [];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function beginDashboardInteraction(name: string): void {
  if (process.env.NODE_ENV === "production") return;
  starts.set(name, now());
}

/** Measures through two frames, so it includes React commit and browser paint. */
export function finishDashboardInteractionAfterPaint(name: string): void {
  if (process.env.NODE_ENV === "production") return;
  const startedAt = starts.get(name);
  if (startedAt === undefined) return;
  const finish = () => {
    const sample = { name, milliseconds: now() - startedAt, measuredAt: Date.now() };
    samples.push(sample);
    if (samples.length > 100) samples.shift();
    starts.delete(name);
    (globalThis as typeof globalThis & { __ALAMEDAPP_DASHBOARD_PERF__?: DashboardInteractionSample[] }).__ALAMEDAPP_DASHBOARD_PERF__ = [...samples];
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(finish));
  else setTimeout(finish, 0);
}

export function dashboardInteractionSamples(): readonly DashboardInteractionSample[] {
  return [...samples];
}


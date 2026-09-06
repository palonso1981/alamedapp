"use client";

export interface EvolutionPoint { id: string; label: string; detail: string; value: number | null; }

export function EvolutionChart({ points, reference, referenceLabel }: { points: EvolutionPoint[]; reference: number | null; referenceLabel: string }) {
  const numeric = points.flatMap((point) => point.value === null ? [] : [point.value]);
  const max = Math.max(1, reference ?? 0, ...numeric);
  return <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900 p-4"><div className="relative h-56" style={{ minWidth: `${Math.max(620, points.length * 82)}px` }}>
    {reference !== null && <div className="absolute inset-x-0 border-t border-dashed border-amber-300" style={{ bottom: `${reference / max * 82 + 10}%` }}><span className="absolute right-0 -top-5 rounded bg-amber-950 px-2 py-0.5 text-[9px] font-black text-amber-100">{referenceLabel} {format(reference)}</span></div>}
    <div className="absolute inset-0 flex items-end gap-3 border-b border-slate-700 px-2 pb-7">{points.map((point) => <button type="button" key={point.id} title={`${point.detail} · ${point.value === null ? "N/D" : format(point.value)} · ${referenceLabel} ${reference === null ? "N/D" : format(reference)}`} className="group relative h-full min-w-14 flex-1"><span className="absolute inset-x-2 bottom-0 rounded-t bg-cyan-400 transition group-focus:bg-cyan-200" style={{ height: point.value === null ? "0" : `${Math.max(3, point.value / max * 82)}%` }}/><strong className="absolute inset-x-0 bottom-[-22px] truncate text-[9px] text-slate-400">{point.label}</strong>{point.value !== null && <span className="absolute inset-x-0 text-center text-[9px] font-black text-white" style={{ bottom: `${Math.max(4, point.value / max * 82 + 1)}%` }}>{format(point.value)}</span>}</button>)}</div>
  </div></div>;
}

const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

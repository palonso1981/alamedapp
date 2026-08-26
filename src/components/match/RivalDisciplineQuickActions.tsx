"use client";

interface RivalDisciplineQuickActionsProps {
  yellowCards: number;
  redCards: number;
  onYellow: () => void;
  onRed: () => void;
}

export function RivalDisciplineQuickActions({
  yellowCards,
  redCards,
  onYellow,
  onRed,
}: RivalDisciplineQuickActionsProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-rose-950 bg-slate-950 p-1" aria-label="Tarjetas del rival">
      <span className="px-1 text-[9px] font-black text-rose-300">RIV</span>
      <button
        type="button"
        onClick={onYellow}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg bg-yellow-950/70"
        aria-label="Tarjeta amarilla rival"
      >
        <span className="h-6 w-4 rotate-3 rounded-sm border border-yellow-100 bg-yellow-400" aria-hidden="true" />
        <span className="text-[10px] font-black text-yellow-200">{yellowCards}</span>
      </button>
      <button
        type="button"
        onClick={onRed}
        className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg bg-red-950/70"
        aria-label="Tarjeta roja rival"
      >
        <span className="h-6 w-4 rotate-3 rounded-sm border border-red-100 bg-red-500" aria-hidden="true" />
        <span className="text-[10px] font-black text-red-200">{redCards}</span>
      </button>
    </div>
  );
}

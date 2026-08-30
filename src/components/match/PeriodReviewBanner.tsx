"use client";

import { REGULATION_MATCH_CLOCK } from "../../lib/matchEngine";

export function PeriodReviewBanner({
  activePeriod,
  reviewPeriod,
  reviewMinute,
  matchFinished = false,
  onMinuteChange,
  onReturn,
}: {
  activePeriod: number;
  reviewPeriod: number;
  reviewMinute: number;
  matchFinished?: boolean;
  onMinuteChange: (minute: number) => void;
  onReturn: () => void;
}) {
  const duration = REGULATION_MATCH_CLOCK.periodDurationMinutes;
  return (
    <section
      className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-2xl border-2 border-amber-300 bg-amber-950/95 px-3 py-2 text-amber-50 shadow-xl"
      aria-label={matchFinished ? `Revisando partido finalizado, periodo ${reviewPeriod}` : `Revisando periodo ${reviewPeriod}; periodo ${activePeriod} sigue activo`}
    >
      <div className="mr-auto">
        <p className="text-sm font-black">{matchFinished ? "PARTIDO FINALIZADO · REVISIÓN" : `REVISANDO P${reviewPeriod}`}</p>
        <p className="text-[10px] font-bold text-amber-300">{matchFinished ? `CORRECCIÓN RETROACTIVA EN P${reviewPeriod}` : `P${activePeriod} SIGUE SIENDO LA PARTE ACTUAL`}</p>
      </div>
      <div className="flex items-center gap-1 rounded-xl bg-slate-950 p-1" aria-label="Minuto de corrección">
        <button type="button" onClick={() => onMinuteChange(reviewMinute - 1)} disabled={reviewMinute <= 0} className="min-h-11 min-w-11 rounded-lg bg-slate-800 text-xl font-black disabled:opacity-30" aria-label="Restar minuto de revisión">−1</button>
        <output className="grid min-h-11 min-w-14 place-items-center rounded-lg bg-amber-300 font-mono text-xl font-black text-slate-950" aria-label={`Minuto ${reviewMinute} de revisión`}>{reviewMinute}&apos;</output>
        <button type="button" onClick={() => onMinuteChange(reviewMinute + 1)} disabled={reviewMinute >= duration} className="min-h-11 min-w-11 rounded-lg bg-slate-800 text-xl font-black disabled:opacity-30" aria-label="Sumar minuto de revisión">+1</button>
      </div>
      <button type="button" onClick={onReturn} className="min-h-12 rounded-xl bg-cyan-500 px-4 text-xs font-black text-slate-950">{matchFinished ? "CERRAR REVISIÓN" : `VOLVER A P${activePeriod}`}</button>
    </section>
  );
}

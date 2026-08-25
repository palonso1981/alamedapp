"use client";

import { useEffect, useState } from "react";

import { REGULATION_MATCH_CLOCK } from "../../lib/matchEngine";

export type ClockSide = "left" | "right";

interface MatchClockControlProps {
  period: number;
  minute: number;
  side: ClockSide;
  onSideChange: (side: ClockSide) => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onPeriodChange: (period: number) => void;
}

function PeriodSwitch({
  period,
  pending,
  onRequest,
  onConfirm,
  onCancel,
}: {
  period: number;
  pending: boolean;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const targetPeriod = period === 1 ? 2 : 1;
  if (pending) {
    return (
      <div className="grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-1 rounded-xl bg-amber-300 p-1 text-slate-950 shadow-lg">
        <span className="pl-1 text-sm font-black">P{targetPeriod}?</span>
        <button
          type="button"
          onClick={onConfirm}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg bg-slate-950 text-lg font-black text-white"
          aria-label={`Confirmar cambio a P${targetPeriod}`}
        >
          ✓
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg bg-amber-100 text-lg font-black"
          aria-label="Cancelar cambio de periodo"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onRequest}
      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-3 text-lg font-black text-white"
      aria-label={`Periodo P${period}. Cambiar a P${targetPeriod}`}
      title={`Cambiar a P${targetPeriod}`}
    >
      P{period}
      <span className="text-xs text-slate-400" aria-hidden="true">
        ⇅
      </span>
    </button>
  );
}

export function MatchClockControl({
  period,
  minute,
  side,
  onSideChange,
  onIncrement,
  onDecrement,
  onPeriodChange,
}: MatchClockControlProps) {
  const [periodConfirmation, setPeriodConfirmation] = useState(false);
  const targetPeriod = period === 1 ? 2 : 1;
  const atStart = minute <= 0;
  const atEnd = minute >= REGULATION_MATCH_CLOCK.periodDurationMinutes;
  const sideClass = side === "left" ? "left-2" : "right-2";

  useEffect(() => {
    if (!periodConfirmation) return;
    const timeout = window.setTimeout(
      () => setPeriodConfirmation(false),
      4_000,
    );
    return () => window.clearTimeout(timeout);
  }, [periodConfirmation]);

  const confirmPeriod = () => {
    onPeriodChange(targetPeriod);
    setPeriodConfirmation(false);
  };

  const swapSide = () => onSideChange(side === "left" ? "right" : "left");

  return (
    <>
      <aside
        className={`fixed top-[58%] z-40 hidden w-24 -translate-y-1/2 flex-col gap-2 rounded-2xl border border-slate-600/80 bg-slate-950/95 p-2 shadow-2xl backdrop-blur sm:flex ${sideClass}`}
        aria-label="Control del minuto y periodo"
      >
        <PeriodSwitch
          period={period}
          pending={periodConfirmation}
          onRequest={() => setPeriodConfirmation(true)}
          onConfirm={confirmPeriod}
          onCancel={() => setPeriodConfirmation(false)}
        />
        <button
          type="button"
          onClick={onDecrement}
          disabled={atStart}
          className="min-h-16 rounded-xl border border-slate-700 bg-slate-800 text-2xl font-black transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-25"
          aria-label="Restar un minuto"
        >
          −1
        </button>
        <output
          className="grid min-h-20 place-items-center rounded-xl bg-cyan-950 font-mono text-5xl font-black leading-none text-cyan-200"
          aria-label={`Minuto ${minute}`}
        >
          {minute}
        </output>
        <button
          type="button"
          onClick={onIncrement}
          disabled={atEnd}
          className="min-h-20 rounded-xl bg-emerald-500 text-3xl font-black text-slate-950 shadow-[0_0_22px_rgba(16,185,129,0.25)] transition active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none"
          aria-label="Sumar un minuto"
        >
          +1
        </button>
        <button
          type="button"
          onClick={swapSide}
          className="grid min-h-10 place-items-center rounded-lg text-xl text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label={`Mover minutero al lateral ${side === "left" ? "derecho" : "izquierdo"}`}
          title="Cambiar de lado"
        >
          ⇆
        </button>
      </aside>

      <aside
        className={`fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex max-w-[calc(100vw-1.5rem)] items-stretch gap-1 rounded-2xl border border-slate-600/80 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur sm:hidden ${sideClass}`}
        aria-label="Control del minuto y periodo"
      >
        <div className="relative flex min-w-14 items-stretch">
          {periodConfirmation ? (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-0 w-48 rounded-xl shadow-xl">
              <PeriodSwitch
                period={period}
                pending
                onRequest={() => undefined}
                onConfirm={confirmPeriod}
                onCancel={() => setPeriodConfirmation(false)}
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setPeriodConfirmation(true)}
            className="min-w-14 rounded-xl border border-slate-700 bg-slate-800 text-base font-black"
            aria-label={`Periodo P${period}. Cambiar a P${targetPeriod}`}
          >
            P{period}
            <span className="ml-1 text-[10px] text-slate-400" aria-hidden="true">
              ⇅
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={onDecrement}
          disabled={atStart}
          className="min-h-14 min-w-14 rounded-xl bg-slate-800 text-xl font-black active:scale-95 disabled:opacity-25"
          aria-label="Restar un minuto"
        >
          −1
        </button>
        <output
          className="grid min-h-14 min-w-16 place-items-center rounded-xl bg-cyan-950 font-mono text-3xl font-black text-cyan-200"
          aria-label={`Minuto ${minute}`}
        >
          {minute}
        </output>
        <button
          type="button"
          onClick={onIncrement}
          disabled={atEnd}
          className="min-h-14 min-w-16 rounded-xl bg-emerald-500 text-2xl font-black text-slate-950 active:scale-95 disabled:bg-slate-800 disabled:text-slate-600"
          aria-label="Sumar un minuto"
        >
          +1
        </button>
        <button
          type="button"
          onClick={swapSide}
          className="min-h-14 min-w-10 rounded-xl text-lg text-slate-400"
          aria-label={`Mover minutero al lateral ${side === "left" ? "derecho" : "izquierdo"}`}
        >
          ⇆
        </button>
      </aside>
    </>
  );
}

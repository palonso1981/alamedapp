"use client";

import { useEffect, useState } from "react";
import { deriveRemainingMinute, REGULATION_MATCH_CLOCK } from "../../lib/matchEngine";
import { ClockSide, ClockVerticalSlot } from "./MatchClockControl";

interface MatchRailControlProps {
  period: number;
  elapsedMinute: number;
  closedPeriods: number[];
  matchFinished: boolean;
  reviewing?: boolean;
  side: ClockSide;
  verticalSlot: ClockVerticalSlot;
  superiorityActive: boolean;
  flyingGoalkeeperActive: boolean;
  inferiorityActive: boolean;
  flyingGoalkeeperLabel?: string;
  onIncreaseRemaining: () => void;
  onDecreaseRemaining: () => void;
  onFinishPeriod: () => void;
  onStartSecondPeriod: () => void;
  onResumeFirstPeriod: () => void;
  onToggleSuperiority: () => void;
  onToggleFlyingGoalkeeper: () => void;
  onSideChange: (side: ClockSide) => void;
  onVerticalSlotChange: (slot: ClockVerticalSlot) => void;
}

export function MatchRailControl(props: MatchRailControlProps) {
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const duration = REGULATION_MATCH_CLOCK.periodDurationMinutes;
  const remaining = deriveRemainingMinute(props.elapsedMinute, duration);
  const closed = props.closedPeriods.includes(props.period);
  const sideClass = props.side === "left" ? "left-2" : "right-2";
  const verticalClass = { top: "top-[25%]", center: "top-[52%]", bottom: "top-[76%]" }[props.verticalSlot];
  const startSecond = props.period === 1 && closed && !props.matchFinished;

  useEffect(() => {
    if (!confirmFinish) return;
    const timer = window.setTimeout(() => setConfirmFinish(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmFinish]);

  const cycleVertical = () => {
    const slots: ClockVerticalSlot[] = ["top", "center", "bottom"];
    props.onVerticalSlotChange(slots[(slots.indexOf(props.verticalSlot) + 1) % slots.length]);
  };
  const toggleSide = () => props.onSideChange(props.side === "left" ? "right" : "left");
  const finish = () => {
    props.onFinishPeriod();
    setConfirmFinish(false);
  };

  const stateButtons = (
    <div className="grid min-w-28 grid-cols-2 gap-1.5">
      <button type="button" disabled={props.reviewing} onClick={props.onToggleSuperiority} className={`min-h-14 rounded-xl text-lg font-black shadow-inner disabled:opacity-40 ${props.superiorityActive ? "animate-pulse bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-400"}`} aria-pressed={props.superiorityActive} aria-label="Alternar superioridad">⚡</button>
      <button type="button" disabled={props.reviewing} onClick={props.onToggleFlyingGoalkeeper} className={`min-h-14 rounded-xl text-base font-black shadow-inner disabled:opacity-40 ${props.flyingGoalkeeperActive ? "bg-rose-600 text-white" : "bg-slate-800 text-slate-400"}`} aria-pressed={props.flyingGoalkeeperActive} aria-label={`Portero-jugador${props.flyingGoalkeeperLabel ? `: ${props.flyingGoalkeeperLabel}` : ""}`}>◇⁺</button>
      <span className={`col-span-2 grid min-h-9 place-items-center rounded-lg text-xs font-black ${props.inferiorityActive ? "bg-red-950 text-red-200" : "bg-slate-900 text-slate-400"}`} aria-label={props.inferiorityActive ? "Estado cuatro contra cinco" : "Estado cinco contra cinco"}>{props.inferiorityActive ? "4v5" : "5v5"}</span>
    </div>
  );

  const lifecycle = props.reviewing ? (
    <span className="grid min-h-12 place-items-center rounded-lg border border-cyan-800 bg-slate-900 text-[10px] font-black text-cyan-300">P{props.period} ●</span>
  ) : startSecond ? (
    <div className="grid gap-1">
      <button type="button" onClick={props.onStartSecondPeriod} className="min-h-12 rounded-xl bg-cyan-500 px-2 text-[10px] font-black text-slate-950">▶ P2</button>
      {confirmResume ? (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-amber-300 p-1">
          <button type="button" onClick={() => { props.onResumeFirstPeriod(); setConfirmResume(false); }} className="min-h-12 rounded-lg bg-slate-950 text-sm font-black text-white" aria-label="Confirmar reanudar P1">✓ P1</button>
          <button type="button" onClick={() => setConfirmResume(false)} className="min-h-12 rounded-lg bg-amber-100 font-black text-slate-950" aria-label="Cancelar reanudación">×</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmResume(true)} className="min-h-11 rounded-lg bg-slate-900 px-2 text-[9px] font-black text-amber-300" aria-label="Preparar reanudación de P1">↶ REANUDAR P1</button>
      )}
    </div>
  ) : closed || props.matchFinished ? (
    <span className="grid min-h-12 place-items-center rounded-lg bg-slate-900 text-[10px] font-black text-slate-500">{props.matchFinished ? "FIN" : `P${props.period} ✓`}</span>
  ) : confirmFinish ? (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-amber-300 p-1">
      <button type="button" onClick={finish} className="min-h-11 rounded-lg bg-slate-950 text-lg font-black text-white" aria-label={`Confirmar finalizar ${props.period === 1 ? "parte" : "partido"}`}>✓</button>
      <button type="button" onClick={() => setConfirmFinish(false)} className="min-h-11 rounded-lg bg-amber-100 text-lg font-black text-slate-950" aria-label="Cancelar cierre">×</button>
    </div>
  ) : (
    <button type="button" onClick={() => setConfirmFinish(true)} className="min-h-12 rounded-lg border border-slate-700 bg-slate-900 px-1 text-[9px] font-black text-slate-400">■ {props.period === 1 ? "PARTE" : "PARTIDO"}</button>
  );

  return (
    <>
      <aside className={`fixed z-40 hidden w-32 -translate-y-1/2 flex-col gap-1.5 rounded-2xl border border-slate-600/80 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur sm:flex ${sideClass} ${verticalClass}`} aria-label="Control de partido">
        <div className="flex items-center justify-between rounded-lg bg-slate-900 px-2 py-1"><strong>P{props.period}</strong><span className="text-[9px] font-black text-slate-500">RESTANTE</span></div>
        <div className={`grid grid-cols-[3.5rem_1fr] gap-1.5 ${props.side === "right" ? "[direction:rtl]" : ""}`}>
          <div className="grid gap-1 [direction:ltr]">
            <button type="button" onClick={props.onIncreaseRemaining} disabled={remaining >= duration || closed || props.reviewing} className="min-h-16 rounded-xl border border-emerald-200/40 bg-emerald-500 text-2xl font-black text-slate-950 shadow-lg active:scale-95 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-600" aria-label="Añadir un minuto restante">+1</button>
            <button type="button" onClick={props.onDecreaseRemaining} disabled={remaining <= 0 || closed || props.reviewing} className="min-h-16 rounded-xl border border-slate-600 bg-slate-800 text-2xl font-black shadow-lg active:scale-95 disabled:opacity-25" aria-label="Restar un minuto restante">−1</button>
          </div>
          <output className="grid place-items-center rounded-xl border border-cyan-200/70 bg-cyan-300 font-mono text-4xl font-black text-slate-950 [direction:ltr]" aria-label={`${remaining} minutos restantes`}>{remaining}</output>
        </div>
        {stateButtons}
        {lifecycle}
        <div className="grid grid-cols-2 gap-1"><button type="button" onClick={cycleVertical} className="min-h-11 rounded-lg bg-slate-900 text-slate-500" aria-label="Cambiar altura del control">↕</button><button type="button" onClick={toggleSide} className="min-h-11 rounded-lg bg-slate-900 text-slate-500" aria-label="Cambiar lateral del control">⇆</button></div>
      </aside>

      <aside className={`fixed bottom-[max(.5rem,env(safe-area-inset-bottom))] z-40 flex max-w-[calc(100vw-1rem)] items-stretch gap-1 rounded-2xl border border-slate-600/80 bg-slate-950/95 p-1.5 shadow-2xl sm:hidden ${sideClass}`} aria-label="Control de partido móvil">
        <div className="grid min-w-12 place-items-center rounded-xl bg-slate-900 text-sm font-black">P{props.period}</div>
        <button type="button" onClick={props.onIncreaseRemaining} disabled={remaining >= duration || closed || props.reviewing} className="min-h-[3.75rem] min-w-[3.75rem] rounded-xl border border-emerald-200/40 bg-emerald-500 text-2xl font-black text-slate-950 shadow-lg disabled:bg-slate-800 disabled:text-slate-600" aria-label="Añadir un minuto restante">+1</button>
        <output className="grid min-w-16 place-items-center rounded-xl bg-cyan-300 font-mono text-3xl font-black text-slate-950" aria-label={`${remaining} minutos restantes`}>{remaining}</output>
        <button type="button" onClick={props.onDecreaseRemaining} disabled={remaining <= 0 || closed || props.reviewing} className="min-h-[3.75rem] min-w-[3.75rem] rounded-xl border border-slate-600 bg-slate-800 text-2xl font-black shadow-lg disabled:opacity-25" aria-label="Restar un minuto restante">−1</button>
        <button type="button" onClick={toggleSide} className="min-w-11 rounded-xl text-slate-500" aria-label="Cambiar lateral">⇆</button>
        <div className="absolute bottom-[calc(100%+.35rem)] left-0 flex gap-1 rounded-xl bg-slate-950/95 p-1">{stateButtons}{lifecycle}</div>
      </aside>
    </>
  );
}

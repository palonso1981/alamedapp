"use client";

import { PointerEvent, useEffect, useState } from "react";
import {
  isInsideGoalFrame,
  normalizeGoalTargetPoint,
} from "../../../lib/goalTarget";
import {
  GoalTargetCoordinates,
  KeeperBodyPart,
  LiveThreatOutcome,
} from "../../../types";

interface GoalTargetPickerProps {
  value?: GoalTargetCoordinates | null;
  onSelect: (
    point: GoalTargetCoordinates,
    outcome: LiveThreatOutcome,
    bodyPart?: KeeperBodyPart,
  ) => void;
  compact?: boolean;
}

export function GoalTargetPicker({ value, onSelect, compact = false }: GoalTargetPickerProps) {
  const [pendingPoint, setPendingPoint] = useState<GoalTargetCoordinates | null>(null);

  useEffect(() => setPendingPoint(null), [value?.geometryVersion, value?.x, value?.y]);

  const select = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const point = normalizeGoalTargetPoint(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    if (!isInsideGoalFrame(point)) {
      onSelect(point, "FUERA");
      return;
    }
    setPendingPoint(point);
  };

  const confirm = (outcome: "GOL" | "PARADA", bodyPart?: KeeperBodyPart) => {
    if (!pendingPoint) return;
    onSelect(pendingPoint, outcome, bodyPart);
  };

  const point = pendingPoint ?? value ?? null;
  const insideFrame = pendingPoint ? isInsideGoalFrame(pendingPoint) : false;

  return (
    <div className="relative">
      <button
        type="button"
        onPointerUp={select}
        className={`relative block w-full touch-manipulation overflow-hidden rounded-2xl border border-sky-300/30 bg-slate-950 shadow-inner ${compact ? "aspect-[25/16] min-h-44" : "aspect-[25/16]"}`}
        aria-label="Portería CDA: toca destino del disparo rival"
      >
        <svg viewBox="0 0 100 64" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="goal-surface" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#081525" />
              <stop offset="1" stopColor="#123653" />
            </linearGradient>
          </defs>
          <rect width="100" height="64" fill="url(#goal-surface)" />
          <path d="M22 50 L27 55 H73 L78 50" fill="#0f2940" stroke="#64748b" strokeWidth="0.65" />
          <path d="M22 15 L27 19 H73 L78 15 M27 19V55 M73 19V55" fill="none" stroke="#94a3b8" strokeWidth="0.7" opacity="0.8" />
          <g stroke="#64748b" strokeWidth="0.45" opacity="0.55">
            {[27, 34.7, 42.3, 50, 57.7, 65.3, 73].map((x) => <line key={`v-${x}`} x1={x} y1="19" x2={x} y2="55" />)}
            {[24, 30, 36, 42, 48].map((y) => <line key={`h-${y}`} x1="24" y1={y} x2="76" y2={y} />)}
          </g>
          <path d="M22 50V15H78V50" fill="none" stroke="#f8fafc" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
          <path d="M22 50H78" stroke="#dbeafe" strokeDasharray="1.5 1.5" strokeWidth="0.8" />
          <path d="M24 25 Q50 16 76 25 V49 Q50 58 24 49 Z" fill="#38bdf8" opacity="0.08" stroke="#7dd3fc" strokeDasharray="2 2" strokeWidth="0.6" />
        </svg>
        {point && (
          <span
            className={`pointer-events-none absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_6px_rgba(255,255,255,0.2)] ${insideFrame ? "bg-rose-500" : "bg-amber-400"}`}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          />
        )}
      </button>

      {pendingPoint && insideFrame && (
        <div className="absolute inset-x-2 bottom-2 z-20 grid grid-cols-[0.72fr_1.28fr] gap-2 rounded-xl border border-white/20 bg-slate-950/95 p-2 shadow-2xl">
          <OutcomeButton label="⚽ GOL" onClick={() => confirm("GOL")} />
          <KeeperBodyPicker onSelect={(part) => confirm("PARADA", part)} />
        </div>
      )}
    </div>
  );
}

function OutcomeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-40 rounded-lg border-2 border-rose-300 bg-rose-700 px-2 text-base font-black text-white">
      {label}
    </button>
  );
}

export function KeeperBodyPicker({ onSelect }: { onSelect: (part: KeeperBodyPart) => void }) {
  const parts: Array<{ part: KeeperBodyPart; label: string; className: string }> = [
    { part: "HEAD", label: "Cabeza", className: "left-[43%] top-[3%] h-[18%] w-[14%] rounded-full" },
    { part: "TORSO", label: "Tronco", className: "left-[38%] top-[22%] h-[34%] w-[24%] rounded-[38%]" },
    { part: "RIGHT_ARM_HAND", label: "Brazo y mano derecha", className: "left-[5%] top-[24%] h-[28%] w-[34%] -rotate-12 rounded-full" },
    { part: "LEFT_ARM_HAND", label: "Brazo y mano izquierda", className: "right-[5%] top-[24%] h-[28%] w-[34%] rotate-12 rounded-full" },
    { part: "RIGHT_LEG_FOOT", label: "Pierna y pie derechos", className: "left-[23%] bottom-[1%] h-[43%] w-[27%] rotate-6 rounded-full" },
    { part: "LEFT_LEG_FOOT", label: "Pierna y pie izquierdos", className: "right-[23%] bottom-[1%] h-[43%] w-[27%] -rotate-6 rounded-full" },
  ];
  return (
    <div className="relative min-h-40 overflow-hidden rounded-lg border-2 border-sky-400/60 bg-gradient-to-b from-sky-950 to-slate-950" aria-label="Toca la zona del portero que realiza la parada">
      <svg viewBox="0 0 100 140" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx="50" cy="16" r="11" fill="#fdba74" stroke="#ffedd5" strokeWidth="2" />
        <path d="M36 33 Q50 27 64 33 L67 76 Q50 84 33 76 Z" fill="#fb923c" stroke="#fed7aa" strokeWidth="2" />
        <path d="M35 39 L12 69 L5 61 M65 39 L88 69 L95 61" fill="none" stroke="#fb923c" strokeWidth="10" strokeLinecap="round" />
        <path d="M40 77 L27 128 L17 134 M60 77 L73 128 L83 134" fill="none" stroke="#f97316" strokeWidth="12" strokeLinecap="round" />
        <circle cx="5" cy="61" r="7" fill="#f8fafc" /><circle cx="95" cy="61" r="7" fill="#f8fafc" />
      </svg>
      {parts.map(({ part, label, className }) => (
        <button key={part} type="button" onClick={() => onSelect(part)} className={`absolute z-10 border-2 border-transparent bg-white/[0.02] transition hover:border-white/60 hover:bg-cyan-300/30 ${className}`} aria-label={`Parada con ${label}`} />
      ))}
      <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] font-black uppercase tracking-wider text-sky-100">toca el cuerpo</span>
    </div>
  );
}

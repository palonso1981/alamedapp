"use client";

import { PointerEvent, useEffect, useState } from "react";
import {
  classifyGoalTarget,
  deriveKeeperBodyZone,
  isInsideGoalFrame,
  normalizeGoalTargetPoint,
} from "../../../lib/goalTarget";
import {
  GoalTargetCoordinates,
  KeeperBodyZone,
  LiveThreatOutcome,
} from "../../../types";

interface GoalTargetPickerProps {
  value?: GoalTargetCoordinates | null;
  onSelect: (
    point: GoalTargetCoordinates,
    outcome: LiveThreatOutcome,
    bodyZone?: KeeperBodyZone,
  ) => void;
  compact?: boolean;
}

export function GoalTargetPicker({ value, onSelect, compact = false }: GoalTargetPickerProps) {
  const [pendingPoint, setPendingPoint] = useState<GoalTargetCoordinates | null>(null);

  useEffect(() => setPendingPoint(null), [value?.geometryVersion, value?.x, value?.y]);

  const select = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setPendingPoint(
      normalizeGoalTargetPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
      ),
    );
  };

  const confirm = (outcome: LiveThreatOutcome) => {
    if (!pendingPoint) return;
    onSelect(
      pendingPoint,
      outcome,
      outcome === "PARADA" ? deriveKeeperBodyZone(pendingPoint) : undefined,
    );
  };

  const point = pendingPoint ?? value ?? null;
  const suggestion = pendingPoint ? classifyGoalTarget(pendingPoint) : null;
  const insideFrame = pendingPoint ? isInsideGoalFrame(pendingPoint) : false;

  return (
    <div className="relative">
      <button
        type="button"
        onPointerUp={select}
        className={`relative block w-full touch-manipulation overflow-hidden rounded-2xl border border-sky-300/30 bg-slate-950 shadow-inner ${compact ? "aspect-[1.65/1]" : "aspect-[1.7/1] min-h-56"}`}
        aria-label="Portería CDA: toca destino del disparo rival"
      >
        <svg viewBox="0 0 100 64" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="goal-surface" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#081525" />
              <stop offset="1" stopColor="#123653" />
            </linearGradient>
            <linearGradient id="keeper-kit" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fbbf24" />
              <stop offset="1" stopColor="#f97316" />
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
          <g fill="none" stroke="url(#keeper-kit)" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="50" cy="25.5" r="3.2" fill="#fdba74" stroke="#fed7aa" strokeWidth="1" />
            <path d="M45.5 32 Q50 28 54.5 32 L55.5 42 Q50 45 44.5 42 Z" fill="url(#keeper-kit)" strokeWidth="1.5" />
            <path d="M45.5 33 L36 40 L28 36 M54.5 33 L64 40 L72 36" strokeWidth="3.2" />
            <path d="M46.5 42 L41 52 M53.5 42 L59 52" strokeWidth="4" />
            <circle cx="27.5" cy="35.8" r="2" fill="#f8fafc" stroke="#e2e8f0" />
            <circle cx="72.5" cy="35.8" r="2" fill="#f8fafc" stroke="#e2e8f0" />
          </g>
        </svg>
        {point && (
          <span
            className={`pointer-events-none absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_6px_rgba(255,255,255,0.2)] ${suggestion === "PARADA" ? "bg-sky-400" : suggestion === "FUERA" ? "bg-amber-400" : "bg-rose-500"}`}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          />
        )}
      </button>

      {pendingPoint && (
        <div className="absolute inset-x-2 bottom-2 z-20 rounded-xl border border-white/20 bg-slate-950/95 p-1.5 shadow-2xl">
          <p className="mb-1 text-center text-[9px] font-black uppercase tracking-wider text-slate-300">
            {insideFrame ? `Punto · ${deriveKeeperBodyZone(pendingPoint) === "UPPER" ? "arriba" : "abajo"}` : "Punto exterior"}
          </p>
          <div className={`grid gap-1 ${insideFrame ? "grid-cols-2" : "grid-cols-1"}`}>
            {insideFrame ? (
              <>
                <OutcomeButton label="⚽ GOL" suggested={suggestion === "GOL"} onClick={() => confirm("GOL")} />
                <OutcomeButton label="◉ PARADA" suggested={suggestion === "PARADA"} onClick={() => confirm("PARADA")} />
              </>
            ) : (
              <OutcomeButton label="↗ FUERA" suggested onClick={() => confirm("FUERA")} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OutcomeButton({ label, suggested, onClick }: { label: string; suggested: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-lg px-2 text-xs font-black ${suggested ? "bg-cyan-400 text-slate-950 ring-2 ring-white/70" : "bg-slate-800 text-white"}`}>
      {label}{suggested ? " · sugerido" : ""}
    </button>
  );
}

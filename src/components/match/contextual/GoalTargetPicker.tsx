"use client";

import { PointerEvent, useEffect, useState } from "react";
import {
  isInsideGoalFrame,
  KEEPER_BODY_HITBOXES,
  KEEPER_BODY_SURFACE,
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
  const choosingOutcome = Boolean(pendingPoint && insideFrame);

  return (
    <div className="relative mx-auto w-full" data-testid="goal-target-picker">
      <button
        type="button"
        onPointerUp={select}
        className={`relative block aspect-[25/16] w-full touch-manipulation overflow-hidden rounded-2xl border border-sky-300/30 bg-slate-950 shadow-inner ${compact ? "min-h-44" : ""}`}
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

      <KeeperBodyPicker
        interactive={choosingOutcome}
        onSelect={(part) => confirm("PARADA", part)}
      />

      {choosingOutcome && <>
        <span className="pointer-events-none absolute right-2 top-2 z-30 rounded-full border border-sky-200/40 bg-slate-950/90 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-sky-100">CUERPO = PARADA</span>
        <button type="button" onClick={() => confirm("GOL")} className="absolute bottom-2 left-2 z-30 min-h-14 min-w-28 rounded-xl border-2 border-rose-200 bg-rose-700 px-4 text-base font-black text-white shadow-2xl active:scale-95">⚽ GOL</button>
      </>}
    </div>
  );
}

const KEEPER_PART_LABELS: Record<KeeperBodyPart, string> = {
  HEAD: "Cabeza",
  TORSO: "Tronco",
  RIGHT_ARM_HAND: "Brazo y mano derecha",
  LEFT_ARM_HAND: "Brazo y mano izquierda",
  RIGHT_LEG_FOOT: "Pierna y pie derechos",
  LEFT_LEG_FOOT: "Pierna y pie izquierdos",
};

export function KeeperBodyPicker({ onSelect, interactive = true }: { onSelect: (part: KeeperBodyPart) => void; interactive?: boolean }) {
  return (
    <div
      className={`absolute z-20 ${interactive ? "" : "pointer-events-none"}`}
      style={{ left: `${KEEPER_BODY_SURFACE.left * 100}%`, top: `${KEEPER_BODY_SURFACE.top * 100}%`, width: `${KEEPER_BODY_SURFACE.width * 100}%`, height: `${KEEPER_BODY_SURFACE.height * 100}%` }}
      aria-label={interactive ? "Toca la zona del portero que realiza la parada" : undefined}
      data-testid="goalkeeper-silhouette"
    >
      <svg viewBox="0 0 100 100" className={`pointer-events-none absolute left-[10%] top-[14.5833%] h-[72.9167%] w-[80%] drop-shadow-[0_4px_8px_rgba(0,0,0,0.65)] ${interactive ? "opacity-100" : "opacity-80"}`} aria-hidden="true">
        <circle cx="50" cy="10" r="9" fill="#fed7aa" stroke="#fff7ed" strokeWidth="1.8" />
        <path d="M36 23 Q50 18 64 23 L66 52 Q50 58 34 52 Z" fill="#fb923c" stroke="#ffedd5" strokeWidth="1.8" />
        <path d="M36 28 L12 47 L4 42 M64 28 L88 47 L96 42" fill="none" stroke="#fb923c" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="4" cy="42" r="5" fill="#f8fafc" stroke="#bae6fd" strokeWidth="1.5" />
        <circle cx="96" cy="42" r="5" fill="#f8fafc" stroke="#bae6fd" strokeWidth="1.5" />
        <path d="M43 52 L30 90 L20 96 M57 52 L70 90 L80 96" fill="none" stroke="#f97316" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {interactive && Object.entries(KEEPER_BODY_HITBOXES).map(([part, hitbox]) => (
        <button
          key={part}
          type="button"
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onSelect(part as KeeperBodyPart); }}
          className="absolute rounded-xl border-2 border-transparent bg-cyan-300/[0.03] transition hover:border-white/70 hover:bg-cyan-300/30 active:border-white active:bg-cyan-300/40"
          style={{ left: `${hitbox.left * 100}%`, top: `${hitbox.top * 100}%`, width: `${hitbox.width * 100}%`, height: `${hitbox.height * 100}%` }}
          aria-label={`Parada con ${KEEPER_PART_LABELS[part as KeeperBodyPart]}`}
          data-body-part={part}
        />
      ))}
    </div>
  );
}

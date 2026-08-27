"use client";

import { PointerEvent } from "react";
import {
  classifyGoalTarget,
  deriveKeeperBodyZone,
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
  const select = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const point = normalizeGoalTargetPoint(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    const outcome = classifyGoalTarget(point);
    onSelect(
      point,
      outcome,
      outcome === "PARADA" ? deriveKeeperBodyZone(point) : undefined,
    );
  };

  return (
    <button
      type="button"
      onPointerUp={select}
      className={`relative block w-full touch-manipulation overflow-hidden rounded-xl bg-slate-950 ${compact ? "aspect-[1.65/1]" : "aspect-[1.7/1] min-h-52"}`}
      aria-label="Portería CDA: toca destino del disparo rival"
    >
      <svg viewBox="0 0 100 60" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <rect width="100" height="60" fill="#07111f" />
        <g stroke="#64748b" strokeWidth="0.55" opacity="0.5">
          {Array.from({ length: 9 }, (_, index) => 12 + index * 9.5).map((x) => <line key={`v-${x}`} x1={x} y1="8" x2={x} y2="53" />)}
          {Array.from({ length: 7 }, (_, index) => 8 + index * 7.5).map((y) => <line key={`h-${y}`} x1="12" y1={y} x2="88" y2={y} />)}
        </g>
        <path d="M12 49V8H88V49" fill="none" stroke="white" strokeWidth="2.2" />
        <path d="M12 49H88" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="2 2" />
        <g fill="#f8fafc" opacity="0.9">
          <circle cx="50" cy="18.5" r="4" />
          <path d="M43 26 Q50 22 57 26 L59 39 L55 40 L54 31 L53 48 H48 L47 35 L45 48 H40 L43 30 L38 38 L34 35 Z" />
        </g>
      </svg>
      <span className="pointer-events-none absolute left-[12%] top-[14%] h-[68%] w-[76%] border border-cyan-300/25" />
      {value && (
        <span
          className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.25)]"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
        />
      )}
    </button>
  );
}

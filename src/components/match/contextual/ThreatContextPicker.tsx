"use client";

import { LiveInteractionState } from "../../../lib/liveInteraction";
import { LiveThreatOutcome, LiveThreatPhase } from "../../../types";
import { ContextualSurface } from "./ContextualSurface";

type PendingThreat = Extract<LiveInteractionState, { kind: "THREAT_PENDING" }>;

interface ThreatContextPickerProps {
  threat: PendingThreat;
  onOutcome: (outcome: LiveThreatOutcome) => void;
  onPhase: (phase: LiveThreatPhase) => void;
  onCancel: () => void;
}

const OUTCOMES: Array<{
  value: LiveThreatOutcome;
  label: string;
  icon: string;
  className: string;
}> = [
  {
    value: "GOL",
    label: "Gol",
    icon: "⚽",
    className: "border-emerald-300 bg-emerald-600 hover:bg-emerald-500",
  },
  {
    value: "PARADA",
    label: "Parada",
    icon: "🧤",
    className: "border-sky-300 bg-sky-600 hover:bg-sky-500",
  },
  {
    value: "FUERA",
    label: "Fuera",
    icon: "↗",
    className: "border-slate-400 bg-slate-700 hover:bg-slate-600",
  },
];

const PHASES: Array<{
  value: LiveThreatPhase;
  label: string;
  shortLabel: string;
  icon: string;
  tier: "PRIMARY" | "SECONDARY" | "RARE";
}> = [
  { value: "POSITIONAL", label: "Posicional", shortLabel: "POS.", icon: "▦", tier: "PRIMARY" },
  { value: "TRANSITION", label: "Transición", shortLabel: "TRANS.", icon: "➜", tier: "PRIMARY" },
  { value: "SET_PIECE_KICK_IN", label: "Banda", shortLabel: "BANDA", icon: "↥", tier: "SECONDARY" },
  { value: "SET_PIECE_CORNER", label: "Córner", shortLabel: "CÓRNER", icon: "⌜", tier: "SECONDARY" },
  { value: "SET_PIECE_FREE_KICK", label: "Falta / ABP", shortLabel: "ABP", icon: "●↗", tier: "SECONDARY" },
  { value: "FLYING_GOALKEEPER", label: "Portero-jugador", shortLabel: "P-J", icon: "◇⁺", tier: "SECONDARY" },
  { value: "PENALTY", label: "Penalti", shortLabel: "6 m", icon: "●", tier: "RARE" },
  { value: "DOUBLE_PENALTY", label: "Doble penalti", shortLabel: "10 m", icon: "●", tier: "RARE" },
];

export function ThreatContextPicker({
  threat,
  onOutcome,
  onPhase,
  onCancel,
}: ThreatContextPickerProps) {
  return (
    <ContextualSurface
      anchor={threat.origin}
      label={threat.step === "OUTCOME" ? "Consecuencia de la amenaza" : "Fase de la amenaza"}
      onCancel={onCancel}
    >
      <div className="mb-2 flex items-center gap-1.5" aria-label={`Paso ${threat.step === "OUTCOME" ? 1 : 2} de 2`}>
        <span className="h-1.5 flex-1 rounded-full bg-cyan-400" />
        <span className={`h-1.5 flex-1 rounded-full ${threat.step === "PHASE" ? "bg-cyan-400" : "bg-slate-700"}`} />
      </div>

      {threat.step === "OUTCOME" ? (
        <div className="grid grid-cols-3 gap-2">
          {OUTCOMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onOutcome(option.value)}
              className={`flex min-h-20 flex-col items-center justify-center rounded-xl border-2 px-1 text-white shadow-lg ${option.className}`}
              aria-label={option.label}
            >
              <span className="text-3xl font-black leading-none" aria-hidden="true">
                {option.icon}
              </span>
              <span className="mt-1 text-[11px] font-black uppercase tracking-wide">
                {option.label}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            {PHASES.filter((phase) => phase.tier === "PRIMARY").map((phase) => (
              <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {PHASES.filter((phase) => phase.tier === "SECONDARY").map((phase) => (
              <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PHASES.filter((phase) => phase.tier === "RARE").map((phase) => (
              <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} />
            ))}
          </div>
        </div>
      )}
    </ContextualSurface>
  );
}

function PhaseButton({
  phase,
  onPhase,
}: {
  phase: (typeof PHASES)[number];
  onPhase: (phase: LiveThreatPhase) => void;
}) {
  const primary = phase.tier === "PRIMARY";
  const rare = phase.tier === "RARE";
  return (
    <button
      type="button"
      onClick={() => onPhase(phase.value)}
      title={phase.label}
      aria-label={phase.label}
      className={`flex flex-col items-center justify-center rounded-xl border font-black transition-colors ${
        primary
          ? "min-h-16 border-cyan-600 bg-cyan-950/80 text-cyan-100 hover:bg-cyan-800"
          : rare
            ? "min-h-10 border-amber-900 bg-amber-950/60 px-2 text-amber-200 hover:border-amber-500"
            : "min-h-12 border-violet-800 bg-violet-950/70 px-1 text-violet-100 hover:border-violet-400"
      }`}
    >
      <span className={primary ? "text-2xl leading-none" : "text-base leading-none"} aria-hidden="true">
        {phase.icon}
      </span>
      <span className={`${primary ? "mt-1 text-[11px]" : "mt-1 text-[9px]"} leading-none`}>
        {phase.shortLabel}
      </span>
    </button>
  );
}

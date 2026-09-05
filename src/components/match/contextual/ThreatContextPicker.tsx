"use client";

import { LiveInteractionState } from "../../../lib/liveInteraction";
import { GoalAssist, LiveThreatOutcome, LiveThreatPhase, Player } from "../../../types";
import { PlayerAvatar } from "../../player/PlayerAvatar";
import { ContextualSurface } from "./ContextualSurface";

type PendingThreat = Extract<LiveInteractionState, { kind: "THREAT_PENDING" }>;

interface ThreatContextPickerProps {
  threat: PendingThreat;
  onOutcome: (outcome: LiveThreatOutcome) => void;
  onPhase: (phase: LiveThreatPhase) => void;
  players: Player[];
  assistCandidateIds: string[];
  onAssist: (assist: GoalAssist) => void;
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

export const PHASES: Array<{
  value: LiveThreatPhase;
  label: string;
  shortLabel: string;
  icon: string;
  tier: "PRIMARY" | "SECONDARY" | "RARE";
}> = [
  { value: "POSITIONAL", label: "Posicional", shortLabel: "POS.", icon: "▦", tier: "PRIMARY" },
  { value: "TRANSITION", label: "Transición", shortLabel: "TRANS.", icon: "➜", tier: "PRIMARY" },
  { value: "SET_PIECE_KICK_IN", label: "Banda cercana", shortLabel: "BANDA", icon: "↥", tier: "SECONDARY" },
  { value: "SET_PIECE_CORNER", label: "Córner", shortLabel: "CÓRNER", icon: "⌜", tier: "SECONDARY" },
  { value: "SET_PIECE_FREE_KICK", label: "Falta", shortLabel: "FALTA", icon: "●↗", tier: "SECONDARY" },
  { value: "FLYING_GOALKEEPER", label: "Portero-jugador", shortLabel: "P-J", icon: "◇⁺", tier: "SECONDARY" },
  { value: "PENALTY", label: "Penalti", shortLabel: "6 m", icon: "●", tier: "RARE" },
  { value: "DOUBLE_PENALTY", label: "Doble penalti", shortLabel: "10 m", icon: "●", tier: "RARE" },
];

export function ThreatContextPicker({
  threat,
  onOutcome,
  onPhase,
  players,
  assistCandidateIds,
  onAssist,
  onCancel,
}: ThreatContextPickerProps) {
  return (
    <ContextualSurface
      anchor={threat.origin}
      label={threat.step === "OUTCOME" ? "Consecuencia de la amenaza" : threat.step === "PHASE" ? "Fase de la amenaza" : "Asistencia"}
      onCancel={onCancel}
      immersive={threat.step === "PHASE"}
    >
      <div className="mb-2 flex items-center gap-1.5" aria-label={`Paso ${threat.step === "OUTCOME" ? 1 : threat.step === "PHASE" ? 2 : 3} de ${threat.side === "FOR" && threat.outcome === "GOL" ? 3 : 2}`}>
        <span className="h-1.5 flex-1 rounded-full bg-cyan-400" />
        <span className={`h-1.5 flex-1 rounded-full ${threat.step !== "OUTCOME" ? "bg-cyan-400" : "bg-slate-700"}`} />
        {threat.side === "FOR" && threat.outcome === "GOL" && (
          <span className={`h-1.5 flex-1 rounded-full ${threat.step === "ASSIST" ? "bg-cyan-400" : "bg-slate-700"}`} />
        )}
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
      ) : threat.step === "PHASE" ? (
        <PhasePicker onPhase={onPhase} immersive />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {assistCandidateIds.map((playerId) => {
            const player = players.find((candidate) => candidate.id === playerId);
            if (!player) return null;
            return (
              <button
                key={player.id}
                type="button"
                onClick={() => onAssist({ status: "PLAYER", playerId: player.id })}
                className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-cyan-700 bg-cyan-950/80 px-1"
              >
                <PlayerAvatar player={player} compact />
                <span className="mt-1 max-w-full truncate text-[10px] font-bold">{player.name}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => onAssist({ status: "NONE" })} className="min-h-20 rounded-xl border border-slate-600 bg-slate-800 text-xs font-black">∅<span className="mt-1 block text-[9px]">SIN ASIST.</span></button>
          <button type="button" onClick={() => onAssist({ status: "PENDING" })} className="min-h-20 rounded-xl border border-amber-500 bg-amber-950 text-2xl font-black text-amber-200">?<span className="mt-1 block text-[9px]">PENDIENTE</span></button>
        </div>
      )}
    </ContextualSurface>
  );
}

export function PhasePicker({
  onPhase,
  selected,
  immersive = false,
}: {
  onPhase: (phase: LiveThreatPhase) => void;
  selected?: LiveThreatPhase;
  immersive?: boolean;
}) {
  if (immersive) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-5xl flex-col justify-center gap-3 p-2">
        <p className="text-center text-sm font-black uppercase tracking-[.25em] text-cyan-200">FASE</p>
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-3">
          {PHASES.filter((phase) => phase.tier !== "RARE").map((phase) => (
            <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} selected={selected === phase.value} immersive />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PHASES.filter((phase) => phase.tier === "RARE").map((phase) => (
            <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} selected={selected === phase.value} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        {PHASES.filter((phase) => phase.tier === "PRIMARY").map((phase) => (
          <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} selected={selected === phase.value} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {PHASES.filter((phase) => phase.tier === "SECONDARY").map((phase) => (
          <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} selected={selected === phase.value} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {PHASES.filter((phase) => phase.tier === "RARE").map((phase) => (
          <PhaseButton key={phase.value} phase={phase} onPhase={onPhase} selected={selected === phase.value} />
        ))}
      </div>
    </div>
  );
}

function PhaseButton({
  phase,
  onPhase,
  selected = false,
  immersive = false,
}: {
  phase: (typeof PHASES)[number];
  onPhase: (phase: LiveThreatPhase) => void;
  selected?: boolean;
  immersive?: boolean;
}) {
  const primary = phase.tier === "PRIMARY";
  const rare = phase.tier === "RARE";
  return (
    <button
      type="button"
      onClick={() => onPhase(phase.value)}
      title={phase.label}
      aria-label={phase.label}
      className={`flex flex-col items-center justify-center rounded-xl border font-black transition-colors active:scale-[.98] ${selected ? "ring-2 ring-white" : ""} ${
        immersive
          ? "min-h-28 border-cyan-600 bg-slate-900 text-white"
          : primary
          ? "min-h-16 border-cyan-600 bg-cyan-950/80 text-cyan-100 hover:bg-cyan-800"
          : rare
            ? "min-h-10 border-amber-900 bg-amber-950/60 px-2 text-amber-200 hover:border-amber-500"
            : "min-h-12 border-violet-800 bg-violet-950/70 px-1 text-violet-100 hover:border-violet-400"
      }`}
    >
      <span className={immersive ? "text-5xl leading-none" : primary ? "text-2xl leading-none" : "text-base leading-none"} aria-hidden="true">
        {phase.icon}
      </span>
      <span className={`${immersive ? "mt-3 text-lg" : primary ? "mt-1 text-[11px]" : "mt-1 text-[9px]"} leading-none`}>
        {immersive ? phase.label.toUpperCase() : phase.shortLabel}
      </span>
    </button>
  );
}

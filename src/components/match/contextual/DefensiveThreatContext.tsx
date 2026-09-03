"use client";

import { LiveInteractionState } from "../../../lib/liveInteraction";
import { GoalTargetCoordinates, KeeperBodyPart, LiveThreatPhase, SaveOutcome } from "../../../types";
import { ContextualSurface } from "./ContextualSurface";
import { GoalTargetPicker, KeeperBodyPicker } from "./GoalTargetPicker";
import { PhasePicker } from "./ThreatContextPicker";

type DefensiveThreat = Extract<
  LiveInteractionState,
  { kind: "THREAT_PENDING" }
>;

export function DefensiveThreatContext({
  threat,
  onTarget,
  onDefensiveOutcome,
  onBodyPart,
  onSaveOutcome,
  onPhase,
  onCancel,
}: {
  threat: DefensiveThreat;
  onTarget: (point: GoalTargetCoordinates) => void;
  onDefensiveOutcome: (outcome: "GOL" | "PARADA") => void;
  onBodyPart: (bodyPart: KeeperBodyPart) => void;
  onSaveOutcome: (outcome: SaveOutcome) => void;
  onPhase: (phase: LiveThreatPhase) => void;
  onCancel: () => void;
}) {
  return (
    <ContextualSurface
      anchor={{ x: 0.5, y: 0.5 }}
      label="Portería defensiva"
      onCancel={onCancel}
      viewportOnMobile
      wide
      immersive={threat.step === "GOAL_TARGET" || threat.step === "KEEPER_BODY_PART"}
    >
      {threat.step === "GOAL_TARGET" && (
        <div>
          <StepLabel step="1" label="DESTINO" />
          <GoalTargetPicker value={threat.goalTarget} onSelect={onTarget} />
        </div>
      )}
      {threat.step === "GOAL_RESULT" && (
        <div>
          <StepLabel step="2" label="RESULTADO" />
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => onDefensiveOutcome("GOL")} className="min-h-24 rounded-2xl border-2 border-rose-300 bg-rose-700 text-xl font-black text-white active:scale-95">⚽ GOL</button>
            <button type="button" onClick={() => onDefensiveOutcome("PARADA")} className="min-h-24 rounded-2xl border-2 border-sky-300 bg-sky-800 text-xl font-black text-white active:scale-95">🧤 PARADA</button>
          </div>
        </div>
      )}
      {threat.step === "KEEPER_BODY_PART" && (
        <div>
          <StepLabel step="3" label="PARTE DEL CUERPO" />
          <KeeperBodyPicker target={threat.goalTarget} onSelect={onBodyPart} />
        </div>
      )}
      {threat.step === "DETAILS" && (
        <div>
          <StepLabel step="4" label="DESENLACE" />
          <div className="grid grid-cols-3 gap-2">
            <SaveButton icon="⬤" label="BLOCAJE" onClick={() => onSaveOutcome("CATCH")} />
            <SaveButton icon="↺" label="RECHACE" onClick={() => onSaveOutcome("REBOUND")} />
            <SaveButton icon="↗" label="DESPEJE" onClick={() => onSaveOutcome("CLEARANCE")} />
          </div>
        </div>
      )}
      {threat.step === "PHASE" && (
        <PhasePicker onPhase={onPhase} />
      )}
    </ContextualSurface>
  );
}

function StepLabel({ step, label }: { step: string; label: string }) {
  return <p className="mb-2 pr-12 text-center text-xs font-black uppercase tracking-widest text-rose-200">{step} · {label}</p>;
}

function SaveButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-sky-500 bg-sky-950 font-black text-sky-100">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <span className="mt-2 text-[10px]">{label}</span>
    </button>
  );
}

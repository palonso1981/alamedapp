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
      immersive={threat.step === "GOAL_TARGET" || threat.step === "GOAL_RESULT" || threat.step === "PHASE"}
    >
      {threat.step === "GOAL_TARGET" && (
        <div>
          <StepLabel step="1" label="DESTINO" />
          <GoalTargetPicker value={threat.goalTarget} onSelect={onTarget} />
        </div>
      )}
      {threat.step === "GOAL_RESULT" && (
        <div className="grid gap-4 md:grid-cols-[1.3fr_.7fr]">
          <div>
            <StepLabel step="2" label="CUERPO · OPCIONAL" />
            <KeeperBodyPicker target={threat.goalTarget} selected={threat.keeperBodyPart} onSelect={onBodyPart} />
            <p className={`mt-2 text-center text-xs font-black ${threat.keeperBodyPart ? "text-cyan-200" : "text-slate-500"}`}>{threat.keeperBodyPart ? "✓ CUERPO MARCADO" : "SIN SELECCIÓN"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
            <button type="button" onClick={() => onDefensiveOutcome("GOL")} className="min-h-24 rounded-2xl border-2 border-rose-200 bg-rose-600 text-2xl font-black text-white shadow-lg active:scale-95">⚽ GOL</button>
            <SaveButton icon="⬤" label="BLOCAJE" onClick={() => onSaveOutcome("CATCH")} />
            <SaveButton icon="↗" label="DESPEJE" onClick={() => onSaveOutcome("CLEARANCE")} />
            <SaveButton icon="↺" label="RECHACE" onClick={() => onSaveOutcome("REBOUND")} />
          </div>
        </div>
      )}
      {threat.step === "PHASE" && (
        <PhasePicker onPhase={onPhase} immersive />
      )}
    </ContextualSurface>
  );
}

function StepLabel({ step, label }: { step: string; label: string }) {
  return <p className="mb-2 pr-12 text-center text-xs font-black uppercase tracking-widest text-rose-200">{step} · {label}</p>;
}

function SaveButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 flex-col items-center justify-center rounded-2xl border-2 border-sky-400 bg-sky-950 font-black text-sky-100 shadow-lg active:scale-95">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <span className="mt-2 text-[10px]">{label}</span>
    </button>
  );
}

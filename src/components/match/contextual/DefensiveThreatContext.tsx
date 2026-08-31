"use client";

import { LiveInteractionState } from "../../../lib/liveInteraction";
import {
  GoalTargetCoordinates,
  KeeperBodyPart,
  LiveThreatOutcome,
  LiveThreatPhase,
  SaveOutcome,
} from "../../../types";
import { ContextualSurface } from "./ContextualSurface";
import { GoalTargetPicker } from "./GoalTargetPicker";
import { PhasePicker } from "./ThreatContextPicker";

type DefensiveThreat = Extract<
  LiveInteractionState,
  { kind: "THREAT_PENDING" }
>;

export function DefensiveThreatContext({
  threat,
  onTarget,
  onSaveOutcome,
  onPhase,
  onCancel,
}: {
  threat: DefensiveThreat;
  onTarget: (
    point: GoalTargetCoordinates,
    outcome: LiveThreatOutcome,
    bodyPart?: KeeperBodyPart,
  ) => void;
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
    >
      {threat.step === "GOAL_TARGET" && (
        <div>
          <p className="mb-2 text-center text-xs font-black uppercase tracking-widest text-rose-200">↓ destino</p>
          <GoalTargetPicker value={threat.goalTarget} onSelect={onTarget} />
        </div>
      )}
      {threat.step === "DETAILS" && (
        <div className="grid grid-cols-3 gap-2">
          <SaveButton icon="⬤" label="BLOCAJE" onClick={() => onSaveOutcome("CATCH")} />
          <SaveButton icon="↺" label="RECHACE" onClick={() => onSaveOutcome("REBOUND")} />
          <SaveButton icon="↗" label="DESPEJE" onClick={() => onSaveOutcome("CLEARANCE")} />
        </div>
      )}
      {threat.step === "PHASE" && (
        <PhasePicker onPhase={onPhase} />
      )}
    </ContextualSurface>
  );
}

function SaveButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-sky-500 bg-sky-950 font-black text-sky-100">
      <span className="text-3xl" aria-hidden="true">{icon}</span>
      <span className="mt-2 text-[10px]">{label}</span>
    </button>
  );
}

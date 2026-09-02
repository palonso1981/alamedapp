"use client";

import { DisciplineTeamSummary, Score } from "../../types";

export type DisciplineFocusKind = "FOUL" | "CARD";
export type DisciplineFocusSide = "FOR" | "AGAINST";

interface MatchScoreboardProps {
  score: Score;
  period: number;
  periodFor: DisciplineTeamSummary;
  periodAgainst: DisciplineTeamSummary;
  totalFor: DisciplineTeamSummary;
  totalAgainst: DisciplineTeamSummary;
  foulThresholds?: readonly number[];
  onInspect: (side: DisciplineFocusSide, kind: DisciplineFocusKind) => void;
  onGenericFoul: (side: DisciplineFocusSide) => void;
  confirmFoulSide?: DisciplineFocusSide | null;
  onRivalYellow: () => void;
  onRivalRed: () => void;
}

export function MatchScoreboard({
  score,
  period,
  periodFor,
  periodAgainst,
  totalFor,
  totalAgainst,
  foulThresholds = [],
  onInspect,
  onGenericFoul,
  confirmFoulSide,
  onRivalYellow,
  onRivalRed,
}: MatchScoreboardProps) {
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-inner"
      aria-label={`CD Alameda ${score.for}, Rival ${score.against}. Faltas P${period}: ${periodFor.fouls}-${periodAgainst.fouls}`}
    >
      <TeamDiscipline
        label="CDA"
        side="FOR"
        period={period}
        periodDiscipline={periodFor}
        totalDiscipline={totalFor}
        foulThresholds={foulThresholds}
        onInspect={onInspect}
        onGenericFoul={onGenericFoul}
        confirmingFoul={confirmFoulSide === "FOR"}
      />
      <div className="grid min-w-[4.75rem] place-items-center border-x border-slate-700 bg-slate-900 px-2 font-mono text-3xl font-black tabular-nums text-white sm:min-w-24 sm:text-4xl">
        {score.for}–{score.against}
      </div>
      <TeamDiscipline
        label="RIV"
        side="AGAINST"
        period={period}
        periodDiscipline={periodAgainst}
        totalDiscipline={totalAgainst}
        foulThresholds={foulThresholds}
        onInspect={onInspect}
        onGenericFoul={onGenericFoul}
        confirmingFoul={confirmFoulSide === "AGAINST"}
        onYellow={onRivalYellow}
        onRed={onRivalRed}
      />
    </div>
  );
}

function TeamDiscipline({ label, side, period, periodDiscipline, totalDiscipline, foulThresholds, onInspect, onGenericFoul, confirmingFoul, onYellow, onRed }: {
  label: string;
  side: DisciplineFocusSide;
  period: number;
  periodDiscipline: DisciplineTeamSummary;
  totalDiscipline: DisciplineTeamSummary;
  foulThresholds: readonly number[];
  onInspect: (side: DisciplineFocusSide, kind: DisciplineFocusKind) => void;
  onGenericFoul: (side: DisciplineFocusSide) => void;
  confirmingFoul: boolean;
  onYellow?: () => void;
  onRed?: () => void;
}) {
  const nextThreshold = [...foulThresholds].sort((a, b) => a - b).find((value) => value >= periodDiscipline.fouls);
  const thresholdReached = foulThresholds.includes(periodDiscipline.fouls);
  const nearThreshold = nextThreshold !== undefined && periodDiscipline.fouls >= nextThreshold - 1;
  return (
    <div className="min-w-0 px-1.5 py-1 sm:px-2" aria-label={`Disciplina ${label}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`text-[10px] font-black tracking-wider ${side === "FOR" ? "text-cyan-300" : "text-rose-300"}`}>{label}</span>
        <button type="button" onClick={() => onInspect(side, "CARD")} className="grid min-h-9 min-w-9 place-items-center rounded-md text-xs text-slate-500 sm:min-h-11 sm:min-w-11" aria-label={`Revisar disciplina ${label}`}>↗</button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onInspect(side, "FOUL")} className={`min-h-10 min-w-11 rounded-lg border px-1 font-mono text-xl font-black sm:min-h-12 sm:min-w-12 ${thresholdReached ? "border-red-300 bg-red-600 text-white" : nearThreshold ? "border-amber-300 bg-amber-950 text-amber-100" : "border-slate-700 bg-slate-900 text-orange-200"}`} aria-label={`Faltas ${label} del periodo ${period}: ${periodDiscipline.fouls}`}>
          F{periodDiscipline.fouls}
        </button>
        <button type="button" onClick={() => onGenericFoul(side)} className={`grid min-h-10 min-w-10 place-items-center rounded-lg border text-lg font-black sm:min-h-12 sm:min-w-12 ${confirmingFoul ? "border-emerald-200 bg-emerald-500 text-slate-950" : "border-slate-700 bg-slate-900 text-orange-200"}`} aria-label={confirmingFoul ? `Confirmar falta ${label} sin jugador` : `Añadir falta ${label} sin jugador`}>
          {confirmingFoul ? "✓" : "+"}
        </button>
        <CardCounter color="YELLOW" count={totalDiscipline.yellowCards} onClick={onYellow ?? (() => onInspect(side, "CARD"))} add={Boolean(onYellow)} label={label} />
        <CardCounter color="RED" count={totalDiscipline.redCards} onClick={onRed ?? (() => onInspect(side, "CARD"))} add={Boolean(onRed)} label={label} />
      </div>
    </div>
  );
}

function CardCounter({ color, count, onClick, add, label }: { color: "YELLOW" | "RED"; count: number; onClick: () => void; add: boolean; label: string }) {
  const yellow = color === "YELLOW";
  return (
    <button type="button" onClick={onClick} className={`relative flex min-h-10 min-w-9 items-center justify-center gap-1 rounded-lg sm:min-h-12 sm:min-w-11 ${yellow ? "bg-yellow-950/60 text-yellow-100" : "bg-red-950/60 text-red-100"}`} aria-label={`${add ? "Añadir" : "Revisar"} tarjeta ${yellow ? "amarilla" : "roja"} ${label}`}>
      <span className={`h-5 w-3 rotate-3 rounded-sm border ${yellow ? "border-yellow-100 bg-yellow-400" : "border-red-100 bg-red-500"}`} aria-hidden="true" />
      <span className="text-[10px] font-black">{count}</span>
      {add && <span className="absolute -right-0.5 -top-1 text-[10px] font-black text-white">+</span>}
    </button>
  );
}

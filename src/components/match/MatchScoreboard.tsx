import { Score } from "../../types";

export function MatchScoreboard({ score }: { score: Score }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 shadow-inner"
      aria-label={`CD Alameda ${score.for}, Rival ${score.against}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
        CDA
      </span>
      <span className="min-w-16 text-center font-mono text-3xl font-black tabular-nums text-white">
        {score.for}–{score.against}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
        RIV
      </span>
    </div>
  );
}

import { Player, PlayerMinutes } from "../../types";
import { PlayerAvatar } from "../player/PlayerAvatar";

interface BenchPanelProps {
  players: Player[];
  playerMinutes: Record<string, PlayerMinutes>;
  replacementForLabel?: string;
  onPlayerTap: (playerId: string) => void;
}

export function BenchPanel({
  players,
  playerMinutes,
  replacementForLabel,
  onPlayerTap,
}: BenchPanelProps) {
  return (
    <section className="h-full rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-xl">
      <div className="mb-3 flex min-h-10 items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            Banquillo
          </h2>
          {replacementForLabel ? (
            <span className="text-xs font-bold text-amber-300">
              ↔ {replacementForLabel}
            </span>
          ) : (
            <span className="text-lg text-slate-700" aria-hidden="true">
              ⇄
            </span>
          )}
        </div>
        <span className="rounded-full bg-slate-950 px-2 py-1 text-xs text-slate-500">
          {players.length}
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-1 lg:overflow-y-auto lg:overflow-x-hidden">
        {players.map((player) => {
          const minutes = playerMinutes[player.id];
          return (
            <button
              key={player.id}
              type="button"
              onClick={() => onPlayerTap(player.id)}
              className={`min-h-20 min-w-36 rounded-xl border-2 p-2 text-left transition-all lg:min-w-0 ${
                replacementForLabel
                  ? "border-amber-400 bg-amber-950/40 shadow-[0_0_18px_rgba(251,191,36,0.12)] hover:bg-amber-900/50"
                  : "border-slate-700 bg-slate-800 hover:border-slate-500"
              }`}
              aria-label={
                replacementForLabel
                  ? `${player.name} entra por ${replacementForLabel}`
                  : `${player.name}, banquillo`
              }
            >
              <span className="flex items-center gap-3">
                <PlayerAvatar player={player} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">
                    {player.name}
                  </span>
                  <span
                    className="mt-1 block text-xs font-bold text-cyan-300"
                    aria-label={`${minutes?.totalMinutes ?? 0} minutos acumulados`}
                    title="Acumulado"
                  >
                    {minutes?.totalMinutes ?? 0}&apos;
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

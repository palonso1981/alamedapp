import { Player, PlayerMinutes } from "../../types";
import { PlayerAvatar } from "../player/PlayerAvatar";
import { PlayerContextActions } from "./contextual/PlayerContextActions";

interface BenchPanelProps {
  players: Player[];
  playerMinutes: Record<string, PlayerMinutes>;
  replacementForLabel?: string;
  selectedPlayerId?: string;
  onPlayerTap: (playerId: string) => void;
  onYellow: (playerId: string) => void;
  onRed: (playerId: string) => void;
  onCancel: () => void;
}

export function BenchPanel({
  players,
  playerMinutes,
  replacementForLabel,
  selectedPlayerId,
  onPlayerTap,
  onYellow,
  onRed,
  onCancel,
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
          const selected = selectedPlayerId === player.id;
          return (
            <div key={player.id} className="min-w-36 lg:min-w-0">
              <button
                type="button"
                onClick={() => onPlayerTap(player.id)}
                className={`min-h-20 w-full rounded-xl border-2 p-2 text-left transition-all ${
                  replacementForLabel
                    ? "border-amber-400 bg-amber-950/40 shadow-[0_0_18px_rgba(251,191,36,0.12)] hover:bg-amber-900/50"
                    : selected
                      ? "border-cyan-300 bg-cyan-950/70 ring-2 ring-cyan-300/20"
                      : "border-slate-700 bg-slate-800 hover:border-slate-500"
                }`}
                aria-pressed={selected}
                aria-label={
                  replacementForLabel
                    ? `${player.name} entra por ${replacementForLabel}`
                    : `${player.name}, banquillo`
                }
              >
                <span className="flex items-center gap-3">
                  <PlayerAvatar player={player} selected={selected} />
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
              {selected && !replacementForLabel && (
                <div className="mt-1 rounded-xl border border-slate-700 bg-slate-950 p-1.5">
                  <PlayerContextActions
                    location="BENCH"
                    showCancel
                    onFoulCommitted={() => undefined}
                    onFoulReceived={() => undefined}
                    onYellow={() => onYellow(player.id)}
                    onRed={() => onRed(player.id)}
                    onRedOnly={() => undefined}
                    onRedWithInferiority={() => undefined}
                    onBack={() => undefined}
                    onCancel={onCancel}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";

import { Player } from "../../types";
import { PlayerAvatar } from "../player/PlayerAvatar";

interface SecondPeriodLineupDialogProps {
  players: Player[];
  proposedPlayerIds: string[];
  proposedGoalkeeperId?: string;
  dismissedPlayerIds?: string[];
  onCancel: () => void;
  onConfirm: (playerIds: string[], goalkeeperPlayerId: string) => void;
}

export function SecondPeriodLineupDialog({
  players,
  proposedPlayerIds,
  proposedGoalkeeperId,
  dismissedPlayerIds = [],
  onCancel,
  onConfirm,
}: SecondPeriodLineupDialogProps) {
  const [selectedIds, setSelectedIds] = useState(() =>
    Array.from(new Set(proposedPlayerIds)).slice(0, 5),
  );
  const [goalkeeperId, setGoalkeeperId] = useState<string | null>(() =>
    proposedGoalkeeperId && proposedPlayerIds.includes(proposedGoalkeeperId)
      ? proposedGoalkeeperId
      : null,
  );
  const dismissed = new Set(dismissedPlayerIds);
  const ready = selectedIds.length === 5 && Boolean(goalkeeperId);

  const togglePlayer = (playerId: string) => {
    if (dismissed.has(playerId)) return;
    const selected = selectedIds.includes(playerId);
    if (selected && goalkeeperId === playerId) setGoalkeeperId(null);
    setSelectedIds((current) => {
      if (current.includes(playerId)) {
        return current.filter((id) => id !== playerId);
      }
      return current.length < 5 ? [...current, playerId] : current;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/85 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Configurar quinteto inicial de la segunda parte"
    >
      <section className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-300/50 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div>
            <p className="text-xs font-black tracking-[0.2em] text-cyan-300">P2 · 20:00</p>
            <h2 className="text-lg font-black text-white">Quinteto inicial</h2>
          </div>
          <div className={`rounded-xl px-3 py-2 text-lg font-black ${ready ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-amber-300"}`}>
            {selectedIds.length}/5 {goalkeeperId ? "· ◉" : "· ○"}
          </div>
        </header>

        <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto p-3 sm:grid-cols-6 sm:overflow-visible">
          {players.map((player) => {
            const selected = selectedIds.includes(player.id);
            const goalkeeper = goalkeeperId === player.id;
            const unavailable = dismissed.has(player.id);
            return (
              <div
                key={player.id}
                className={`relative rounded-xl border p-1.5 ${
                  unavailable
                    ? "border-red-950 bg-slate-950 opacity-35"
                    : goalkeeper
                      ? "border-emerald-300 bg-emerald-950 ring-2 ring-emerald-400/25"
                      : selected
                        ? "border-cyan-300 bg-cyan-950"
                        : "border-slate-700 bg-slate-950"
                }`}
              >
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => togglePlayer(player.id)}
                  className="grid min-h-20 w-full place-items-center rounded-lg px-1 py-1 disabled:cursor-not-allowed"
                  aria-pressed={selected}
                  aria-label={`${selected ? "Quitar" : "Añadir"} a ${player.name} del quinteto inicial de P2`}
                >
                  <PlayerAvatar player={player} selected={selected} compact />
                  <span className="mt-1 max-w-full truncate text-[11px] font-black">{player.name}</span>
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => setGoalkeeperId(player.id)}
                    className={`min-h-9 w-full rounded-lg text-sm font-black ${goalkeeper ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}
                    aria-pressed={goalkeeper}
                    aria-label={`Elegir a ${player.name} como portero funcional de P2`}
                  >
                    {goalkeeper ? "◉" : "○"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <footer className="grid grid-cols-[0.7fr_1.3fr] gap-2 border-t border-slate-700 p-3">
          <button type="button" onClick={onCancel} className="min-h-12 rounded-xl bg-slate-800 font-black text-slate-300">
            ×
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => goalkeeperId && onConfirm(selectedIds, goalkeeperId)}
            className="min-h-12 rounded-xl bg-cyan-400 font-black text-slate-950 disabled:bg-slate-800 disabled:text-slate-500"
          >
            ▶ INICIAR P2
          </button>
        </footer>
      </section>
    </div>
  );
}

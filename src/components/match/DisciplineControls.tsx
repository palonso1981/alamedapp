"use client";

import { useMemo, useState } from "react";

import { CardColor, DisciplineSummary, Player } from "../../types";
import { PlayerAvatar } from "../player/PlayerAvatar";

interface DisciplineControlsProps {
  players: Player[];
  onCourtPlayerIds: string[];
  dismissedPlayerIds: string[];
  discipline: DisciplineSummary;
  onFoul: (side: "FOR" | "AGAINST") => void;
  onCard: (
    side: "FOR" | "AGAINST",
    color: CardColor,
    playerId?: string,
  ) => void;
}

export function DisciplineControls({
  players,
  onCourtPlayerIds,
  dismissedPlayerIds,
  discipline,
  onFoul,
  onCard,
}: DisciplineControlsProps) {
  const [pendingOwnCard, setPendingOwnCard] = useState<CardColor | null>(null);
  const candidates = useMemo(
    () =>
      players.filter(
        (player) =>
          !dismissedPlayerIds.includes(player.id) &&
          (pendingOwnCard !== "RED" || onCourtPlayerIds.includes(player.id)),
      ),
    [dismissedPlayerIds, onCourtPlayerIds, pendingOwnCard, players],
  );

  return (
    <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Disciplina
        </h3>
        <div className="flex gap-3 font-mono text-[10px] text-gray-500">
          <span>
            CDA {discipline.for.fouls} · {discipline.for.yellowCards}🟨 · {discipline.for.redCards}🟥
          </span>
          <span>
            RIV {discipline.against.fouls} · {discipline.against.yellowCards}🟨 · {discipline.against.redCards}🟥
          </span>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        <button
          type="button"
          onClick={() => onFoul("FOR")}
          className="rounded-lg bg-gray-800 py-2 text-[10px] font-bold text-gray-300 hover:bg-gray-700"
          title="Falta propia"
        >
          F · CDA
        </button>
        <button
          type="button"
          onClick={() => onFoul("AGAINST")}
          className="rounded-lg bg-gray-800 py-2 text-[10px] font-bold text-gray-300 hover:bg-gray-700"
          title="Falta rival"
        >
          F · RIV
        </button>
        <button
          type="button"
          onClick={() => setPendingOwnCard("YELLOW")}
          className="rounded-lg bg-yellow-400/15 py-2 text-xs font-bold text-yellow-300 hover:bg-yellow-400/25"
          title="Amarilla propia"
        >
          🟨 CDA
        </button>
        <button
          type="button"
          onClick={() => onCard("AGAINST", "YELLOW")}
          className="rounded-lg bg-yellow-400/10 py-2 text-xs font-bold text-yellow-200 hover:bg-yellow-400/20"
          title="Amarilla rival"
        >
          🟨 RIV
        </button>
        <button
          type="button"
          onClick={() => setPendingOwnCard("RED")}
          className="rounded-lg bg-red-500/15 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25"
          title="Roja propia"
        >
          🟥 CDA
        </button>
        <button
          type="button"
          onClick={() => onCard("AGAINST", "RED")}
          className="rounded-lg bg-red-500/10 py-2 text-xs font-bold text-red-200 hover:bg-red-500/20"
          title="Roja rival"
        >
          🟥 RIV
        </button>
      </div>

      {pendingOwnCard && (
        <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-300">
              {pendingOwnCard === "RED" ? "🟥" : "🟨"} ¿Quién?
            </span>
            <button
              type="button"
              onClick={() => setPendingOwnCard(null)}
              className="px-2 text-gray-500"
              aria-label="Cancelar tarjeta"
            >
              ×
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => {
                  onCard("FOR", pendingOwnCard, player.id);
                  setPendingOwnCard(null);
                }}
                className="flex min-w-24 items-center gap-2 rounded-lg bg-gray-800 p-2 text-left hover:bg-gray-700"
              >
                <PlayerAvatar player={player} compact />
                <span className="truncate text-xs font-bold">{player.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

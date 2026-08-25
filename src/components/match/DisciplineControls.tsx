"use client";

import { useMemo, useState } from "react";

import {
  CardColor,
  DisciplineSide,
  DisciplineSummary,
  Player,
} from "../../types";
import { PlayerAvatar } from "../player/PlayerAvatar";

type DisciplineIntent =
  | { kind: "FOUL"; side: DisciplineSide }
  | { kind: "CARD"; side: DisciplineSide; color: CardColor };

interface DisciplineControlsProps {
  players: Player[];
  onCourtPlayerIds: string[];
  benchPlayerIds: string[];
  discipline: DisciplineSummary;
  periodDiscipline: DisciplineSummary;
  period: number;
  onFoul: (side: DisciplineSide, playerId: string) => void;
  onCard: (
    side: DisciplineSide,
    color: CardColor,
    playerId?: string,
    causesInferiority?: boolean,
  ) => void;
  onInteractionStart?: () => void;
}

function playerList(players: Player[], ids: string[]): Player[] {
  return ids
    .map((id) => players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
}

export function DisciplineControls({
  players,
  onCourtPlayerIds,
  benchPlayerIds,
  discipline,
  periodDiscipline,
  period,
  onFoul,
  onCard,
  onInteractionStart,
}: DisciplineControlsProps) {
  const [intent, setIntent] = useState<DisciplineIntent | null>(null);
  const [redDecisionPlayer, setRedDecisionPlayer] = useState<Player | null>(
    null,
  );
  const courtPlayers = useMemo(
    () => playerList(players, onCourtPlayerIds),
    [onCourtPlayerIds, players],
  );
  const benchPlayers = useMemo(
    () => playerList(players, benchPlayerIds),
    [benchPlayerIds, players],
  );

  const reset = () => {
    setIntent(null);
    setRedDecisionPlayer(null);
  };

  const chooseIntent = (nextIntent: DisciplineIntent) => {
    onInteractionStart?.();
    if (nextIntent.kind === "CARD" && nextIntent.side === "AGAINST") {
      onCard("AGAINST", nextIntent.color);
      reset();
      return;
    }
    setIntent(nextIntent);
    setRedDecisionPlayer(null);
  };

  const choosePlayer = (player: Player, onCourt: boolean) => {
    if (!intent) return;
    if (intent.kind === "FOUL") {
      onFoul(intent.side, player.id);
      reset();
      return;
    }
    if (intent.color === "RED" && onCourt) {
      setRedDecisionPlayer(player);
      return;
    }
    onCard(intent.side, intent.color, player.id, false);
    reset();
  };

  const intentTitle = intent?.kind === "FOUL"
    ? intent.side === "FOR"
      ? "Falta cometida · ¿quién?"
      : "Falta recibida · ¿a quién?"
    : intent?.color === "YELLOW"
      ? "🟨 CDA · ¿quién?"
      : "🟥 CDA · ¿quién?";

  return (
    <section className="h-full rounded-2xl border border-slate-800 bg-slate-950/80 p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            Disciplina
          </h3>
          <span className="text-[10px] text-slate-600">P{period}</span>
        </div>
        <div className="flex gap-3 font-mono text-[11px] text-slate-400">
          <span>CDA {discipline.for.yellowCards}🟨 {discipline.for.redCards}🟥</span>
          <span>RIV {discipline.against.yellowCards}🟨 {discipline.against.redCards}🟥</span>
        </div>
      </div>

      {!intent && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={() => chooseIntent({ kind: "FOUL", side: "FOR" })}
              className="flex min-h-16 items-center justify-between rounded-xl border-2 border-orange-900 bg-orange-950/40 px-4 text-left hover:border-orange-400"
              aria-label="Registrar falta cometida por CD Alameda"
            >
              <span>
                <span className="block text-xl" aria-hidden="true">📣 →</span>
                <span className="text-xs font-bold text-orange-200">CDA comete</span>
              </span>
              <span className="font-mono text-2xl font-black text-orange-300">
                F{periodDiscipline.for.fouls}
              </span>
            </button>
            <button
              type="button"
              onClick={() => chooseIntent({ kind: "FOUL", side: "AGAINST" })}
              className="flex min-h-16 items-center justify-between rounded-xl border-2 border-sky-900 bg-sky-950/40 px-4 text-left hover:border-sky-400"
              aria-label="Registrar falta recibida por CD Alameda"
            >
              <span>
                <span className="block text-xl" aria-hidden="true">← 📣</span>
                <span className="text-xs font-bold text-sky-200">CDA recibe</span>
              </span>
              <span className="font-mono text-2xl font-black text-sky-300">
                F{periodDiscipline.against.fouls}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
            {([
              ["FOR", "YELLOW", "🟨 CDA"],
              ["AGAINST", "YELLOW", "🟨 RIV"],
              ["FOR", "RED", "🟥 CDA"],
              ["AGAINST", "RED", "🟥 RIV"],
            ] as const).map(([side, color, label]) => (
              <button
                key={`${side}-${color}`}
                type="button"
                onClick={() => chooseIntent({ kind: "CARD", side, color })}
                className={`min-h-14 rounded-xl border px-2 text-sm font-black transition-colors ${
                  color === "YELLOW"
                    ? "border-yellow-800 bg-yellow-950/30 text-yellow-200 hover:bg-yellow-900/60"
                    : "border-red-900 bg-red-950/40 text-red-200 hover:bg-red-900/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {intent && !redDecisionPlayer && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <strong className="text-sm text-white">{intentTitle}</strong>
            <button
              type="button"
              onClick={reset}
              className="grid h-10 w-10 place-items-center rounded-lg bg-slate-800 text-xl text-slate-400"
              aria-label="Cancelar disciplina"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-2">
            {courtPlayers.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => choosePlayer(player, true)}
                className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-cyan-700 bg-cyan-950/40 p-2 hover:border-cyan-300"
              >
                <PlayerAvatar player={player} compact />
                <span className="mt-1 max-w-full truncate text-xs font-bold">{player.name}</span>
              </button>
            ))}
          </div>

          {benchPlayers.length > 0 && (
            <div className="mt-3 border-t border-slate-800 pt-3">
              <span className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-slate-600">
                Banquillo
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-2">
                {benchPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => choosePlayer(player, false)}
                    className="flex min-w-28 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 p-2 text-left hover:border-slate-400"
                  >
                    <PlayerAvatar player={player} compact />
                    <span className="truncate text-xs font-bold">{player.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {intent?.kind === "CARD" && intent.color === "RED" && redDecisionPlayer && (
        <div className="rounded-xl border-2 border-red-800 bg-red-950/50 p-3">
          <div className="mb-3 flex items-center gap-3">
            <PlayerAvatar player={redDecisionPlayer} compact />
            <div>
              <strong className="block">🟥 {redDecisionPlayer.name}</strong>
              <span className="text-xs text-red-200">¿Reduce el quinteto?</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onCard("FOR", "RED", redDecisionPlayer.id, false);
                reset();
              }}
              className="min-h-16 rounded-xl bg-slate-800 px-3 text-sm font-bold"
            >
              🟥 Solo tarjeta
            </button>
            <button
              type="button"
              onClick={() => {
                onCard("FOR", "RED", redDecisionPlayer.id, true);
                reset();
              }}
              className="min-h-16 rounded-xl bg-red-600 px-3 text-sm font-black"
            >
              🟥 + ▼ 4v5
            </button>
          </div>
          <button
            type="button"
            onClick={reset}
            className="mt-2 min-h-11 w-full rounded-xl text-xs text-red-200"
          >
            Cancelar
          </button>
        </div>
      )}
    </section>
  );
}

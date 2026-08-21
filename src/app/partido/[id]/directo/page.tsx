"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";

import { replayMatch } from "../../../../lib/matchEngine";
import { useMatchStore } from "../../../../store/useMatchStore";
import {
  LiveThreatOutcome,
  NormalizedCoordinates,
  Player,
  TimelineEntry,
} from "../../../../types";

const PLAYER_POSITIONS = [
  { left: "11%", top: "50%" },
  { left: "36%", top: "24%" },
  { left: "36%", top: "76%" },
  { left: "69%", top: "28%" },
  { left: "69%", top: "72%" },
];

const OUTCOME_OPTIONS: Array<{
  value: LiveThreatOutcome;
  label: string;
  className: string;
}> = [
  { value: "GOL", label: "⚽ Gol", className: "bg-emerald-600 hover:bg-emerald-500" },
  { value: "PARADA", label: "🧤 Parada", className: "bg-sky-600 hover:bg-sky-500" },
  { value: "FUERA", label: "↗ Fuera", className: "bg-slate-600 hover:bg-slate-500" },
];

type InteractionMode = "threat" | "substitution";

function playerName(players: Player[], playerId?: string): string {
  if (!playerId) {
    return "Rival";
  }
  const player = players.find((candidate) => candidate.id === playerId);
  return player ? `${player.number}. ${player.name}` : playerId;
}

function eventDescription(entry: TimelineEntry, players: Player[]): string {
  const { event } = entry;
  if (event.type === "substitution") {
    return `Cambio: sale ${playerName(players, event.playerOutId)} · entra ${playerName(players, event.playerInId)}`;
  }
  if (event.type === "threat_recorded") {
    const coordinates = `${Math.round(event.origin.x * 100)}%, ${Math.round(event.origin.y * 100)}%`;
    return `${event.outcome}: ${playerName(players, event.playerId)} · origen ${coordinates}`;
  }
  return "Alineación inicial";
}

export default function DirectoPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const session = useMatchStore((state) => state.matches[matchId]);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const incrementMinute = useMatchStore((state) => state.incrementMinute);
  const recordThreat = useMatchStore((state) => state.recordThreat);
  const swapPlayer = useMatchStore((state) => state.swapPlayer);
  const softDeleteEvent = useMatchStore((state) => state.softDeleteEvent);
  const undo = useMatchStore((state) => state.undo);
  const redo = useMatchStore((state) => state.redo);
  const clearError = useMatchStore((state) => state.clearError);

  const [mode, setMode] = useState<InteractionMode>("threat");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<NormalizedCoordinates | null>(null);

  useEffect(() => {
    ensureMatch(matchId);
    setMode("threat");
    setSelectedPlayerId(null);
    setOrigin(null);
  }, [ensureMatch, matchId]);

  const replay = useMemo(
    () => (session ? replayMatch(session.players, session.events) : null),
    [session],
  );

  if (!session || !replay) {
    return (
      <main className="grid min-h-screen place-items-center bg-gray-950 text-white">
        Preparando el partido…
      </main>
    );
  }

  const playersOnCourt = replay.onCourtPlayerIds
    .map((id) => session.players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  const bench = replay.benchPlayerIds
    .map((id) => session.players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  const recentEvents = replay.timeline
    .filter((entry) => entry.event.type !== "lineup_initialized")
    .reverse();

  const selectPlayer = (playerId: string) => {
    clearError(matchId);
    setSelectedPlayerId((current) => (current === playerId ? null : playerId));
    setOrigin(null);
  };

  const handleCourtClick = (event: MouseEvent<HTMLDivElement>) => {
    if (mode !== "threat" || !selectedPlayerId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setOrigin({ x, y });
  };

  const finishThreat = (outcome: LiveThreatOutcome) => {
    if (!selectedPlayerId || !origin) {
      return;
    }
    recordThreat(matchId, { playerId: selectedPlayerId, origin, outcome });
    setSelectedPlayerId(null);
    setOrigin(null);
  };

  const setInteractionMode = (nextMode: InteractionMode) => {
    clearError(matchId);
    setMode(nextMode);
    setSelectedPlayerId(null);
    setOrigin(null);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-3 font-sans text-white sm:p-4">
      <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3 border-b border-gray-700 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Partido {matchId}
          </p>
          <h1 className="text-xl font-bold">Directo: CD Alameda</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-300">
            Parte {session.period}
          </span>
          <span className="min-w-16 text-center font-mono text-3xl text-green-400">
            {session.minute}&apos;
          </span>
          <button
            type="button"
            onClick={() => incrementMinute(matchId)}
            className="rounded-lg bg-gray-700 px-3 py-2 text-sm transition-colors hover:bg-gray-600"
          >
            +1 min
          </button>
          <button
            type="button"
            onClick={() => undo(matchId)}
            disabled={session.past.length === 0}
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35"
          >
            Deshacer
          </button>
          <button
            type="button"
            onClick={() => redo(matchId)}
            disabled={session.future.length === 0}
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-35"
          >
            Rehacer
          </button>
        </div>
      </header>

      {session.lastError && (
        <div
          role="alert"
          className="mx-auto mb-4 flex max-w-7xl items-center justify-between rounded-xl border border-red-500/50 bg-red-950/70 px-4 py-3 text-sm text-red-100"
        >
          <span>{session.lastError}</span>
          <button type="button" onClick={() => clearError(matchId)} className="font-bold">
            Cerrar
          </button>
        </div>
      )}

      <main className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl bg-gray-900 p-3 shadow-xl sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-bold">Pista interactiva</h2>
              <p className="text-sm text-gray-400">
                {mode === "threat"
                  ? selectedPlayerId
                    ? origin
                      ? "3. Selecciona el resultado de la amenaza"
                      : "2. Marca en la pista el origen del disparo"
                    : "1. Selecciona al jugador que realiza la amenaza"
                  : selectedPlayerId
                    ? "Selecciona en el banquillo al jugador que entra"
                    : "Selecciona al jugador que sale"}
              </p>
            </div>
            <div className="flex rounded-xl bg-gray-950 p-1">
              <button
                type="button"
                onClick={() => setInteractionMode("threat")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  mode === "threat" ? "bg-emerald-600" : "text-gray-400"
                }`}
              >
                Amenaza
              </button>
              <button
                type="button"
                onClick={() => setInteractionMode("substitution")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  mode === "substitution" ? "bg-amber-600" : "text-gray-400"
                }`}
              >
                Cambio
              </button>
            </div>
          </div>

          <div
            onClick={handleCourtClick}
            className={`relative min-h-[360px] overflow-hidden rounded-2xl border-4 border-white/80 bg-emerald-800 sm:min-h-[440px] ${
              mode === "threat" && selectedPlayerId
                ? "cursor-crosshair"
                : "cursor-default"
            }`}
            aria-label="Pista de fútbol sala. Selecciona el origen del disparo."
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/70" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70" />
            <div className="pointer-events-none absolute inset-y-[24%] left-0 w-[14%] rounded-r-[50%] border-2 border-l-0 border-white/70" />
            <div className="pointer-events-none absolute inset-y-[24%] right-0 w-[14%] rounded-l-[50%] border-2 border-r-0 border-white/70" />

            {playersOnCourt.map((player, index) => {
              const position = PLAYER_POSITIONS[index] ?? PLAYER_POSITIONS[0];
              const selected = selectedPlayerId === player.id;
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectPlayer(player.id);
                  }}
                  className={`absolute z-10 flex min-h-16 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 text-center shadow-lg transition-all sm:w-28 ${
                    selected
                      ? "scale-110 border-yellow-200 bg-yellow-500 text-gray-950 ring-4 ring-yellow-300/30"
                      : "border-white/60 bg-gray-900/90 hover:bg-gray-800"
                  }`}
                  style={position}
                  aria-pressed={selected}
                >
                  <span className="text-lg font-black">#{player.number}</span>
                  <span className="max-w-full truncate text-xs font-semibold">{player.name}</span>
                </button>
              );
            })}

            {origin && (
              <div
                className="pointer-events-none absolute z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-red-500 shadow-[0_0_0_6px_rgba(239,68,68,0.3)]"
                style={{ left: `${origin.x * 100}%`, top: `${origin.y * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {OUTCOME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={mode !== "threat" || !selectedPlayerId || !origin}
                onClick={() => finishThreat(option.value)}
                className={`rounded-xl px-2 py-3 text-sm font-bold shadow-md transition-colors disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600 ${option.className}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl bg-gray-950 p-3">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
              Banquillo
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {bench.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  disabled={mode !== "substitution" || !selectedPlayerId}
                  onClick={() => {
                    if (selectedPlayerId) {
                      swapPlayer(matchId, selectedPlayerId, player.id);
                      setSelectedPlayerId(null);
                      setMode("threat");
                    }
                  }}
                  className="min-w-28 rounded-xl border-2 border-gray-700 bg-gray-800 p-3 text-left font-semibold transition-colors enabled:border-emerald-500 enabled:hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="block text-lg">#{player.number}</span>
                  <span className="text-sm">{player.name}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="flex min-h-[320px] flex-col rounded-2xl bg-gray-900 p-4 shadow-xl lg:max-h-[720px]">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-bold">Cronología</h2>
              <p className="text-xs text-gray-500">Orden total y alineación reconstruida</p>
            </div>
            <span className="rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-400">
              {recentEvents.length} eventos
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {recentEvents.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-700 p-5 text-center text-sm text-gray-500">
                Las amenazas y cambios aparecerán aquí inmediatamente.
              </div>
            )}
            {recentEvents.map((entry) => (
              <article key={entry.event.id} className="rounded-xl bg-gray-800 p-3 text-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="font-mono font-bold text-green-400">
                    P{entry.event.period} · {entry.event.minute}&apos; · #{entry.event.order}
                  </span>
                  <button
                    type="button"
                    onClick={() => softDeleteEvent(matchId, entry.event.id)}
                    className="text-xs text-gray-500 hover:text-red-300"
                    aria-label={`Eliminar ${eventDescription(entry, session.players)}`}
                  >
                    Eliminar
                  </button>
                </div>
                <p className="font-semibold text-gray-100">
                  {eventDescription(entry, session.players)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  En pista: {entry.lineupPlayerIds.map((id) => playerName(session.players, id)).join(" · ")}
                </p>
              </article>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

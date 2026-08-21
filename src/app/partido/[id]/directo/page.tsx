"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";

import { FutsalCourtMarkings } from "../../../../components/court/FutsalCourtMarkings";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { replayMatch } from "../../../../lib/matchEngine";
import { useMatchStore } from "../../../../store/useMatchStore";
import {
  LiveThreatOutcome,
  LiveThreatPhase,
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

const PHASE_OPTIONS: Array<{
  value: LiveThreatPhase;
  label: string;
  shortLabel: string;
  icon: string;
  tone: string;
}> = [
  { value: "POSITIONAL", label: "Posicional", shortLabel: "Pos.", icon: "▦", tone: "cyan" },
  { value: "TRANSITION", label: "Transición", shortLabel: "Trans.", icon: "➜", tone: "cyan" },
  { value: "SET_PIECE_CORNER", label: "ABP córner", shortLabel: "Córner", icon: "⌜", tone: "violet" },
  { value: "SET_PIECE_FREE_KICK", label: "ABP falta", shortLabel: "Falta", icon: "●↗", tone: "violet" },
  { value: "SET_PIECE_KICK_IN", label: "ABP banda", shortLabel: "Banda", icon: "↥", tone: "violet" },
  { value: "FLYING_GOALKEEPER", label: "Portero-jugador", shortLabel: "P-J", icon: "◇⁺", tone: "rose" },
  { value: "PENALTY", label: "Penalti", shortLabel: "Penalti", icon: "6m", tone: "amber" },
  { value: "DOUBLE_PENALTY", label: "Doble penalti", shortLabel: "Doble", icon: "10m", tone: "amber" },
];

const PHASE_TONES: Record<string, { idle: string; active: string }> = {
  cyan: {
    idle: "border-cyan-900/80 bg-cyan-950/40 hover:border-cyan-500",
    active: "border-cyan-200 bg-cyan-500 text-slate-950",
  },
  violet: {
    idle: "border-violet-900/80 bg-violet-950/40 hover:border-violet-500",
    active: "border-violet-200 bg-violet-500 text-white",
  },
  rose: {
    idle: "border-rose-900/80 bg-rose-950/40 hover:border-rose-500",
    active: "border-rose-200 bg-rose-500 text-white",
  },
  amber: {
    idle: "border-amber-900/80 bg-amber-950/40 hover:border-amber-500",
    active: "border-amber-200 bg-amber-400 text-slate-950",
  },
};

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
    return `${event.outcome}: ${playerName(players, event.playerId)} · ${phaseLabel(event.phase)} · origen ${coordinates}`;
  }
  return "Alineación inicial";
}

function phaseLabel(phase: string): string {
  return PHASE_OPTIONS.find((option) => option.value === phase)?.label ?? "Sin fase";
}

export default function DirectoPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const session = useMatchStore((state) => state.matches[matchId]);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const incrementMinute = useMatchStore((state) => state.incrementMinute);
  const decrementMinute = useMatchStore((state) => state.decrementMinute);
  const recordThreat = useMatchStore((state) => state.recordThreat);
  const swapPlayer = useMatchStore((state) => state.swapPlayer);
  const softDeleteEvent = useMatchStore((state) => state.softDeleteEvent);
  const undo = useMatchStore((state) => state.undo);
  const redo = useMatchStore((state) => state.redo);
  const clearError = useMatchStore((state) => state.clearError);

  const [mode, setMode] = useState<InteractionMode>("threat");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<NormalizedCoordinates | null>(null);
  const [phase, setPhase] = useState<LiveThreatPhase | null>(null);

  useEffect(() => {
    ensureMatch(matchId);
    setMode("threat");
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
  }, [ensureMatch, matchId]);

  const replay = useMemo(
    () =>
      session
        ? replayMatch(session.players, session.events, {
            currentClock: { period: session.period, minute: session.minute },
            throughClock: { period: session.period, minute: session.minute },
          })
        : null,
    [session],
  );

  const chronologyReplay = useMemo(
    () => (session ? replayMatch(session.players, session.events) : null),
    [session],
  );

  if (!session || !replay || !chronologyReplay) {
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
  const recentEvents = chronologyReplay.timeline
    .filter((entry) => entry.event.type !== "lineup_initialized")
    .reverse();

  const selectPlayer = (playerId: string) => {
    clearError(matchId);
    setSelectedPlayerId((current) => (current === playerId ? null : playerId));
    setOrigin(null);
    setPhase(null);
  };

  const handleCourtClick = (event: MouseEvent<HTMLDivElement>) => {
    if (mode !== "threat" || !selectedPlayerId) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setOrigin({ x, y });
    setPhase(null);
  };

  const finishThreat = (outcome: LiveThreatOutcome) => {
    if (!selectedPlayerId || !origin || !phase) {
      return;
    }
    recordThreat(matchId, { playerId: selectedPlayerId, origin, outcome, phase });
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
  };

  const setInteractionMode = (nextMode: InteractionMode) => {
    clearError(matchId);
    setMode(nextMode);
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
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
          <span
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              session.persistenceStatus === "saved"
                ? "bg-emerald-950 text-emerald-300"
                : session.persistenceStatus === "error"
                  ? "bg-red-950 text-red-300"
                  : "bg-gray-900 text-gray-400"
            }`}
          >
            {session.persistenceStatus === "saved"
              ? "● Guardado local"
              : session.persistenceStatus === "error"
                ? "● Error de guardado"
                : "○ Preparando guardado"}
          </span>
          <span className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-300">
            Parte {session.period}
          </span>
          <span className="min-w-16 text-center font-mono text-3xl text-green-400">
            {session.minute}&apos;
          </span>
          <span className="flex overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
            <button
              type="button"
              onClick={() => decrementMinute(matchId)}
              disabled={session.minute === 0}
              className="min-w-10 px-3 py-2 text-lg font-bold leading-none transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-600"
              aria-label="Restar un minuto"
            >
              −1
            </button>
            <span className="w-px bg-gray-700" aria-hidden="true" />
            <button
              type="button"
              onClick={() => incrementMinute(matchId)}
              className="min-w-10 px-3 py-2 text-lg font-bold leading-none transition-colors hover:bg-gray-700"
              aria-label="Sumar un minuto"
            >
              +1
            </button>
          </span>
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
                      ? phase
                        ? "4. Selecciona el resultado de la amenaza"
                        : "3. Selecciona la fase o contexto"
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
            className={`relative min-h-[360px] overflow-hidden rounded-2xl border-4 border-white/80 bg-[#075a9c] sm:min-h-[440px] ${
              mode === "threat" && selectedPlayerId
                ? "cursor-crosshair"
                : "cursor-default"
            }`}
            aria-label="Pista de fútbol sala. Selecciona el origen del disparo."
          >
            <FutsalCourtMarkings />

            {playersOnCourt.map((player, index) => {
              const position = PLAYER_POSITIONS[index] ?? PLAYER_POSITIONS[0];
              const selected = selectedPlayerId === player.id;
              const minutes = replay.playerMinutes[player.id];
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectPlayer(player.id);
                  }}
                  className={`absolute z-10 flex min-h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 text-center shadow-lg transition-all sm:w-28 ${
                    selected
                      ? "scale-110 border-yellow-200 bg-yellow-500 text-gray-950 ring-4 ring-yellow-300/30"
                      : "border-white/60 bg-gray-900/90 hover:bg-gray-800"
                  }`}
                  style={position}
                  aria-pressed={selected}
                >
                  <PlayerAvatar player={player} selected={selected} />
                  <span className="mt-1 max-w-full truncate text-xs font-semibold">{player.name}</span>
                  <span className="mt-1 flex items-baseline gap-1.5" aria-label={`${minutes.currentStintMinutes} minutos en el tramo actual; ${minutes.totalMinutes} minutos acumulados`}>
                    <span className={`text-base font-black ${selected ? "text-slate-950" : "text-cyan-300"}`} title="Tramo actual">
                      {minutes.currentStintMinutes}&apos;
                    </span>
                    <span className={`text-[10px] font-semibold ${selected ? "text-slate-700" : "text-slate-400"}`} title="Acumulado">
                      ({minutes.totalMinutes}&apos;)
                    </span>
                  </span>
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

          <div className="mt-3 rounded-xl bg-gray-950 p-2.5">
            <div className="mb-2 flex min-h-5 items-center justify-between gap-2 px-1">
              <h3 className="sr-only">Fase o contexto</h3>
              <span className="text-lg text-slate-500" aria-hidden="true">◎</span>
              {phase && (
                <span className="text-xs font-semibold text-amber-300">
                  {phaseLabel(phase)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-8">
              {PHASE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={mode !== "threat" || !selectedPlayerId || !origin}
                  onClick={() => setPhase(option.value)}
                  title={option.label}
                  aria-label={option.label}
                  className={`flex aspect-square min-h-14 flex-col items-center justify-center rounded-xl border px-1 py-1.5 font-semibold transition-all disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-700 ${
                    phase === option.value
                      ? PHASE_TONES[option.tone].active
                      : PHASE_TONES[option.tone].idle
                  }`}
                  aria-pressed={phase === option.value}
                >
                  <span className="text-xl font-black leading-none" aria-hidden="true">{option.icon}</span>
                  <span className="mt-1 text-[10px] leading-none">{option.shortLabel}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {OUTCOME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={mode !== "threat" || !selectedPlayerId || !origin || !phase}
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
                  <span className="flex items-center gap-3">
                    <PlayerAvatar player={player} compact />
                    <span>
                      <span className="block text-sm">{player.name}</span>
                      <span className="mt-0.5 block text-xs font-bold text-cyan-300" aria-label={`${replay.playerMinutes[player.id].totalMinutes} minutos acumulados`} title="Acumulado">
                        {replay.playerMinutes[player.id].totalMinutes}&apos;
                      </span>
                    </span>
                  </span>
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

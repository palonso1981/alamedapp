"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";

import { FutsalCourtMarkings } from "../../../../components/court/FutsalCourtMarkings";
import { DisciplineControls } from "../../../../components/match/DisciplineControls";
import { HistoryControls } from "../../../../components/match/HistoryControls";
import {
  ClockSide,
  MatchClockControl,
} from "../../../../components/match/MatchClockControl";
import { MatchScoreboard } from "../../../../components/match/MatchScoreboard";
import { RecentEventsPanel } from "../../../../components/match/RecentEventsPanel";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import {
  eventDescription,
  phaseLabel,
} from "../../../../lib/eventPresentation";
import { replayMatch, sortEvents } from "../../../../lib/matchEngine";
import { useMatchStore } from "../../../../store/useMatchStore";
import {
  INFERIORITY_SLOT_ID,
  LiveThreatOutcome,
  LiveThreatPhase,
  MatchEvent,
  NormalizedCoordinates,
  Player,
  ThreatSide,
} from "../../../../types";

const CLOCK_SIDE_STORAGE_KEY = "alamedapp:directo-clock-side:v1";

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
  tier: "PRIMARY" | "SECONDARY" | "RARE";
}> = [
  { value: "POSITIONAL", label: "Posicional", shortLabel: "Pos.", icon: "▦", tone: "cyan", tier: "PRIMARY" },
  { value: "TRANSITION", label: "Transición", shortLabel: "Trans.", icon: "➜", tone: "cyan", tier: "PRIMARY" },
  { value: "SET_PIECE_KICK_IN", label: "ABP banda", shortLabel: "Banda", icon: "↥", tone: "violet", tier: "SECONDARY" },
  { value: "SET_PIECE_CORNER", label: "ABP córner", shortLabel: "Córner", icon: "⌜", tone: "violet", tier: "SECONDARY" },
  { value: "SET_PIECE_FREE_KICK", label: "ABP falta", shortLabel: "Falta", icon: "●↗", tone: "violet", tier: "SECONDARY" },
  { value: "FLYING_GOALKEEPER", label: "Portero-jugador", shortLabel: "P-J", icon: "◇⁺", tone: "rose", tier: "SECONDARY" },
  { value: "PENALTY", label: "Penalti", shortLabel: "6m", icon: "●", tone: "amber", tier: "RARE" },
  { value: "DOUBLE_PENALTY", label: "Doble penalti", shortLabel: "10m", icon: "●", tone: "amber", tier: "RARE" },
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

function undoTarget(
  events: MatchEvent[],
  previousEvents: MatchEvent[] | undefined,
): MatchEvent | undefined {
  if (!previousEvents) return undefined;
  const previousById = new Map(
    previousEvents.map((event) => [event.id, event] as const),
  );
  const added = sortEvents(
    events.filter((event) => !previousById.has(event.id)),
  ).at(-1);
  if (added) return added;

  const changed = events.find((event) => {
    const previous = previousById.get(event.id);
    return previous && JSON.stringify(previous) !== JSON.stringify(event);
  });
  if (changed) return changed;

  const currentIds = new Set(events.map((event) => event.id));
  return sortEvents(
    previousEvents.filter((event) => !currentIds.has(event.id)),
  ).at(-1);
}

export default function DirectoPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const session = useMatchStore((state) => state.matches[matchId]);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const incrementMinute = useMatchStore((state) => state.incrementMinute);
  const decrementMinute = useMatchStore((state) => state.decrementMinute);
  const changePeriod = useMatchStore((state) => state.changePeriod);
  const recordThreat = useMatchStore((state) => state.recordThreat);
  const toggleGameState = useMatchStore((state) => state.toggleGameState);
  const recordFoul = useMatchStore((state) => state.recordFoul);
  const recordCard = useMatchStore((state) => state.recordCard);
  const swapPlayer = useMatchStore((state) => state.swapPlayer);
  const softDeleteEvent = useMatchStore((state) => state.softDeleteEvent);
  const restoreEvent = useMatchStore((state) => state.restoreEvent);
  const editAndReorderEvent = useMatchStore(
    (state) => state.editAndReorderEvent,
  );
  const moveEventWithinMinute = useMatchStore(
    (state) => state.moveEventWithinMinute,
  );
  const undo = useMatchStore((state) => state.undo);
  const redo = useMatchStore((state) => state.redo);
  const clearError = useMatchStore((state) => state.clearError);

  const [mode, setMode] = useState<InteractionMode>("threat");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<NormalizedCoordinates | null>(null);
  const [phase, setPhase] = useState<LiveThreatPhase | null>(null);
  const [threatSide, setThreatSide] = useState<ThreatSide>("FOR");
  const [clockSide, setClockSide] = useState<ClockSide>("right");

  useEffect(() => {
    const savedSide = window.localStorage.getItem(CLOCK_SIDE_STORAGE_KEY);
    if (savedSide === "left" || savedSide === "right") {
      setClockSide(savedSide);
    }
  }, []);

  useEffect(() => {
    ensureMatch(matchId);
    setMode("threat");
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
    setThreatSide("FOR");
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

  const bench = replay.benchPlayerIds
    .map((id) => session.players.find((player) => player.id === id))
    .filter((player): player is Player => Boolean(player));
  const recentEvents = sortEvents(session.events)
    .filter((event) => event.type !== "lineup_initialized")
    .reverse()
    .slice(0, 5);
  const periodDiscipline = chronologyReplay.disciplineByPeriod[
    session.period
  ] ?? {
    for: { fouls: 0, yellowCards: 0, redCards: 0 },
    against: { fouls: 0, yellowCards: 0, redCards: 0 },
  };
  const targetForUndo = undoTarget(session.events, session.past.at(-1));
  const targetUndoEntry = targetForUndo
    ? chronologyReplay.timeline.find(
        (entry) => entry.event.id === targetForUndo.id,
      )
    : undefined;
  const undoDescription = targetForUndo
    ? `${eventDescription(targetForUndo, session.players, targetUndoEntry)} ${targetForUndo.minute}'`
    : "última acción";

  const updateClockSide = (side: ClockSide) => {
    setClockSide(side);
    window.localStorage.setItem(CLOCK_SIDE_STORAGE_KEY, side);
  };

  const selectPlayer = (playerId: string) => {
    clearError(matchId);
    setSelectedPlayerId((current) => (current === playerId ? null : playerId));
    setOrigin(null);
    setPhase(
      replay.flyingGoalkeeperActive ? "FLYING_GOALKEEPER" : null,
    );
  };

  const handleCourtClick = (event: MouseEvent<HTMLDivElement>) => {
    if (
      mode !== "threat" ||
      (threatSide === "FOR" && !selectedPlayerId)
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    setOrigin({ x, y });
    setPhase(
      replay.flyingGoalkeeperActive ? "FLYING_GOALKEEPER" : null,
    );
  };

  const finishThreat = (outcome: LiveThreatOutcome) => {
    if (
      (threatSide === "FOR" && !selectedPlayerId) ||
      !origin ||
      !phase
    ) {
      return;
    }
    recordThreat(matchId, {
      side: threatSide,
      playerId: threatSide === "FOR" ? selectedPlayerId ?? undefined : undefined,
      origin,
      outcome,
      phase,
    });
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
  };

  const setThreatTeam = (side: ThreatSide) => {
    clearError(matchId);
    setMode("threat");
    setThreatSide(side);
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(
      replay.flyingGoalkeeperActive ? "FLYING_GOALKEEPER" : null,
    );
  };

  const setInteractionMode = (nextMode: InteractionMode) => {
    clearError(matchId);
    setMode(nextMode);
    setSelectedPlayerId(null);
    setOrigin(null);
    setPhase(null);
  };

  return (
    <div
      className={`min-h-screen bg-gray-950 p-3 pb-28 font-sans text-white sm:p-4 sm:pb-4 ${
        clockSide === "left" ? "sm:pl-28" : "sm:pr-28"
      }`}
    >
      <MatchClockControl
        period={session.period}
        minute={session.minute}
        side={clockSide}
        onSideChange={updateClockSide}
        onIncrement={() => incrementMinute(matchId)}
        onDecrement={() => decrementMinute(matchId)}
        onPeriodChange={(period) => changePeriod(matchId, period)}
      />
      <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3 border-b border-gray-700 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Partido {matchId}
          </p>
          <h1 className="text-xl font-bold">Directo: CD Alameda</h1>
        </div>

        <MatchScoreboard score={chronologyReplay.score} />

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
        </div>
      </header>

      <div className="mx-auto mb-3 flex max-w-7xl justify-end">
        <HistoryControls
          canUndo={session.past.length > 0}
          canRedo={session.future.length > 0}
          undoDescription={undoDescription}
          onUndo={() => undo(matchId)}
          onRedo={() => redo(matchId)}
        />
      </div>

      <div className="mx-auto mb-4 grid max-w-7xl grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => toggleGameState(matchId, "SUPERIORITY")}
          className={`rounded-xl border-2 px-3 py-3 text-sm font-black transition-all ${
            replay.superiorityActive
              ? "animate-pulse border-amber-200 bg-amber-400 text-slate-950 shadow-[0_0_24px_rgba(251,191,36,0.35)]"
              : "border-gray-800 bg-gray-900 text-gray-500"
          }`}
          aria-pressed={replay.superiorityActive}
        >
          {replay.superiorityActive ? "⚡ SUPERIORIDAD ACTIVA" : "⚡ Superioridad"}
        </button>
        <button
          type="button"
          onClick={() => toggleGameState(matchId, "FLYING_GOALKEEPER")}
          className={`rounded-xl border-2 px-3 py-3 text-sm font-black transition-all ${
            replay.flyingGoalkeeperActive
              ? "border-rose-300 bg-rose-600 text-white"
              : "border-gray-800 bg-gray-900 text-gray-500"
          }`}
          aria-pressed={replay.flyingGoalkeeperActive}
        >
          ◇⁺ {replay.flyingGoalkeeperActive ? "P-J ACTIVO" : "Portero-jugador"}
        </button>
        <div
          className={`col-span-2 rounded-xl border-2 px-3 py-3 text-center text-sm font-black sm:col-span-1 ${
            replay.inferiorityActive
              ? "border-red-300 bg-red-950 text-red-200"
              : "border-gray-900 bg-gray-950 text-gray-700"
          }`}
        >
          {replay.inferiorityActive ? "▼ INFERIORIDAD" : "5v5"}
        </div>
      </div>

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
                  ? threatSide === "AGAINST" || selectedPlayerId
                    ? origin
                      ? phase
                        ? "4. Selecciona el resultado de la amenaza"
                        : "3. Selecciona la fase o contexto"
                      : "2. Marca en la pista el origen del disparo"
                    : "1. Toca al jugador"
                  : selectedPlayerId
                    ? "Selecciona en el banquillo al jugador que entra"
                    : "Selecciona al jugador que sale"}
              </p>
            </div>
            <div className="grid w-full grid-cols-[1fr_1fr_0.85fr] gap-2 sm:w-auto sm:min-w-[520px]">
              <button
                type="button"
                onClick={() => setThreatTeam("FOR")}
                className={`min-h-16 rounded-2xl border-2 px-3 text-left transition-all ${
                  mode === "threat" && threatSide === "FOR"
                    ? "border-cyan-200 bg-cyan-500 text-slate-950 shadow-lg"
                    : "border-cyan-900 bg-cyan-950/50 text-cyan-200"
                }`}
                aria-pressed={mode === "threat" && threatSide === "FOR"}
              >
                <span className="block text-2xl font-black leading-none" aria-hidden="true">↑ ⚽</span>
                <span className="mt-1 block text-xs font-black uppercase tracking-wider">CDA</span>
              </button>
              <button
                type="button"
                onClick={() => setThreatTeam("AGAINST")}
                className={`min-h-16 rounded-2xl border-2 px-3 text-left transition-all ${
                  mode === "threat" && threatSide === "AGAINST"
                    ? "border-rose-200 bg-rose-600 text-white shadow-lg"
                    : "border-rose-900 bg-rose-950/50 text-rose-200"
                }`}
                aria-pressed={mode === "threat" && threatSide === "AGAINST"}
              >
                <span className="block text-2xl font-black leading-none" aria-hidden="true">↓ ⚽</span>
                <span className="mt-1 block text-xs font-black uppercase tracking-wider">Rival</span>
              </button>
              <button
                type="button"
                onClick={() => setInteractionMode("substitution")}
                className={`ml-1 min-h-16 rounded-2xl border-2 px-3 text-left transition-all ${
                  mode === "substitution"
                    ? "border-amber-200 bg-amber-500 text-slate-950 shadow-lg"
                    : "border-amber-900 bg-amber-950/40 text-amber-200"
                }`}
                aria-pressed={mode === "substitution"}
              >
                <span className="block text-2xl font-black leading-none" aria-hidden="true">↔</span>
                <span className="mt-1 block text-xs font-black uppercase tracking-wider">Cambio</span>
              </button>
            </div>
          </div>

          <div
            onClick={handleCourtClick}
            className={`relative min-h-[360px] overflow-hidden rounded-2xl border-4 border-white/80 bg-[#075a9c] sm:min-h-[440px] ${
              mode === "threat" &&
              (threatSide === "AGAINST" || selectedPlayerId)
                ? "cursor-crosshair"
                : "cursor-default"
            }`}
            aria-label="Pista de fútbol sala. Selecciona el origen del disparo."
          >
            <FutsalCourtMarkings />

            {replay.onCourtPlayerIds.map((slotId, index) => {
              const position = PLAYER_POSITIONS[index] ?? PLAYER_POSITIONS[0];
              if (slotId === INFERIORITY_SLOT_ID) {
                const selected = selectedPlayerId === slotId;
                return (
                  <button
                    key={slotId}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (mode === "substitution") {
                        selectPlayer(slotId);
                      }
                    }}
                    className={`absolute z-10 flex min-h-24 w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-2 py-2 text-center shadow-lg sm:w-28 ${
                      selected
                        ? "scale-110 border-white bg-red-500 text-white"
                        : "border-red-300 bg-red-950/90 text-red-200"
                    }`}
                    style={position}
                    aria-pressed={selected}
                    aria-label="Plaza INFERIORIDAD"
                  >
                    <span className="text-3xl" aria-hidden="true">▼</span>
                    <span className="mt-1 text-[10px] font-black tracking-wider">
                      INFERIORIDAD
                    </span>
                  </button>
                );
              }
              const player = session.players.find(
                (candidate) => candidate.id === slotId,
              );
              if (!player) {
                return null;
              }
              const selected = selectedPlayerId === player.id;
              const minutes = replay.playerMinutes[player.id];
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (mode === "substitution" || threatSide === "FOR") {
                      selectPlayer(player.id);
                    }
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
            <div className="grid gap-2 lg:grid-cols-[1.15fr_1.35fr_auto]">
              {(["PRIMARY", "SECONDARY", "RARE"] as const).map((tier) => (
                <div
                  key={tier}
                  className={
                    tier === "PRIMARY"
                      ? "grid grid-cols-2 gap-2"
                      : tier === "SECONDARY"
                        ? "grid grid-cols-4 gap-1.5"
                        : "grid grid-cols-2 gap-1.5"
                  }
                >
                  {PHASE_OPTIONS.filter((option) => option.tier === tier).map(
                    (option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={
                          mode !== "threat" ||
                          (threatSide === "FOR" && !selectedPlayerId) ||
                          !origin
                        }
                        onClick={() => setPhase(option.value)}
                        title={option.label}
                        aria-label={option.label}
                        className={`flex flex-col items-center justify-center rounded-xl border font-semibold transition-all disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-700 ${
                          tier === "PRIMARY"
                            ? "min-h-20 px-2 py-2"
                            : tier === "SECONDARY"
                              ? "min-h-16 px-1 py-1.5"
                              : "min-h-11 min-w-14 px-1 py-1"
                        } ${
                          phase === option.value
                            ? PHASE_TONES[option.tone].active
                            : PHASE_TONES[option.tone].idle
                        }`}
                        aria-pressed={phase === option.value}
                      >
                        <span
                          className={
                            tier === "PRIMARY"
                              ? "text-3xl font-black leading-none"
                              : tier === "SECONDARY"
                                ? "text-xl font-black leading-none"
                                : "text-xs font-black leading-none"
                          }
                          aria-hidden="true"
                        >
                          {option.icon}
                        </span>
                        <span className={`${tier === "PRIMARY" ? "mt-2 text-xs" : "mt-1 text-[10px]"} leading-none`}>
                          {option.shortLabel}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {OUTCOME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={
                  mode !== "threat" ||
                  (threatSide === "FOR" && !selectedPlayerId) ||
                  !origin ||
                  !phase
                }
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

          <DisciplineControls
            players={session.players}
            onCourtPlayerIds={replay.onCourtPlayerIds}
            benchPlayerIds={replay.benchPlayerIds}
            discipline={chronologyReplay.discipline}
            periodDiscipline={periodDiscipline}
            period={session.period}
            onFoul={(side, playerId) => recordFoul(matchId, side, playerId)}
            onCard={(side, color, playerId, causesInferiority) =>
              recordCard(
                matchId,
                side,
                color,
                playerId,
                causesInferiority,
              )
            }
          />
        </section>

        <RecentEventsPanel
          events={recentEvents}
          timeline={chronologyReplay.timeline}
          players={session.players}
          onDelete={(eventId) => softDeleteEvent(matchId, eventId)}
          onRestore={(eventId) => restoreEvent(matchId, eventId)}
          onSave={(eventId, target, changes) =>
            editAndReorderEvent(matchId, eventId, target, changes)
          }
          onMoveWithinMinute={(
            eventId,
            targetEventId,
            placement,
          ) =>
            moveEventWithinMinute(
              matchId,
              eventId,
              targetEventId,
              placement,
            )
          }
        />
      </main>
    </div>
  );
}

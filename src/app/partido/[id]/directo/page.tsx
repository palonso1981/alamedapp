"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";

import { FutsalCourtMarkings } from "../../../../components/court/FutsalCourtMarkings";
import { BenchPanel } from "../../../../components/match/BenchPanel";
import { DisciplineControls } from "../../../../components/match/DisciplineControls";
import { HistoryControls } from "../../../../components/match/HistoryControls";
import {
  ClockSide,
  MatchClockControl,
} from "../../../../components/match/MatchClockControl";
import { MatchScoreboard } from "../../../../components/match/MatchScoreboard";
import { RecentEventsPanel } from "../../../../components/match/RecentEventsPanel";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { eventDescription } from "../../../../lib/eventPresentation";
import {
  IDLE_LIVE_INTERACTION,
  LiveInteractionAction,
  LiveInteractionState,
  reduceLiveInteraction,
} from "../../../../lib/liveInteraction";
import { replayMatch, sortEvents } from "../../../../lib/matchEngine";
import { useMatchStore } from "../../../../store/useMatchStore";
import {
  INFERIORITY_SLOT_ID,
  LiveThreatOutcome,
  LiveThreatPhase,
  MatchEvent,
  Player,
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

  const [interaction, setInteraction] = useState<LiveInteractionState>(
    IDLE_LIVE_INTERACTION,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [clockSide, setClockSide] = useState<ClockSide>("right");

  useEffect(() => {
    const savedSide = window.localStorage.getItem(CLOCK_SIDE_STORAGE_KEY);
    if (savedSide === "left" || savedSide === "right") {
      setClockSide(savedSide);
    }
  }, []);

  useEffect(() => {
    ensureMatch(matchId);
    setInteraction(IDLE_LIVE_INTERACTION);
    setFeedback(null);
  }, [ensureMatch, matchId]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 1_800);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

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
  const selectedPlayerId =
    interaction.kind === "PLAYER_SELECTED"
      ? interaction.playerId
      : interaction.kind === "THREAT_PENDING"
        ? interaction.playerId ?? null
        : null;
  const pendingThreat =
    interaction.kind === "THREAT_PENDING" ? interaction : null;
  const substitutionSourceLabel =
    interaction.kind === "PLAYER_SELECTED"
      ? interaction.playerId === INFERIORITY_SLOT_ID
        ? "INFERIORIDAD"
        : session.players.find(
            (player) => player.id === interaction.playerId,
          )?.name
      : undefined;

  const updateClockSide = (side: ClockSide) => {
    setClockSide(side);
    window.localStorage.setItem(CLOCK_SIDE_STORAGE_KEY, side);
  };

  const applyInteraction = (action: LiveInteractionAction) => {
    clearError(matchId);
    const transition = reduceLiveInteraction(interaction, action);
    const effect = transition.effect;
    setInteraction(transition.state);

    if (effect?.type === "RECORD_SUBSTITUTION") {
      swapPlayer(
        matchId,
        effect.playerOutId,
        effect.playerInId,
      );
      const playerOut = session.players.find(
        (player) => player.id === effect.playerOutId,
      );
      const playerIn = session.players.find(
        (player) => player.id === effect.playerInId,
      );
      setFeedback(
        `✓ ${playerOut?.name ?? "INFERIORIDAD"} → ${playerIn?.name ?? "jugador"}`,
      );
    } else if (effect?.type === "RECORD_THREAT") {
      recordThreat(matchId, effect);
      const actor = effect.playerId
        ? session.players.find(
            (player) => player.id === effect.playerId,
          )?.name
        : "RIV";
      setFeedback(`✓ ${effect.outcome} · ${actor ?? "CDA"}`);
    }
  };

  const handleCourtClick = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    applyInteraction({
      type: "COURT_TAPPED",
      origin: { x, y },
      defaultPhase: replay.flyingGoalkeeperActive
        ? "FLYING_GOALKEEPER"
        : undefined,
    });
  };

  return (
    <div
      className={`min-h-screen overflow-x-hidden bg-gray-950 p-3 pb-28 font-sans text-white sm:p-4 sm:pb-4 ${
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
        onPeriodChange={(period) => {
          setInteraction(IDLE_LIVE_INTERACTION);
          changePeriod(matchId, period);
        }}
      />
      {feedback && (
        <div
          role="status"
          className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-emerald-300/50 bg-emerald-950/95 px-4 py-2 text-sm font-black text-emerald-100 shadow-2xl"
        >
          {feedback}
        </div>
      )}
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
          onUndo={() => {
            setInteraction(IDLE_LIVE_INTERACTION);
            undo(matchId);
          }}
          onRedo={() => {
            setInteraction(IDLE_LIVE_INTERACTION);
            redo(matchId);
          }}
        />
      </div>

      <div className="mx-auto mb-4 grid max-w-7xl grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => {
            setInteraction(IDLE_LIVE_INTERACTION);
            toggleGameState(matchId, "SUPERIORITY");
          }}
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
          onClick={() => {
            setInteraction(IDLE_LIVE_INTERACTION);
            toggleGameState(matchId, "FLYING_GOALKEEPER");
          }}
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

      <main className="mx-auto grid max-w-screen-2xl gap-3 md:grid-cols-2 lg:grid-cols-[210px_minmax(0,1fr)_230px]">
        <div className="order-2 min-w-0 md:col-span-1 lg:order-1 lg:col-start-1 lg:row-start-1">
          <BenchPanel
            players={bench}
            playerMinutes={replay.playerMinutes}
            replacementForLabel={substitutionSourceLabel}
            onPlayerTap={(playerId) =>
              applyInteraction({ type: "BENCH_PLAYER_TAPPED", playerId })
            }
          />
        </div>

        <section className="order-1 min-w-0 rounded-2xl bg-gray-900 p-3 shadow-xl md:col-span-2 sm:p-4 lg:order-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
          <div className="mb-3 flex min-h-12 items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold">Pista</h2>
              {interaction.kind === "IDLE" ? (
                <div className="mt-1 flex gap-3 text-lg text-slate-500" aria-label="Jugador a pista para ataque; jugador a banquillo para cambio; pista directamente para rival">
                  <span title="Jugador → pista">●→◎</span>
                  <span title="Jugador → banquillo">●→⇄</span>
                  <span title="Pista → rival">◎→↓</span>
                </div>
              ) : interaction.kind === "PLAYER_SELECTED" ? (
                <p className="truncate text-sm font-bold text-amber-300">
                  {substitutionSourceLabel} <span aria-hidden="true">→ ◎ / ⇄</span>
                </p>
              ) : (
                <p className={`text-sm font-black ${pendingThreat?.side === "FOR" ? "text-cyan-300" : "text-rose-300"}`}>
                  {pendingThreat?.side === "FOR" ? "↑ CDA" : "↓ RIV"} · ◎
                </p>
              )}
            </div>
            {interaction.kind !== "IDLE" && (
              <button
                type="button"
                onClick={() => applyInteraction({ type: "CANCEL" })}
                className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-slate-800 text-2xl text-slate-300"
                aria-label="Cancelar acción pendiente"
              >
                ×
              </button>
            )}
          </div>

          <div
            onClick={handleCourtClick}
            className={`relative min-h-[350px] cursor-crosshair overflow-hidden rounded-2xl border-4 bg-[#075a9c] sm:min-h-[440px] ${
              pendingThreat?.side === "AGAINST"
                ? "border-rose-300/90 shadow-[0_0_24px_rgba(244,63,94,0.14)]"
                : interaction.kind === "PLAYER_SELECTED"
                  ? "border-amber-200/90 shadow-[0_0_24px_rgba(251,191,36,0.14)]"
                  : "border-white/80"
            }`}
            aria-label="Pista de fútbol sala. Toca directamente para amenaza rival o selecciona antes un jugador CDA."
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
                      applyInteraction({
                        type: "COURT_PLAYER_TAPPED",
                        playerId: slotId,
                      });
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
              if (!player) return null;
              const selected = selectedPlayerId === player.id;
              const minutes = replay.playerMinutes[player.id];
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    applyInteraction({
                      type: "COURT_PLAYER_TAPPED",
                      playerId: player.id,
                    });
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

            {pendingThreat && (
              <div
                className={`pointer-events-none absolute z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_0_6px_rgba(255,255,255,0.22)] ${
                  pendingThreat.side === "FOR" ? "bg-cyan-400" : "bg-rose-500"
                }`}
                style={{ left: `${pendingThreat.origin.x * 100}%`, top: `${pendingThreat.origin.y * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>

          {pendingThreat && (
            <section
              className="mt-3 rounded-2xl border border-slate-700 bg-slate-950 p-2.5 shadow-xl"
              aria-label="Completar amenaza"
            >
              <div className="grid grid-cols-3 gap-2">
                {OUTCOME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      applyInteraction({
                        type: "OUTCOME_SELECTED",
                        outcome: option.value,
                      })
                    }
                    className={`min-h-16 rounded-xl px-2 text-sm font-black shadow-md transition-all ${
                      pendingThreat.outcome === option.value
                        ? "ring-4 ring-white/70"
                        : ""
                    } ${option.className}`}
                    aria-pressed={pendingThreat.outcome === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-[1.15fr_1.35fr_auto]">
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
                          onClick={() =>
                            applyInteraction({
                              type: "PHASE_SELECTED",
                              phase: option.value,
                            })
                          }
                          title={option.label}
                          aria-label={option.label}
                          className={`flex flex-col items-center justify-center rounded-xl border font-semibold transition-all ${
                            tier === "PRIMARY"
                              ? "min-h-20 px-2 py-2"
                              : tier === "SECONDARY"
                                ? "min-h-16 px-1 py-1.5"
                                : "min-h-11 min-w-14 px-1 py-1"
                          } ${
                            pendingThreat.phase === option.value
                              ? PHASE_TONES[option.tone].active
                              : PHASE_TONES[option.tone].idle
                          }`}
                          aria-pressed={pendingThreat.phase === option.value}
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
            </section>
          )}
        </section>

        <div className="order-3 min-w-0 md:col-span-1 lg:col-start-3 lg:row-start-1">
          <DisciplineControls
            players={session.players}
            onCourtPlayerIds={replay.onCourtPlayerIds}
            benchPlayerIds={replay.benchPlayerIds}
            discipline={chronologyReplay.discipline}
            periodDiscipline={periodDiscipline}
            period={session.period}
            onInteractionStart={() => setInteraction(IDLE_LIVE_INTERACTION)}
            onFoul={(side, playerId) => recordFoul(matchId, side, playerId)}
            onCard={(side, color, playerId, causesInferiority) =>
              recordCard(matchId, side, color, playerId, causesInferiority)
            }
          />
        </div>

        <div className="order-4 min-w-0 md:col-span-2 lg:col-span-3">
          <RecentEventsPanel
            events={recentEvents}
            timeline={chronologyReplay.timeline}
            players={session.players}
            onDelete={(eventId) => softDeleteEvent(matchId, eventId)}
            onRestore={(eventId) => restoreEvent(matchId, eventId)}
            onSave={(eventId, target, changes) =>
              editAndReorderEvent(matchId, eventId, target, changes)
            }
            onMoveWithinMinute={(eventId, targetEventId, placement) =>
              moveEventWithinMinute(
                matchId,
                eventId,
                targetEventId,
                placement,
              )
            }
          />
        </div>
      </main>
    </div>
  );
}

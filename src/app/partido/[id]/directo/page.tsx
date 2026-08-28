"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";

import { FutsalCourtMarkings } from "../../../../components/court/FutsalCourtMarkings";
import { BenchPanel } from "../../../../components/match/BenchPanel";
import { ContextualSurface } from "../../../../components/match/contextual/ContextualSurface";
import { DefensiveThreatContext } from "../../../../components/match/contextual/DefensiveThreatContext";
import { PlayerContextActions } from "../../../../components/match/contextual/PlayerContextActions";
import { ThreatContextPicker } from "../../../../components/match/contextual/ThreatContextPicker";
import { HistoryControls } from "../../../../components/match/HistoryControls";
import { LineupFirewallAlert } from "../../../../components/match/LineupFirewallAlert";
import {
  ClockSide,
  ClockVerticalSlot,
  MatchClockControl,
} from "../../../../components/match/MatchClockControl";
import { MatchScoreboard } from "../../../../components/match/MatchScoreboard";
import {
  DisciplineFocusRequest,
  RecentEventsPanel,
} from "../../../../components/match/RecentEventsPanel";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { normalizeCourtPoint } from "../../../../lib/courtGeometry";
import { eventDescription } from "../../../../lib/eventPresentation";
import {
  IDLE_LIVE_INTERACTION,
  LiveInteractionAction,
  LiveInteractionState,
  reduceLiveInteraction,
} from "../../../../lib/liveInteraction";
import { replayMatch, sortEvents } from "../../../../lib/matchEngine";
import { assistCandidates } from "../../../../lib/matchReview";
import {
  CLEAN_GOAL_DEMO_MATCH_ID,
  useMatchStore,
} from "../../../../store/useMatchStore";
import {
  INFERIORITY_SLOT_ID,
  MatchEvent,
  Player,
} from "../../../../types";

const CLOCK_SIDE_STORAGE_KEY = "alamedapp:directo-clock-side:v1";
const CLOCK_VERTICAL_STORAGE_KEY = "alamedapp:directo-clock-vertical:v1";
/** La competición debe inyectar sus umbrales; localmente no se presupone ninguno. */
const FOUL_THRESHOLDS: readonly number[] = [];

const OUTFIELD_POSITIONS = [
  { x: 0.56, y: 0.16 },
  { x: 0.56, y: 0.84 },
  { x: 0.79, y: 0.18 },
  { x: 0.79, y: 0.82 },
];
const GOALKEEPER_POSITION = { x: 0.085, y: 0.5 };

function courtPlayerPosition(
  slotId: string,
  onCourtIds: readonly string[],
  players: readonly Player[],
) {
  const keeperId = onCourtIds.find((id) =>
    players.find((player) => player.id === id)?.position
      ?.toUpperCase()
      .includes("PORTERO"),
  );
  if (slotId === keeperId) return GOALKEEPER_POSITION;
  const outfieldIds = onCourtIds.filter((id) => id !== keeperId);
  return OUTFIELD_POSITIONS[outfieldIds.indexOf(slotId)] ?? OUTFIELD_POSITIONS[0];
}

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
  const recordStaffCard = useMatchStore((state) => state.recordStaffCard);
  const setPendingReview = useMatchStore((state) => state.setPendingReview);
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
  const resetCleanDemo = useMatchStore((state) => state.resetCleanDemo);

  const [interaction, setInteraction] = useState<LiveInteractionState>(
    IDLE_LIVE_INTERACTION,
  );
  const [redDecisionPlayerId, setRedDecisionPlayerId] = useState<string | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [clockSide, setClockSide] = useState<ClockSide>("right");
  const [clockVerticalSlot, setClockVerticalSlot] = useState<ClockVerticalSlot>("center");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [disciplineFocus, setDisciplineFocus] = useState<DisciplineFocusRequest | null>(null);
  const [selectingFlyingGoalkeeper, setSelectingFlyingGoalkeeper] = useState(false);

  useEffect(() => {
    const savedSide = window.localStorage.getItem(CLOCK_SIDE_STORAGE_KEY);
    if (savedSide === "left" || savedSide === "right") {
      setClockSide(savedSide);
    }
    const savedVertical = window.localStorage.getItem(CLOCK_VERTICAL_STORAGE_KEY);
    if (savedVertical === "top" || savedVertical === "center" || savedVertical === "bottom") {
      setClockVerticalSlot(savedVertical);
    }
  }, []);

  useEffect(() => {
    ensureMatch(matchId);
    setInteraction(IDLE_LIVE_INTERACTION);
    setRedDecisionPlayerId(null);
    setFeedback(null);
    setSelectedStaffId(null);
    setSelectingFlyingGoalkeeper(false);
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
            foulAccumulationRules: { thresholds: FOUL_THRESHOLDS },
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
    ? `${eventDescription(targetForUndo, session.players, targetUndoEntry, session.staff)} ${targetForUndo.minute}'`
    : "última acción";
  const selectedPlayerId =
    interaction.kind === "PLAYER_SELECTED"
      ? interaction.playerId
      : interaction.kind === "THREAT_PENDING"
        ? interaction.playerId ?? null
        : null;
  const selectedCourtPlayerId =
    interaction.kind === "PLAYER_SELECTED" && interaction.location === "COURT"
      ? interaction.playerId
      : null;
  const selectedBenchPlayerId =
    interaction.kind === "PLAYER_SELECTED" && interaction.location === "BENCH"
      ? interaction.playerId
      : null;
  const selectedCourtAnchor = selectedCourtPlayerId
    ? courtPlayerPosition(
        selectedCourtPlayerId,
        replay.onCourtPlayerIds,
        session.players,
      )
    : undefined;
  const pendingThreat =
    interaction.kind === "THREAT_PENDING" ? interaction : null;
  const substitutionSourceLabel =
    interaction.kind === "PLAYER_SELECTED" && interaction.location === "COURT"
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

  const updateClockVerticalSlot = (slot: ClockVerticalSlot) => {
    setClockVerticalSlot(slot);
    window.localStorage.setItem(CLOCK_VERTICAL_STORAGE_KEY, slot);
  };

  const captureBlocked = replay.lineupValidation.captureBlocked;
  const blockedAction = () => {
    setFeedback("⚠ Corrige la alineación antes de registrar otra acción");
  };

  const applyInteraction = (action: LiveInteractionAction) => {
    const repairAction =
      action.type === "CANCEL" ||
      action.type === "END_SEQUENCE" ||
      action.type === "COURT_PLAYER_TAPPED" ||
      action.type === "BENCH_PLAYER_TAPPED";
    if (captureBlocked && !repairAction) {
      blockedAction();
      return;
    }
    clearError(matchId);
    setSelectedStaffId(null);
    setRedDecisionPlayerId(null);
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
    applyInteraction({
      type: "COURT_TAPPED",
      origin: normalizeCourtPoint(event.clientX, event.clientY, bounds),
      eventId: globalThis.crypto.randomUUID(),
    });
  };

  const handleStaffTap = (staffId: string) => {
    setInteraction(IDLE_LIVE_INTERACTION);
    setRedDecisionPlayerId(null);
    setSelectedStaffId((current) => current === staffId ? null : staffId);
  };

  const handleStaffCard = (staffId: string, color: "YELLOW" | "RED") => {
    recordStaffCard(matchId, staffId, color);
    setSelectedStaffId(null);
    setFeedback(color === "YELLOW" ? "✓ Amarilla cuerpo técnico" : "✓ Roja cuerpo técnico");
  };

  const finishPlayerAction = (message: string) => {
    setInteraction(IDLE_LIVE_INTERACTION);
    setRedDecisionPlayerId(null);
    setFeedback(message);
  };

  const recordPlayerFoul = (playerId: string, received: boolean) => {
    recordFoul(matchId, received ? "AGAINST" : "FOR", playerId);
    finishPlayerAction(received ? "✓ Falta recibida" : "✓ Falta cometida");
  };

  const recordPlayerCard = (
    playerId: string,
    color: "YELLOW" | "RED",
    causesInferiority = false,
  ) => {
    recordCard(matchId, "FOR", color, playerId, causesInferiority);
    finishPlayerAction(
      color === "YELLOW"
        ? "✓ Amarilla CDA"
        : causesInferiority
          ? "✓ Roja + 4v5"
          : "✓ Roja CDA",
    );
  };

  return (
    <div
      className={`directo-page min-h-screen overflow-x-hidden bg-gray-950 p-3 pb-28 font-sans text-white sm:p-4 sm:pb-4 ${
        clockSide === "left" ? "sm:pl-28" : "sm:pr-28"
      }`}
    >
      <MatchClockControl
        period={session.period}
        minute={session.minute}
        side={clockSide}
        onSideChange={updateClockSide}
        verticalSlot={clockVerticalSlot}
        onVerticalSlotChange={updateClockVerticalSlot}
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
      <header className="mx-auto mb-2 flex max-w-7xl flex-wrap items-center justify-between gap-2 border-b border-gray-700 pb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Partido {matchId}
          </p>
          <h1 className="text-xl font-bold">Directo: CD Alameda</h1>
        </div>

        <div className="flex items-center gap-1.5">
          <MatchScoreboard
            score={chronologyReplay.score}
            period={session.period}
            periodFor={periodDiscipline.for}
            periodAgainst={periodDiscipline.against}
            totalFor={chronologyReplay.discipline.for}
            totalAgainst={chronologyReplay.discipline.against}
            foulThresholds={FOUL_THRESHOLDS}
            onInspect={(side, kind) => setDisciplineFocus({ token: Date.now(), side, kind, period: session.period })}
            onRivalYellow={() => {
              if (captureBlocked) return blockedAction();
              setInteraction(IDLE_LIVE_INTERACTION);
              recordCard(matchId, "AGAINST", "YELLOW");
              setFeedback("✓ Amarilla RIV");
            }}
            onRivalRed={() => {
              if (captureBlocked) return blockedAction();
              setInteraction(IDLE_LIVE_INTERACTION);
              recordCard(matchId, "AGAINST", "RED");
              setFeedback("✓ Roja RIV");
            }}
          />
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
          {matchId === CLEAN_GOAL_DEMO_MATCH_ID && (
            <button type="button" onClick={() => {
              if (!window.confirm("¿Reiniciar solo el demo prueba-porteria?")) return;
              setInteraction(IDLE_LIVE_INTERACTION);
              resetCleanDemo(matchId);
            }} className="min-h-10 rounded-lg bg-slate-900 px-2 text-xs font-bold text-slate-400" aria-label="Reiniciar demo de portería">↺ DEMO</button>
          )}
        </div>
      </header>

      <div className="mx-auto mb-2 grid max-w-7xl grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => {
            if (captureBlocked) return blockedAction();
            setInteraction(IDLE_LIVE_INTERACTION);
            toggleGameState(matchId, "SUPERIORITY");
          }}
          className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition-all ${
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
            if (replay.flyingGoalkeeperActive) {
              toggleGameState(matchId, "FLYING_GOALKEEPER");
              setSelectingFlyingGoalkeeper(false);
            } else {
              setSelectingFlyingGoalkeeper((visible) => !visible);
            }
          }}
          className={`rounded-xl border-2 px-3 py-2 text-sm font-black transition-all ${
            replay.flyingGoalkeeperActive
              ? "border-rose-300 bg-rose-600 text-white"
              : "border-gray-800 bg-gray-900 text-gray-500"
          }`}
          aria-pressed={replay.flyingGoalkeeperActive}
        >
          ◇⁺ {replay.flyingGoalkeeperActive ? "P-J ACTIVO" : "Portero-jugador"}
        </button>
        <div
          className={`rounded-xl border-2 px-3 py-2 text-center text-sm font-black ${
            replay.inferiorityActive
              ? "border-red-300 bg-red-950 text-red-200"
              : "border-gray-900 bg-gray-950 text-gray-700"
          }`}
        >
          {replay.inferiorityActive ? "▼ INFERIORIDAD" : "5v5"}
        </div>
      </div>

      {selectingFlyingGoalkeeper && !replay.flyingGoalkeeperActive && (
        <div className="mx-auto mb-2 max-w-3xl rounded-2xl border border-rose-400/60 bg-rose-950/80 p-2 shadow-xl" role="dialog" aria-label="Elegir portero-jugador funcional">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-black uppercase tracking-wide text-rose-100">¿Quién asume la portería?</p>
            <button type="button" onClick={() => setSelectingFlyingGoalkeeper(false)} className="min-h-10 min-w-10 rounded-xl bg-slate-800 text-lg" aria-label="Cancelar selección">×</button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {replay.onCourtPlayerIds
              .filter((id) => id !== INFERIORITY_SLOT_ID)
              .map((id) => session.players.find((player) => player.id === id))
              .filter((player): player is Player => Boolean(player))
              .map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => {
                    toggleGameState(matchId, "FLYING_GOALKEEPER", player.id);
                    setSelectingFlyingGoalkeeper(false);
                    setFeedback(`◇⁺ ${player.name}`);
                  }}
                  className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-rose-300/40 bg-slate-900 px-1 py-2 font-bold hover:bg-rose-900"
                >
                  <PlayerAvatar player={player} compact />
                  <span className="mt-1 max-w-full truncate text-[10px]">{player.name}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      <LineupFirewallAlert validation={replay.lineupValidation} players={session.players} />

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

      <main className="directo-workspace mx-auto grid max-w-screen-2xl gap-2">
        <section className="directo-court-panel relative min-w-0 rounded-2xl bg-gray-900 p-2 shadow-xl sm:p-3">
          <div className="directo-court-heading mb-2 flex min-h-10 items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-bold">Pista</h2>
              {interaction.kind === "IDLE" ? (
                <div className="mt-1 flex gap-3 text-lg text-slate-500" aria-label="Jugador a pista para ataque; jugador a banquillo para cambio; pista directamente para rival">
                  <span title="Jugador → pista">●→◎</span>
                  <span title="Jugador → banquillo">●→⇄</span>
                  <span title="Pista → rival">◎→↓</span>
                </div>
              ) : interaction.kind === "PLAYER_SELECTED" && interaction.location === "COURT" ? (
                <p className="truncate text-sm font-bold text-amber-300">
                  {substitutionSourceLabel} <span aria-hidden="true">→ ◎ / ⇄</span>
                </p>
              ) : interaction.kind === "PLAYER_SELECTED" ? (
                <p className="truncate text-sm font-bold text-cyan-300">
                  Banquillo · tarjeta
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
            data-testid="futsal-court"
            className={`directo-court relative mx-auto aspect-[2/1] w-full cursor-crosshair overflow-hidden rounded-2xl border-4 bg-[#075a9c] ${
              pendingThreat?.side === "AGAINST"
                ? "border-rose-300/90 shadow-[0_0_24px_rgba(244,63,94,0.14)]"
                : interaction.kind === "PLAYER_SELECTED"
                  ? "border-amber-200/90 shadow-[0_0_24px_rgba(251,191,36,0.14)]"
                  : "border-white/80"
            }`}
            aria-label="Pista de fútbol sala. Toca directamente para amenaza rival o selecciona antes un jugador CDA."
          >
            <FutsalCourtMarkings />
            <span className="pointer-events-none absolute bottom-2 left-1/2 z-[1] -translate-x-1/2 rounded-full bg-slate-950/35 px-3 py-1 text-[10px] font-black tracking-[0.2em] text-white/55" aria-hidden="true">CDA →</span>

            {replay.onCourtPlayerIds.map((slotId) => {
              const position = courtPlayerPosition(
                slotId,
                replay.onCourtPlayerIds,
                session.players,
              );
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
                    className={`absolute z-10 flex min-h-14 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border-2 border-dashed px-1 py-1 text-center shadow-lg sm:min-h-20 sm:w-20 lg:w-24 ${
                      selected
                        ? "scale-110 border-white bg-red-500 text-white"
                        : "border-red-300 bg-red-950/90 text-red-200"
                    }`}
                    style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
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
                  className={`absolute z-10 flex min-h-16 w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border-2 px-1 py-1 text-center shadow-lg transition-all sm:min-h-20 sm:w-20 lg:w-24 ${
                    selected
                      ? "scale-110 border-yellow-200 bg-yellow-500 text-gray-950 ring-4 ring-yellow-300/30"
                      : "border-white/60 bg-gray-900/90 hover:bg-gray-800"
                  }`}
                  style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
                  aria-pressed={selected}
                >
                  <PlayerAvatar player={player} selected={selected} compact />
                  <span className="mt-1 hidden max-w-full truncate text-xs font-semibold sm:block">{player.name}</span>
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

            {selectedCourtPlayerId &&
              selectedCourtPlayerId !== INFERIORITY_SLOT_ID &&
              selectedCourtAnchor && (
                <ContextualSurface
                  anchor={selectedCourtAnchor}
                  label="Acciones del jugador seleccionado"
                  onCancel={() => applyInteraction({ type: "CANCEL" })}
                  compact
                >
                  <PlayerContextActions
                    location="COURT"
                    captureBlocked={captureBlocked}
                    redDecision={redDecisionPlayerId === selectedCourtPlayerId}
                    onFoulCommitted={() => recordPlayerFoul(selectedCourtPlayerId, false)}
                    onFoulReceived={() => recordPlayerFoul(selectedCourtPlayerId, true)}
                    onYellow={() => recordPlayerCard(selectedCourtPlayerId, "YELLOW")}
                    onRed={() => setRedDecisionPlayerId(selectedCourtPlayerId)}
                    onRedOnly={() => recordPlayerCard(selectedCourtPlayerId, "RED")}
                    onRedWithInferiority={() => recordPlayerCard(selectedCourtPlayerId, "RED", true)}
                    onBack={() => setRedDecisionPlayerId(null)}
                    onCancel={() => applyInteraction({ type: "CANCEL" })}
                  />
                </ContextualSurface>
              )}

            {pendingThreat && (
              <div
                className={`pointer-events-none absolute z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_0_6px_rgba(255,255,255,0.22)] ${
                  pendingThreat.side === "FOR" ? "bg-cyan-400" : "bg-rose-500"
                }`}
                style={{ left: `${pendingThreat.origin.x * 100}%`, top: `${pendingThreat.origin.y * 100}%` }}
                aria-hidden="true"
              />
            )}

            {pendingThreat?.side === "FOR" && (
              <ThreatContextPicker
                threat={pendingThreat}
                players={session.players}
                assistCandidateIds={assistCandidates(replay.onCourtPlayerIds, pendingThreat.playerId)}
                onOutcome={(outcome) =>
                  applyInteraction({ type: "OUTCOME_SELECTED", outcome })
                }
                onPhase={(phase) =>
                  applyInteraction({ type: "PHASE_SELECTED", phase })
                }
                onAssist={(assist) =>
                  applyInteraction({ type: "ASSIST_SELECTED", assist })
                }
                onCancel={() => applyInteraction({ type: "CANCEL" })}
              />
            )}
            {pendingThreat?.side === "AGAINST" && (
              <DefensiveThreatContext
                threat={pendingThreat}
                onTarget={(goalTarget, outcome, keeperBodyZone) =>
                  applyInteraction({
                    type: "GOAL_TARGET_SELECTED",
                    goalTarget,
                    outcome,
                    keeperBodyZone,
                  })
                }
                onSaveOutcome={(saveOutcome) =>
                  applyInteraction({ type: "SAVE_OUTCOME_SELECTED", saveOutcome })
                }
                onPhase={(phase) =>
                  applyInteraction({ type: "PHASE_SELECTED", phase })
                }
                onCancel={() => applyInteraction({ type: "CANCEL" })}
              />
            )}
            {interaction.kind === "SECOND_PLAY_OFFER" && (
              <div className="absolute inset-x-3 bottom-3 z-40 mx-auto grid max-w-sm grid-cols-2 gap-2 rounded-2xl border border-rose-400 bg-slate-950/95 p-2 shadow-2xl">
                <button type="button" onClick={(event) => { event.stopPropagation(); applyInteraction({ type: "START_SECOND_PLAY" }); }} className="min-h-16 rounded-xl bg-rose-600 text-sm font-black">↺ 2ª JUGADA</button>
                <button type="button" onClick={(event) => { event.stopPropagation(); applyInteraction({ type: "END_SEQUENCE" }); }} className="min-h-16 rounded-xl bg-slate-800 text-sm font-black">FIN</button>
              </div>
            )}
            {interaction.kind === "SECOND_PLAY_ARMED" && (
              <div className="pointer-events-none absolute inset-x-6 top-4 z-30 mx-auto max-w-xs rounded-full border border-rose-300 bg-rose-950/90 px-4 py-2 text-center text-xs font-black text-rose-100">↺ marca el nuevo origen</div>
            )}
          </div>
        </section>

        <div className="directo-bench-panel-wrap min-w-0">
          <BenchPanel
            players={bench}
            staff={session.staff}
            replacementForLabel={substitutionSourceLabel}
            selectedPlayerId={selectedBenchPlayerId ?? undefined}
            selectedStaffId={selectedStaffId ?? undefined}
            onPlayerTap={(playerId) => applyInteraction({ type: "BENCH_PLAYER_TAPPED", playerId })}
            onStaffTap={handleStaffTap}
            onYellow={(playerId) => captureBlocked ? blockedAction() : recordPlayerCard(playerId, "YELLOW")}
            onRed={(playerId) => captureBlocked ? blockedAction() : recordPlayerCard(playerId, "RED")}
            onStaffCard={(staffId, color) => captureBlocked ? blockedAction() : handleStaffCard(staffId, color)}
            onCancel={() => { setSelectedStaffId(null); applyInteraction({ type: "CANCEL" }); }}
          />
        </div>

        <div className="directo-timeline-wrap min-w-0">
          <RecentEventsPanel
            events={session.events}
            timeline={chronologyReplay.timeline}
            players={session.players}
            staff={session.staff}
            onDelete={(eventId) => softDeleteEvent(matchId, eventId)}
            onRestore={(eventId) => restoreEvent(matchId, eventId)}
            onPendingReview={(eventId, pending) => setPendingReview(matchId, eventId, pending)}
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
            errorMessage={session.lastError?.startsWith("No se puede eliminar") ? session.lastError : null}
            onDismissError={() => clearError(matchId)}
            disciplineFocusRequest={disciplineFocus}
          />
        </div>
      </main>
    </div>
  );
}

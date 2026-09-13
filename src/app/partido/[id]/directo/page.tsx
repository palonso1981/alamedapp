"use client";

import Link from "next/link";
import { MouseEvent, useEffect, useMemo, useState } from "react";

import { FutsalCourtMarkings } from "../../../../components/court/FutsalCourtMarkings";
import { BenchPanel } from "../../../../components/match/BenchPanel";
import { DefensiveThreatContext } from "../../../../components/match/contextual/DefensiveThreatContext";
import { PlayerContextActions } from "../../../../components/match/contextual/PlayerContextActions";
import { ThreatContextPicker } from "../../../../components/match/contextual/ThreatContextPicker";
import { LivePlayerCard } from "../../../../components/match/LivePlayerCard";
import { LineupFirewallAlert } from "../../../../components/match/LineupFirewallAlert";
import {
  ClockSide,
  ClockVerticalSlot,
} from "../../../../components/match/MatchClockControl";
import { MatchRailControl } from "../../../../components/match/MatchRailControl";
import { MatchScoreboard } from "../../../../components/match/MatchScoreboard";
import { MatchSteamDeck } from "../../../../components/match/MatchSteamDeck";
import { PeriodReviewBanner } from "../../../../components/match/PeriodReviewBanner";
import { SecondPeriodLineupDialog } from "../../../../components/match/SecondPeriodLineupDialog";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import {
  DisciplineFocusRequest,
  RecentEventsPanel,
} from "../../../../components/match/RecentEventsPanel";
import { PlayerAvatar } from "../../../../components/player/PlayerAvatar";
import { ClubContextLabel } from "../../../../components/app/ClubContextLabel";
import { CaptureControlStatus } from "../../../../components/match/CaptureControlStatus";
import { normalizeCourtPoint } from "../../../../lib/courtGeometry";
import {
  AttackDirection,
  canonicalToVisualPoint,
  frontGoalTargetToCanonical,
  oppositeDirection,
  visualRestartToCanonical,
  visualToCanonicalPoint,
} from "../../../../lib/captureOrientation";
import { functionalGoalkeeperBadge } from "../../../../lib/goalkeeperPresentation";
import {
  IDLE_LIVE_INTERACTION,
  LiveInteractionAction,
  LiveInteractionState,
  reduceLiveInteraction,
} from "../../../../lib/liveInteraction";
import {
  proposeSecondPeriodLineup,
  replayMatch,
} from "../../../../lib/matchEngine";
import { assistCandidates } from "../../../../lib/matchReview";
import {
  useMatchStore,
} from "../../../../store/useMatchStore";
import { useCaptureLease } from "../../../../hooks/useCaptureLease";
import {
  INFERIORITY_SLOT_ID,
  CDA_CLUB_ID,
  Player,
} from "../../../../types";

const CLOCK_SIDE_STORAGE_KEY = "alamedapp:directo-clock-side:v1";
const CLOCK_VERTICAL_STORAGE_KEY = "alamedapp:directo-clock-vertical:v1";
const ORIENTATION_STORAGE_PREFIX = "alamedapp:directo-orientation:v1";
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
  functionalGoalkeeperId?: string,
) {
  const keeperId = functionalGoalkeeperId ?? onCourtIds.find((id) =>
    players.find((player) => player.id === id)?.position
      ?.toUpperCase()
      .includes("PORTERO"),
  );
  if (slotId === keeperId) return GOALKEEPER_POSITION;
  const outfieldIds = onCourtIds.filter((id) => id !== keeperId);
  return OUTFIELD_POSITIONS[outfieldIds.indexOf(slotId)] ?? OUTFIELD_POSITIONS[0];
}

function RestartTargets({ onRestart }: { onRestart: (end: "LEFT" | "RIGHT", side: "TOP" | "BOTTOM", kind: "CORNER" | "DANGEROUS_KICK_IN") => void }) {
  const corner = "absolute z-20 grid h-16 w-16 place-items-center rounded-2xl border border-amber-200/35 bg-amber-950/25 text-4xl font-black text-amber-100 shadow-lg shadow-slate-950/25 active:scale-95 sm:h-[4.5rem] sm:w-[4.5rem]";
  const band = "absolute z-20 grid h-12 w-[27%] place-items-center bg-transparent px-1 text-[10px] font-black tracking-wide text-violet-50 active:scale-[.98] before:absolute before:inset-x-1 before:h-1.5 before:rounded-full before:bg-violet-200/90 before:shadow-md before:shadow-violet-950/40 sm:h-14";
  return <>
    <button type="button" onClick={() => onRestart("LEFT", "TOP", "CORNER")} className={`${corner} left-0 top-0`} aria-label="Córner izquierda superior">⌜</button>
    <button type="button" onClick={() => onRestart("RIGHT", "TOP", "CORNER")} className={`${corner} right-0 top-0`} aria-label="Córner derecha superior">⌝</button>
    <button type="button" onClick={() => onRestart("LEFT", "BOTTOM", "CORNER")} className={`${corner} bottom-0 left-0`} aria-label="Córner izquierda inferior">⌞</button>
    <button type="button" onClick={() => onRestart("RIGHT", "BOTTOM", "CORNER")} className={`${corner} bottom-0 right-0`} aria-label="Córner derecha inferior">⌟</button>
    <button type="button" onClick={() => onRestart("LEFT", "TOP", "DANGEROUS_KICK_IN")} className={`${band} left-[8%] top-0`} aria-label="Banda cercana izquierda superior"><span className="relative z-10 rounded-full border border-violet-300/50 bg-violet-950/90 px-3 py-1">BANDA</span></button>
    <button type="button" onClick={() => onRestart("RIGHT", "TOP", "DANGEROUS_KICK_IN")} className={`${band} right-[8%] top-0`} aria-label="Banda cercana derecha superior"><span className="relative z-10 rounded-full border border-violet-300/50 bg-violet-950/90 px-3 py-1">BANDA</span></button>
    <button type="button" onClick={() => onRestart("LEFT", "BOTTOM", "DANGEROUS_KICK_IN")} className={`${band} bottom-0 left-[8%]`} aria-label="Banda cercana izquierda inferior"><span className="relative z-10 rounded-full border border-violet-300/50 bg-violet-950/90 px-3 py-1">BANDA</span></button>
    <button type="button" onClick={() => onRestart("RIGHT", "BOTTOM", "DANGEROUS_KICK_IN")} className={`${band} bottom-0 right-[8%]`} aria-label="Banda cercana derecha inferior"><span className="relative z-10 rounded-full border border-violet-300/50 bg-violet-950/90 px-3 py-1">BANDA</span></button>
  </>;
}

export default function DirectoPage({ params }: { params: { id: string } }) {
  const matchId = params.id;
  const session = useMatchStore((state) => state.matches[matchId]);
  const captureControl = useCaptureLease(matchId, session);
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const incrementMinute = useMatchStore((state) => state.incrementMinute);
  const decrementMinute = useMatchStore((state) => state.decrementMinute);
  const finishCurrentPeriod = useMatchStore((state) => state.finishCurrentPeriod);
  const startSecondPeriod = useMatchStore((state) => state.startSecondPeriod);
  const resumeFirstPeriod = useMatchStore((state) => state.resumeFirstPeriod);
  const startPeriodReview = useMatchStore((state) => state.startPeriodReview);
  const setReviewMinute = useMatchStore((state) => state.setReviewMinute);
  const stopPeriodReview = useMatchStore((state) => state.stopPeriodReview);
  const recordThreat = useMatchStore((state) => state.recordThreat);
  const toggleGameState = useMatchStore((state) => state.toggleGameState);
  const recordFoul = useMatchStore((state) => state.recordFoul);
  const recordPossessionLost = useMatchStore((state) => state.recordPossessionLost);
  const recordRestart = useMatchStore((state) => state.recordRestart);
  const adjustFoulCount = useMatchStore((state) => state.adjustFoulCount);
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
  const resetDemo = useMatchStore((state) => state.resetDemo);

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [genericFoulConfirm, setGenericFoulConfirm] = useState<"FOR" | "AGAINST" | null>(null);
  const [secondPeriodSetupOpen, setSecondPeriodSetupOpen] = useState(false);
  const [benchMode, setBenchMode] = useState<"CLOSED" | "BROWSE" | "CHANGE_OUT" | "CHANGE_IN">("CLOSED");
  const [attackDirection, setAttackDirection] = useState<AttackDirection>("RIGHT");
  const [orientationReady, setOrientationReady] = useState(false);

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
    setSecondPeriodSetupOpen(false);
  }, [ensureMatch, matchId]);

  useEffect(() => {
    if (!session) return;
    const key = `${ORIENTATION_STORAGE_PREFIX}:${matchId}:P${session.period}`;
    const saved = window.localStorage.getItem(key);
    if (saved === "LEFT" || saved === "RIGHT") {
      setAttackDirection(saved);
      setOrientationReady(true);
      return;
    }
    if (session.period === 2) {
      const first = window.localStorage.getItem(`${ORIENTATION_STORAGE_PREFIX}:${matchId}:P1`);
      if (first === "LEFT" || first === "RIGHT") {
        const proposed = oppositeDirection(first);
        setAttackDirection(proposed);
        window.localStorage.setItem(key, proposed);
        setOrientationReady(true);
        return;
      }
    }
    setOrientationReady(false);
  }, [matchId, session]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 1_800);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!genericFoulConfirm) return;
    const timeout = window.setTimeout(() => setGenericFoulConfirm(null), 3_000);
    return () => window.clearTimeout(timeout);
  }, [genericFoulConfirm]);

  const capturePeriod = session?.reviewPeriod ?? session?.period ?? 1;
  const captureMinute = session?.reviewPeriod !== undefined
    ? session.reviewMinute ?? 20
    : session?.minute ?? 0;
  const replay = useMemo(
    () =>
      session
        ? replayMatch(session.players, session.events, {
            currentClock: { period: capturePeriod, minute: captureMinute },
            throughClock: { period: capturePeriod, minute: captureMinute },
            foulAccumulationRules: { thresholds: FOUL_THRESHOLDS },
          })
        : null,
    [captureMinute, capturePeriod, session],
  );

  const activeReplay = useMemo(
    () => session
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
  const secondPeriodProposal = useMemo(
    () =>
      session
        ? proposeSecondPeriodLineup(session.players, session.events)
        : null,
    [session],
  );

  if (!session || !replay || !activeReplay || !chronologyReplay || !secondPeriodProposal) {
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
    capturePeriod
  ] ?? {
    for: { fouls: 0, yellowCards: 0, redCards: 0 },
    against: { fouls: 0, yellowCards: 0, redCards: 0 },
  };
  const activeEventCount = session.events.filter(
    (event) => event.type !== "lineup_initialized" && event.deletedAt === null,
  ).length;
  const pendingEventCount = session.events.filter(
    (event) => event.type !== "lineup_initialized" && event.deletedAt === null && event.pendingReview,
  ).length;
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

  const periodClosed = session.reviewPeriod === undefined && (session.matchFinished || (session.closedPeriods?.includes(session.period) || false));
  const lineupBlocked = replay.lineupValidation.captureBlocked;
  const functionalGoalkeeperId = replay.lineupValidation.goalkeeper.status === "PLAYER"
    ? replay.lineupValidation.goalkeeper.playerId
    : undefined;
  const captureBlocked = lineupBlocked || periodClosed || !captureControl.canCapture;
  const blockedAction = () => {
    setFeedback(
      !captureControl.canCapture
        ? "⚠ No tienes el control de captura"
        : periodClosed
          ? "■ Periodo cerrado"
          : "⚠ Corrige la alineación antes de registrar otra acción",
    );
  };

  const applyInteraction = (action: LiveInteractionAction) => {
    const repairAction =
      action.type === "CANCEL" ||
      action.type === "END_SEQUENCE" ||
      action.type === "COURT_PLAYER_TAPPED" ||
      action.type === "BENCH_PLAYER_TAPPED";
    const harmlessAction = action.type === "CANCEL" || action.type === "END_SEQUENCE";
    if ((!captureControl.canCapture && !harmlessAction) || (periodClosed && !harmlessAction) || (lineupBlocked && !repairAction)) {
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
      setBenchMode("CLOSED");
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
      origin: visualToCanonicalPoint(normalizeCourtPoint(event.clientX, event.clientY, bounds), attackDirection),
      eventId: globalThis.crypto.randomUUID(),
    });
  };

  const chooseOrientation = (direction: AttackDirection) => {
    setAttackDirection(direction);
    window.localStorage.setItem(`${ORIENTATION_STORAGE_PREFIX}:${matchId}:P${session.period}`, direction);
    setOrientationReady(true);
  };

  const flipCourt = () => chooseOrientation(oppositeDirection(attackDirection));

  const quickRestart = (end: "LEFT" | "RIGHT", spatialSide: "TOP" | "BOTTOM", restart: "CORNER" | "DANGEROUS_KICK_IN") => {
    if (captureBlocked) return blockedAction();
    const inferred = visualRestartToCanonical({ end, band: spatialSide, direction: attackDirection });
    recordRestart(matchId, inferred.side, restart, inferred.spatialSide);
    setFeedback(`✓ ${restart === "CORNER" ? "CÓRNER" : "BANDA CERCANA"} ${inferred.side === "FOR" ? "CDA" : "RIV"}`);
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

  const recordPlayerPossessionLost = (playerId: string) => {
    recordPossessionLost(matchId, playerId);
    finishPlayerAction("✓ Pérdida");
  };

  const recordGenericFoul = (side: "FOR" | "AGAINST") => {
    if (captureBlocked) return blockedAction();
    if (genericFoulConfirm !== side) {
      setGenericFoulConfirm(side);
      return;
    }
    recordFoul(matchId, side, null);
    setGenericFoulConfirm(null);
    setFeedback(side === "FOR" ? "✓ Falta CDA · sin asignar" : "✓ Falta recibida · sin asignar");
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
        clockSide === "left" ? "sm:pl-40" : "sm:pr-40"
      }`}
    >
      <CaptureControlStatus control={captureControl} matchId={matchId} />
      {!orientationReady && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/90 p-4" role="dialog" aria-label="Elegir orientación de captura">
          <div className="w-full max-w-2xl rounded-3xl border border-cyan-500 bg-slate-900 p-5 shadow-2xl">
            <p className="mb-5 text-center text-xl font-black">¿HACIA DÓNDE ATACA CDA?</p>
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => chooseOrientation("LEFT")} className="min-h-32 rounded-2xl bg-cyan-700 text-4xl font-black active:scale-95">← <span className="block text-sm">IZQUIERDA</span></button>
              <button type="button" onClick={() => chooseOrientation("RIGHT")} className="min-h-32 rounded-2xl bg-cyan-700 text-4xl font-black active:scale-95">→ <span className="block text-sm">DERECHA</span></button>
            </div>
          </div>
        </div>
      )}
      <MatchRailControl
        period={session.period}
        elapsedMinute={session.minute}
        closedPeriods={session.closedPeriods ?? []}
        matchFinished={session.matchFinished ?? false}
        reviewing={session.reviewPeriod !== undefined}
        side={clockSide}
        onSideChange={updateClockSide}
        verticalSlot={clockVerticalSlot}
        onVerticalSlotChange={updateClockVerticalSlot}
        onIncreaseRemaining={() => captureBlocked ? blockedAction() : decrementMinute(matchId)}
        onDecreaseRemaining={() => captureBlocked ? blockedAction() : incrementMinute(matchId)}
        onFinishPeriod={() => {
          if (captureBlocked) return blockedAction();
          setInteraction(IDLE_LIVE_INTERACTION);
          finishCurrentPeriod(matchId);
          setFeedback(session.period === 1 ? "✓ Primera parte finalizada" : "✓ Partido finalizado");
        }}
        onStartSecondPeriod={() => {
          if (!captureControl.canCapture) return blockedAction();
          setInteraction(IDLE_LIVE_INTERACTION);
          setSecondPeriodSetupOpen(true);
        }}
        onResumeFirstPeriod={() => {
          if (!captureControl.canCapture) return blockedAction();
          setInteraction(IDLE_LIVE_INTERACTION);
          resumeFirstPeriod(matchId);
          setFeedback("↶ Primera parte reanudada");
        }}
      />
      {feedback && (
        <div
          role="status"
          className="fixed left-1/2 top-3 z-[110] flex -translate-x-1/2 items-center gap-3 rounded-full border border-emerald-300/50 bg-emerald-950/95 px-4 py-2 text-sm font-black text-emerald-100 shadow-2xl"
        >
          <span>{feedback}</span>
          <button type="button" onClick={() => { undo(matchId); setFeedback("↶ Deshecho"); }} className="min-h-10 rounded-full bg-white/15 px-3" aria-label="Deshacer la última acción">↶</button>
        </div>
      )}
      {secondPeriodSetupOpen && (
        <SecondPeriodLineupDialog
          players={session.players}
          proposedPlayerIds={secondPeriodProposal.playerIds}
          proposedGoalkeeperId={secondPeriodProposal.goalkeeperPlayerId}
          dismissedPlayerIds={activeReplay.dismissedPlayerIds}
          onCancel={() => setSecondPeriodSetupOpen(false)}
          onConfirm={(playerIds, goalkeeperPlayerId) => {
            startSecondPeriod(matchId, playerIds, goalkeeperPlayerId);
            const updated = useMatchStore.getState().matches[matchId];
            if (updated?.period === 2) {
              setSecondPeriodSetupOpen(false);
              setFeedback("▶ Segunda parte");
            } else if (updated?.lastError) {
              setFeedback(updated.lastError);
            }
          }}
        />
      )}
      <section className="directo-cockpit mx-auto mb-2 max-w-7xl rounded-2xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/partidos" onClick={(event) => {
            event.preventDefault();
            void captureControl.prepareToLeave().finally(() => window.location.assign("/partidos"));
          }} className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-xl border border-cyan-700/70 bg-slate-900 text-lg font-black text-cyan-200 active:scale-95" aria-label="Salir del Directo y volver a Partidos" title="Partidos">⌂</Link>
          <div className="min-w-0">
          <p className="hidden text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-400 xl:block">
            Partido {matchId}
          </p>
          <h1 className="truncate text-xs font-black">CDA</h1>
          <div className="hidden xl:block"><ClubContextLabel clubId={session.preparation?.clubId ?? CDA_CLUB_ID} /></div>
          </div>
        </div>

        <div className="flex w-full flex-col items-center justify-center gap-1.5 sm:w-auto sm:flex-row">
          <MatchScoreboard
            score={chronologyReplay.score}
            period={capturePeriod}
            periodFor={periodDiscipline.for}
            periodAgainst={periodDiscipline.against}
            totalFor={chronologyReplay.discipline.for}
            totalAgainst={chronologyReplay.discipline.against}
            foulThresholds={FOUL_THRESHOLDS}
            onGenericFoul={recordGenericFoul}
            confirmFoulSide={genericFoulConfirm}
            onInspect={(side, kind) => {
              setDisciplineFocus({ token: Date.now(), side, kind, period: capturePeriod });
              setHistoryOpen(true);
            }}
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
          <details className="relative" aria-label="Ajustar contador de faltas">
            <summary className="grid min-h-10 min-w-10 cursor-pointer list-none place-items-center rounded-xl bg-slate-900 text-xs font-black text-slate-400" aria-label="Abrir ajustes de faltas">F±</summary>
            <div className="absolute right-0 top-12 z-50 grid w-48 grid-cols-2 gap-1 rounded-xl border border-slate-600 bg-slate-950 p-2 shadow-2xl">
            {(["FOR", "AGAINST"] as const).map((side) => <div key={side} className="grid grid-cols-2 gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1">
              <span className="col-span-2 text-center text-[9px] font-black text-slate-400">F {side === "FOR" ? "CDA" : "RIV"}</span>
              <button type="button" onClick={() => { adjustFoulCount(matchId, side, -1); setFeedback(`✓ AJUSTE FALTA ${side === "FOR" ? "CDA" : "RIV"} −1`); }} className="min-h-11 min-w-11 rounded-lg bg-slate-700 text-xl font-black" aria-label={`Restar una falta ${side === "FOR" ? "CDA" : "rival"}`}>−</button>
              <button type="button" onClick={() => { adjustFoulCount(matchId, side, 1); setFeedback(`✓ AJUSTE FALTA ${side === "FOR" ? "CDA" : "RIV"} +1`); }} className="min-h-11 min-w-11 rounded-lg bg-amber-600 text-xl font-black text-slate-950" aria-label={`Sumar una falta ${side === "FOR" ? "CDA" : "rival"}`}>+</button>
            </div>)}
            </div>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            title={session.persistenceStatus === "saved" ? "Guardado local" : session.persistenceStatus === "error" ? "Error de guardado local" : "Preparando guardado"}
            aria-label={session.persistenceStatus === "saved" ? "Guardado local" : session.persistenceStatus === "error" ? "Error de guardado local" : "Preparando guardado"}
            className={`grid min-h-10 min-w-10 place-items-center rounded-lg text-lg font-black ${
              session.persistenceStatus === "saved"
                ? "bg-emerald-950 text-emerald-300"
                : session.persistenceStatus === "error"
                  ? "bg-red-950 text-red-300"
                  : "bg-gray-900 text-gray-400"
            }`}
          >
            {session.persistenceStatus === "saved" ? "●" : session.persistenceStatus === "error" ? "!" : "○"}
          </span>
          <SyncStatusBadge matchId={matchId} />
          <button type="button" onClick={() => { setDisciplineFocus(null); setHistoryOpen(true); }} className="min-h-10 rounded-lg bg-slate-950 px-2 text-xs font-black text-cyan-200" aria-label={`Abrir historial completo, ${activeEventCount} eventos`}>≡ {activeEventCount}{pendingEventCount > 0 ? ` · ?${pendingEventCount}` : ""}</button>
          {(matchId === "prueba" || matchId === "prueba-porteria") && (
            <button type="button" onClick={() => {
              if (!window.confirm(`¿Reiniciar solo el demo ${matchId}? Se borrará su captura local.`)) return;
              setInteraction(IDLE_LIVE_INTERACTION);
              setHistoryOpen(false);
              resetDemo(matchId);
            }} className="min-h-11 rounded-lg bg-slate-900 px-2 text-xs font-bold text-slate-400" aria-label="Reiniciar partido demo">↺ DEMO</button>
          )}
        </div>
      </header>

      <MatchSteamDeck
        flyingGoalkeeperFor={activeReplay.flyingGoalkeeperActive}
        flyingGoalkeeperAgainst={activeReplay.flyingGoalkeeperAgainstActive}
        superiority={activeReplay.superiorityActive}
        inferiority={activeReplay.inferiorityActive}
        changeActive={benchMode.startsWith("CHANGE")}
        canUndo={session.past.length > 0}
        canRedo={session.future.length > 0}
        onFlyingGoalkeeperFor={() => {
          if (captureBlocked) return blockedAction();
          setInteraction(IDLE_LIVE_INTERACTION);
          if (replay.flyingGoalkeeperActive) {
            toggleGameState(matchId, "FLYING_GOALKEEPER");
            setSelectingFlyingGoalkeeper(false);
          } else setSelectingFlyingGoalkeeper((visible) => !visible);
        }}
        onFlyingGoalkeeperAgainst={() => {
          if (captureBlocked) return blockedAction();
          toggleGameState(matchId, "FLYING_GOALKEEPER", undefined, "AGAINST");
          setFeedback(activeReplay.flyingGoalkeeperAgainstActive ? "PJ RIVAL OFF" : "PJ RIVAL ON");
        }}
        onSuperiority={() => {
          if (captureBlocked || activeReplay.inferiorityActive) return blockedAction();
          setInteraction(IDLE_LIVE_INTERACTION);
          toggleGameState(matchId, "SUPERIORITY");
          setFeedback(activeReplay.superiorityActive ? "5v4 OFF" : "5v4 ON");
        }}
        onChange={() => { setInteraction(IDLE_LIVE_INTERACTION); setBenchMode("CHANGE_OUT"); }}
        onBench={() => { setInteraction(IDLE_LIVE_INTERACTION); setBenchMode((mode) => mode === "BROWSE" ? "CLOSED" : "BROWSE"); }}
        onFlip={flipCourt}
        onUndo={() => { if (captureBlocked) return blockedAction(); setInteraction(IDLE_LIVE_INTERACTION); undo(matchId); }}
        onRedo={() => { if (captureBlocked) return blockedAction(); setInteraction(IDLE_LIVE_INTERACTION); redo(matchId); }}
      />
      </section>

      {session.matchFinished && session.reviewPeriod === undefined && (
        <section className="mx-auto mb-2 flex max-w-4xl items-center justify-between gap-3 rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3">
          <div><p className="text-sm font-black text-slate-100">PARTIDO FINALIZADO</p><p className="text-[10px] font-bold text-slate-400">La captura está cerrada; la cronología sigue siendo corregible.</p></div>
          <Link href={`/partido/${matchId}/revision`} className="grid min-h-12 place-items-center rounded-xl bg-amber-400 px-4 text-xs font-black text-slate-950">POSTPARTIDO / REVISIÓN</Link>
        </section>
      )}

      {session.reviewPeriod !== undefined && (
        <PeriodReviewBanner
          activePeriod={session.period}
          reviewPeriod={session.reviewPeriod}
          reviewMinute={session.reviewMinute ?? 20}
          matchFinished={session.matchFinished ?? false}
          onMinuteChange={(minute) => {
            setInteraction(IDLE_LIVE_INTERACTION);
            setReviewMinute(matchId, minute);
          }}
          onReturn={() => {
            setInteraction(IDLE_LIVE_INTERACTION);
            stopPeriodReview(matchId);
            setFeedback(`▶ Vuelta a P${session.period}`);
          }}
        />
      )}

      {selectingFlyingGoalkeeper && !replay.flyingGoalkeeperActive && (
        <div className="mx-auto mb-2 max-w-3xl rounded-2xl border border-rose-400/60 bg-rose-950/80 p-2 shadow-xl" role="dialog" aria-label="Elegir portero-jugador funcional">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-black uppercase tracking-wide text-rose-100">¿Quién asume la portería?</p>
            <button type="button" onClick={() => setSelectingFlyingGoalkeeper(false)} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-lg" aria-label="Cancelar selección">×</button>
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

      {benchMode === "CHANGE_OUT" && (
        <div className="mx-auto mb-2 max-w-xl rounded-2xl border-2 border-amber-400 bg-amber-950 px-4 py-3 text-center text-lg font-black text-amber-100">⇄ ELIGE QUIÉN SALE</div>
      )}
      <main className="directo-workspace mx-auto grid max-w-screen-2xl gap-2">
        <section className="directo-court-panel relative min-w-0 rounded-2xl bg-gray-900 p-2 shadow-xl sm:p-3">
          {interaction.kind !== "IDLE" && <div className="directo-court-heading mb-2 flex min-h-10 items-center justify-between gap-3">
            <div className="min-w-0">
              {interaction.kind === "PLAYER_SELECTED" && interaction.location === "COURT" ? (
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
            <button
                type="button"
                onClick={() => applyInteraction({ type: "CANCEL" })}
                className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-slate-800 text-2xl text-slate-300"
                aria-label="Cancelar acción pendiente"
              >
                ×
              </button>
          </div>}

          <div className={`directo-capture-grid grid items-stretch gap-2 ${selectedCourtPlayerId && selectedCourtPlayerId !== INFERIORITY_SLOT_ID ? "directo-capture-grid--player-actions" : ""}`}>
          <aside className="directo-player-rail grid gap-2" aria-label="Jugadores de campo en pista">
            {replay.onCourtPlayerIds.filter((id) => id !== functionalGoalkeeperId).map((slotId) => {
              if (slotId === INFERIORITY_SLOT_ID) return <button key={slotId} type="button" onClick={() => { applyInteraction({ type: "COURT_PLAYER_TAPPED", playerId: slotId }); if (benchMode === "CHANGE_OUT") setBenchMode("CHANGE_IN"); }} className="min-h-16 rounded-xl border-2 border-dashed border-rose-400 bg-rose-950 text-xs font-black text-rose-100">4v5</button>;
              const player = session.players.find((candidate) => candidate.id === slotId);
              if (!player) return null;
              const minutes = replay.playerMinutes[player.id];
              const selected = selectedPlayerId === player.id;
              return <div key={player.id} className="relative min-h-0">
                <button type="button" onClick={() => { applyInteraction({ type: "COURT_PLAYER_TAPPED", playerId: player.id }); if (benchMode === "CHANGE_OUT") setBenchMode("CHANGE_IN"); }} className="h-full w-full min-h-20 active:scale-[.98]" aria-pressed={selected}>
                  <LivePlayerCard player={player} minutes={minutes} selected={selected} />
                </button>
                {selected && <div className="directo-player-popover absolute left-[calc(100%+.5rem)] top-1/2 z-40 hidden w-44 -translate-y-1/2 rounded-2xl border border-amber-300 bg-slate-950 p-2 shadow-2xl sm:block" aria-label="Acciones del jugador seleccionado">
                  <PlayerContextActions location="COURT" captureBlocked={captureBlocked} redDecision={redDecisionPlayerId === player.id} onFoulCommitted={() => recordPlayerFoul(player.id, false)} onFoulReceived={() => recordPlayerFoul(player.id, true)} onPossessionLost={() => recordPlayerPossessionLost(player.id)} onYellow={() => recordPlayerCard(player.id, "YELLOW")} onRed={() => setRedDecisionPlayerId(player.id)} onRedOnly={() => recordPlayerCard(player.id, "RED")} onRedWithInferiority={() => recordPlayerCard(player.id, "RED", true)} onBack={() => setRedDecisionPlayerId(null)} onCancel={() => applyInteraction({ type: "CANCEL" })} />
                </div>}
              </div>;
            })}
          </aside>
          {selectedCourtPlayerId && selectedCourtPlayerId !== INFERIORITY_SLOT_ID && <div className="rounded-2xl border border-amber-300 bg-slate-950 p-2 shadow-2xl sm:hidden" aria-label="Acciones del jugador seleccionado"><PlayerContextActions location="COURT" captureBlocked={captureBlocked} redDecision={redDecisionPlayerId === selectedCourtPlayerId} onFoulCommitted={() => recordPlayerFoul(selectedCourtPlayerId, false)} onFoulReceived={() => recordPlayerFoul(selectedCourtPlayerId, true)} onPossessionLost={() => recordPlayerPossessionLost(selectedCourtPlayerId)} onYellow={() => recordPlayerCard(selectedCourtPlayerId, "YELLOW")} onRed={() => setRedDecisionPlayerId(selectedCourtPlayerId)} onRedOnly={() => recordPlayerCard(selectedCourtPlayerId, "RED")} onRedWithInferiority={() => recordPlayerCard(selectedCourtPlayerId, "RED", true)} onBack={() => setRedDecisionPlayerId(null)} onCancel={() => applyInteraction({ type: "CANCEL" })} /></div>}
          <div className="relative p-2">
            <RestartTargets onRestart={quickRestart} />
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

            {replay.onCourtPlayerIds.filter((slotId) => slotId === functionalGoalkeeperId).map((slotId) => {
              const position = courtPlayerPosition(
                slotId,
                replay.onCourtPlayerIds,
                session.players,
                replay.lineupValidation.goalkeeper.status === "PLAYER"
                  ? replay.lineupValidation.goalkeeper.playerId
                  : undefined,
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
                      if (benchMode === "CHANGE_OUT") setBenchMode("CHANGE_IN");
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
              const goalkeeperBadge = functionalGoalkeeperBadge(player, functionalGoalkeeperId);
              const flyingGoalkeeper = replay.flyingGoalkeeperActive && replay.flyingGoalkeeperPlayerId === player.id;
              return (
                <div
                  key={player.id}
                  className={`pointer-events-none absolute z-10 h-20 w-16 -translate-x-1/2 -translate-y-1/2 text-center shadow-lg transition-all sm:h-28 sm:w-24 ${
                    selected
                      ? "scale-105 ring-4 ring-yellow-300/50"
                      : ""
                  }`}
                  style={{ left: `${canonicalToVisualPoint(position, attackDirection).x * 100}%`, top: `${canonicalToVisualPoint(position, attackDirection).y * 100}%` }}
                  aria-label={`${player.name}${goalkeeperBadge ? `, ${goalkeeperBadge}` : ""}${flyingGoalkeeper ? ", portero-jugador" : ""}`}
                >
                  <LivePlayerCard player={player} minutes={minutes} selected={selected} />
                  {goalkeeperBadge && (
                    <span className={`absolute -top-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[8px] font-black tracking-wide shadow-lg sm:text-[9px] ${goalkeeperBadge === "PORTERO" ? "border-cyan-200 bg-cyan-950 text-cyan-100" : "border-amber-200 bg-amber-950 text-amber-100"}`}>
                      {goalkeeperBadge === "PORTERO" ? goalkeeperBadge : "PORTERO · ROL"}
                    </span>
                  )}
                  {flyingGoalkeeper && (
                    <span className="absolute -bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full border border-rose-200 bg-rose-700 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-white shadow-lg">P-J</span>
                  )}
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); applyInteraction({ type: "COURT_PLAYER_TAPPED", playerId: player.id }); if (benchMode === "CHANGE_OUT") setBenchMode("CHANGE_IN"); }} className="pointer-events-auto absolute -right-3 -top-3 grid h-11 w-11 place-items-center rounded-full border-2 border-white bg-slate-950 text-lg shadow-xl active:scale-95" aria-pressed={selected} aria-label={`Seleccionar ${player.name}`}>◎</button>
                  {selected && <div className="pointer-events-auto absolute left-[calc(100%+.5rem)] top-1/2 z-40 w-44 -translate-y-1/2 rounded-2xl border border-amber-300 bg-slate-950 p-2 shadow-2xl" aria-label="Acciones del portero seleccionado">
                    <PlayerContextActions location="COURT" captureBlocked={captureBlocked} redDecision={redDecisionPlayerId === player.id} onFoulCommitted={() => recordPlayerFoul(player.id, false)} onFoulReceived={() => recordPlayerFoul(player.id, true)} onPossessionLost={() => recordPlayerPossessionLost(player.id)} onYellow={() => recordPlayerCard(player.id, "YELLOW")} onRed={() => setRedDecisionPlayerId(player.id)} onRedOnly={() => recordPlayerCard(player.id, "RED")} onRedWithInferiority={() => recordPlayerCard(player.id, "RED", true)} onBack={() => setRedDecisionPlayerId(null)} onCancel={() => applyInteraction({ type: "CANCEL" })} />
                  </div>}
                </div>
              );
            })}

            {pendingThreat && (
              <div
                className={`pointer-events-none absolute z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-[0_0_0_6px_rgba(255,255,255,0.22)] ${
                  pendingThreat.side === "FOR" ? "bg-cyan-400" : "bg-rose-500"
                }`}
                style={{ left: `${canonicalToVisualPoint(pendingThreat.origin, attackDirection).x * 100}%`, top: `${canonicalToVisualPoint(pendingThreat.origin, attackDirection).y * 100}%` }}
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
                onTarget={(goalTarget) =>
                  applyInteraction({
                    type: "GOAL_TARGET_SELECTED",
                    // La miniportería siempre se interpreta frontalmente como
                    // la ve el tirador; no comparte el flip visual del campo.
                    goalTarget: frontGoalTargetToCanonical(goalTarget),
                  })
                }
                onDefensiveOutcome={(outcome) =>
                  applyInteraction({ type: "DEFENSIVE_OUTCOME_SELECTED", outcome })
                }
                onBodyPart={(keeperBodyPart) =>
                  applyInteraction({ type: "KEEPER_BODY_PART_SELECTED", keeperBodyPart })
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
          </div></div>
        </section>

        {benchMode !== "CLOSED" && benchMode !== "CHANGE_OUT" && <div className="fixed inset-0 z-[85] overflow-y-auto bg-slate-950/95 p-3 sm:grid sm:place-items-center">
        <div className="directo-bench-panel-wrap flex min-h-[82dvh] w-full max-w-7xl min-w-0 flex-col rounded-3xl border-2 border-cyan-500 bg-slate-950 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-lg font-black">{benchMode === "CHANGE_IN" ? `SALE ${substitutionSourceLabel ?? "—"} · ELIGE QUIÉN ENTRA` : "BANCO"}</p>
            <button type="button" onClick={() => { setBenchMode("CLOSED"); setSelectedStaffId(null); applyInteraction({ type: "CANCEL" }); }} className="min-h-12 min-w-12 rounded-xl bg-slate-800 text-2xl">×</button>
          </div>
          <div className="flex-1"><BenchPanel
            players={bench}
            staff={session.staff}
            playerMinutes={replay.playerMinutes}
            replacementForLabel={substitutionSourceLabel}
            selectedPlayerId={selectedBenchPlayerId ?? undefined}
            selectedStaffId={selectedStaffId ?? undefined}
            onPlayerTap={(playerId) => applyInteraction({ type: "BENCH_PLAYER_TAPPED", playerId })}
            onStaffTap={handleStaffTap}
            onYellow={(playerId) => captureBlocked ? blockedAction() : recordPlayerCard(playerId, "YELLOW")}
            onRed={(playerId) => captureBlocked ? blockedAction() : recordPlayerCard(playerId, "RED")}
            onStaffCard={(staffId, color) => captureBlocked ? blockedAction() : handleStaffCard(staffId, color)}
            onCancel={() => { setSelectedStaffId(null); applyInteraction({ type: "CANCEL" }); }}
          /></div>
        </div></div>}

        {historyOpen && <div className="directo-timeline-wrap min-w-0">
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
            activePeriod={session.period}
            matchFinished={session.matchFinished ?? false}
            closedPeriods={session.closedPeriods ?? []}
            reviewPeriod={session.reviewPeriod}
            onStartPeriodReview={(period) => {
              setInteraction(IDLE_LIVE_INTERACTION);
              startPeriodReview(matchId, period);
              setDisciplineFocus(null);
            }}
            onClose={() => { setHistoryOpen(false); setDisciplineFocus(null); }}
          />
        </div>}
      </main>
    </div>
  );
}

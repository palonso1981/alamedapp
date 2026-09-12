"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "../../../../components/app/AppHeader";
import { RecentEventsPanel } from "../../../../components/match/RecentEventsPanel";
import { SyncStatusBadge } from "../../../../components/match/SyncStatusBadge";
import { replayMatch } from "../../../../lib/matchEngine";
import {
  effectiveReviewStatus,
  periodScore,
  reviewEventCounts,
  targetMinutesComparisons,
} from "../../../../lib/postMatchReview";
import { seasonById } from "../../../../lib/seasonDomain";
import { useMatchStore } from "../../../../store/useMatchStore";
import { useTeamStore } from "../../../../store/useTeamStore";
import { CDA_CLUB_ID } from "../../../../types";
import { buildDashboardFixture } from "../../../../lib/dashboardFixture";
import { safeDashboardReturnTo } from "../../../../lib/dashboardNavigation";
import { useAccess } from "../../../../components/access/AccessProvider";

export default function MatchReviewPage() {
  const { canWrite } = useAccess();
  const { id: matchId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeDashboardReturnTo(searchParams.get("returnTo"));
  const storedSession = useMatchStore((state) => state.matches[matchId]);
  const fixtureSession = useMemo(
    () =>
      searchParams.get("fixture") === "1"
        ? buildDashboardFixture().find(
            (record) => record.catalog.matchId === matchId,
          )?.session
        : undefined,
    [matchId, searchParams],
  );
  const session = fixtureSession ?? storedSession;
  const ensureMatch = useMatchStore((state) => state.ensureMatch);
  const startFinishedReview = useMatchStore(
    (state) => state.startFinishedReview,
  );
  const startPeriodReview = useMatchStore((state) => state.startPeriodReview);
  const validateReview = useMatchStore((state) => state.validateReview);
  const reopenReview = useMatchStore((state) => state.reopenReview);
  const setPendingReview = useMatchStore((state) => state.setPendingReview);
  const editAndReorderEvent = useMatchStore(
    (state) => state.editAndReorderEvent,
  );
  const moveEventWithinMinute = useMatchStore(
    (state) => state.moveEventWithinMinute,
  );
  const softDeleteEvent = useMatchStore((state) => state.softDeleteEvent);
  const restoreEvent = useMatchStore((state) => state.restoreEvent);
  const clearError = useMatchStore((state) => state.clearError);
  const matchClubId = session?.preparation?.clubId ?? CDA_CLUB_ID;
  const workspace = useTeamStore((state) => state.teams[matchClubId]);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [confirmValidation, setConfirmValidation] = useState(false);

  useEffect(() => {
    ensureRegistry();
    if (!fixtureSession) ensureMatch(matchId);
  }, [ensureMatch, ensureRegistry, fixtureSession, matchId]);
  useEffect(() => {
    if (!fixtureSession) ensureTeam(matchClubId);
  }, [ensureTeam, fixtureSession, matchClubId]);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("eventId")
    )
      setHistoryOpen(true);
  }, []);
  const replay = useMemo(
    () =>
      session
        ? replayMatch(session.players, session.events, {
            currentClock: { period: 2, minute: 20 },
          })
        : null,
    [session],
  );
  const counts = useMemo(
    () => (session ? reviewEventCounts(session.events) : null),
    [session],
  );
  const comparisons = useMemo(
    () => (session ? targetMinutesComparisons(session) : []),
    [session],
  );

  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 text-white">
        Cargando revisión…
      </div>
    );
  }
  if (!session.matchFinished || !session.preparation || !replay || !counts) {
    return (
      <div className="min-h-screen bg-slate-900 text-white">
        <AppHeader title="Revisión" />
        <main className="mx-auto max-w-xl p-6 text-center">
          <p className="rounded-2xl bg-slate-800 p-6">
            Este partido todavía no está finalizado.
          </p>
          <Link
            href={`/partido/${matchId}/directo`}
            className="mt-4 inline-grid min-h-12 place-items-center rounded-xl bg-cyan-400 px-5 font-black text-slate-950"
          >
            ABRIR DIRECTO
          </Link>
        </main>
      </div>
    );
  }

  const status = effectiveReviewStatus(session);
  const season = workspace
    ? seasonById(workspace, session.preparation.seasonId)
    : undefined;
  const p1 = periodScore(session, 1);
  const p2 = periodScore(session, 2);
  const playerById = new Map(
    session.players.map((player) => [player.id, player]),
  );

  function openHistory(pending = false) {
    if (!canWrite) {
      setPendingOnly(pending);
      setHistoryOpen(true);
      return;
    }
    if (status === "VALIDATED") return;
    if (status === "NOT_REVIEWED") startFinishedReview(matchId);
    setPendingOnly(pending);
    setHistoryOpen(true);
  }

  function addRetroactive() {
    if (status === "VALIDATED") return;
    startFinishedReview(matchId);
    router.push(`/partido/${matchId}/directo`);
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <AppHeader
        title={`Revisión · ${session.preparation.opponent}`}
        actions={
          <>
            <Link
              href={canWrite ? `/partidos/${matchId}/video` : `/partido/${matchId}/videos`}
              className="grid min-h-10 place-items-center rounded-lg bg-red-950 px-3 text-[10px] font-black text-red-300"
            >
              ▶ VÍDEO
            </Link>
            <SyncStatusBadge matchId={matchId} />
          </>
        }
      />
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {returnTo && (
          <Link
            href={returnTo}
            className="sticky top-2 z-40 inline-flex min-h-11 items-center rounded-xl border border-cyan-700 bg-slate-950/95 px-4 text-xs font-black text-cyan-200 shadow-xl backdrop-blur"
          >
            ← VOLVER AL ANÁLISIS
          </Link>
        )}
        <section className="grid gap-4 rounded-3xl border border-slate-700 bg-slate-800 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-amber-300">
              {season?.label ?? "LEGACY · SIN TEMPORADA"} ·{" "}
              {session.preparation.date}
            </p>
            <h2 className="mt-1 text-3xl font-black">
              {session.preparation.opponent}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {session.preparation.venue === "HOME" ? "Local" : "Visitante"} ·
              P1 {p1.for}-{p1.against} · P2 {p2.for}-{p2.against}
            </p>
          </div>
          <div className="text-center">
            <p className="text-5xl font-black">
              {replay.score.for}–{replay.score.against}
            </p>
            <span
              className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-black ${status === "VALIDATED" ? "bg-emerald-950 text-emerald-300" : status === "IN_REVIEW" ? "bg-cyan-950 text-cyan-300" : "bg-amber-950 text-amber-300"}`}
            >
              {status === "VALIDATED"
                ? "VALIDADO"
                : status === "IN_REVIEW"
                  ? "EN REVISIÓN"
                  : "PENDIENTE DE REVISIÓN"}
            </span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["AMENAZAS", counts.threats],
            ["GOLES CDA", counts.goalsFor],
            ["GOLES RIV", counts.goalsAgainst],
            ["PÉRDIDAS", counts.possessionLosses],
            ["FALTAS", counts.fouls],
            ["TARJETAS", counts.cards],
            ["MANUAL", counts.manualReview],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-slate-700 bg-slate-800 p-4"
            >
              <p className="text-[10px] font-black text-slate-500">{label}</p>
              <p className="mt-1 text-3xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-cyan-300">
                  JUGADORES · MINUTOS REALES
                </p>
                <p className="text-xs text-slate-500">Derivados del replay</p>
              </div>
              {counts.pending > 0 && (
                <button
                  type="button"
                  onClick={() => openHistory(true)}
                  disabled={status === "VALIDATED"}
                  className="min-h-11 rounded-xl bg-amber-400 px-4 text-xs font-black text-slate-950 disabled:opacity-40"
                >
                  ? {counts.pending} DATOS PENDIENTES
                </button>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {session.players.map((player) => (
                <div
                  key={player.id}
                  className="flex min-h-11 items-center justify-between rounded-xl bg-slate-900 px-3"
                >
                  <span className="truncate text-sm font-bold">
                    #{player.number} · {player.name}
                  </span>
                  <span className="font-mono font-black text-cyan-300">
                    {replay.playerMinutes[player.id]?.totalMinutes ?? 0}′
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
            <p className="text-xs font-black text-violet-300">DISCIPLINA</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-xs text-slate-500">CDA</p>
                <p className="mt-1 text-xl font-black">
                  F{replay.discipline.for.fouls} · 🟨
                  {replay.discipline.for.yellowCards} · 🟥
                  {replay.discipline.for.redCards}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-900 p-4">
                <p className="text-xs text-slate-500">RIV</p>
                <p className="mt-1 text-xl font-black">
                  F{replay.discipline.against.fouls} · 🟨
                  {replay.discipline.against.yellowCards} · 🟥
                  {replay.discipline.against.redCards}
                </p>
              </div>
            </div>
          </div>
        </section>

        {comparisons.length > 0 && (
          <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
            <p className="text-xs font-black text-amber-300">
              PLAN DE MINUTOS · OPCIONAL
            </p>
            <div className="mt-3 divide-y divide-slate-700">
              {comparisons.map((item) => (
                <div
                  key={item.playerId}
                  className="grid min-h-12 grid-cols-[1fr_auto_auto_auto] items-center gap-4 text-sm"
                >
                  <span className="font-bold">
                    {playerById.get(item.playerId)?.name ?? item.playerId}
                  </span>
                  <span className="text-slate-400">Obj. {item.target}′</span>
                  <span>Real {item.actual}′</span>
                  <span
                    className={`font-black ${item.difference > 0 ? "text-amber-300" : item.difference < 0 ? "text-cyan-300" : "text-slate-400"}`}
                  >
                    {item.difference > 0 ? "+" : ""}
                    {item.difference}′
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {session.lastError && (
          <p
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl bg-red-950 p-3 text-red-200"
          >
            <span>{session.lastError}</span>
            <button
              type="button"
              onClick={() => clearError(matchId)}
              className="min-h-9 min-w-9 rounded-lg bg-red-900"
            >
              ×
            </button>
          </p>
        )}
        {canWrite ? (
          <section className="flex flex-wrap gap-3 rounded-3xl border border-slate-700 bg-slate-950 p-4">
            {status !== "VALIDATED" ? (
              <>
                <button
                  type="button"
                  onClick={() => openHistory(false)}
                  className="min-h-12 flex-1 rounded-xl bg-cyan-400 px-5 font-black text-slate-950"
                >
                  REVISAR CRONOLOGÍA
                </button>
                <button
                  type="button"
                  onClick={addRetroactive}
                  className="min-h-12 flex-1 rounded-xl bg-slate-700 px-5 font-black"
                >
                  + EVENTO RETROACTIVO
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (counts.pending > 0 && !confirmValidation) {
                      setConfirmValidation(true);
                      return;
                    }
                    validateReview(matchId);
                    setConfirmValidation(false);
                  }}
                  className="min-h-12 flex-1 rounded-xl bg-emerald-400 px-5 font-black text-slate-950"
                >
                  {confirmValidation
                    ? `VALIDAR CON ${counts.pending} PENDIENTES`
                    : "VALIDAR PARTIDO"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => reopenReview(matchId)}
                className="min-h-12 w-full rounded-xl bg-amber-400 px-5 font-black text-slate-950"
              >
                REABRIR REVISIÓN
              </button>
            )}
          </section>
        ) : (
          <button
            type="button"
            onClick={() => openHistory(false)}
            className="min-h-12 w-full rounded-xl bg-slate-800 px-5 font-black text-cyan-200"
          >
            VER CRONOLOGÍA
          </button>
        )}
      </main>

      {historyOpen && (
        <RecentEventsPanel
          readOnly={!canWrite}
          events={session.events}
          timeline={replay.timeline}
          players={session.players}
          staff={session.staff}
          onDelete={(eventId) => softDeleteEvent(matchId, eventId)}
          onRestore={(eventId) => restoreEvent(matchId, eventId)}
          onPendingReview={(eventId, pending) =>
            setPendingReview(matchId, eventId, pending)
          }
          onSave={(eventId, target, changes) =>
            editAndReorderEvent(matchId, eventId, target, changes)
          }
          onMoveWithinMinute={(eventId, targetEventId, placement) =>
            moveEventWithinMinute(matchId, eventId, targetEventId, placement)
          }
          errorMessage={session.lastError}
          onDismissError={() => clearError(matchId)}
          activePeriod={session.period}
          matchFinished
          closedPeriods={session.closedPeriods ?? [1, 2]}
          reviewPeriod={session.reviewPeriod}
          onStartPeriodReview={(period) => startPeriodReview(matchId, period)}
          onClose={() => setHistoryOpen(false)}
          initialFilter={pendingOnly ? "PENDING" : "ACTIVE"}
        />
      )}
    </div>
  );
}

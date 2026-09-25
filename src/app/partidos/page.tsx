"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "../../components/app/AppHeader";
import { AdminEntityActions } from "../../components/admin/AdminEntityActions";
import {
  assignStoredMatchSeason,
  changeStoredMatchLifecycle,
} from "../../lib/adminMatchService";
import { isSeasonVisible } from "../../lib/adminDomain";
import {
  listMatchCatalog,
  matchCatalogClubId,
  MatchCatalogEntry,
  visibleMatchCatalog,
} from "../../lib/matchCatalog";
import { hasVideoLabAvailable } from "../../lib/videoLab";
import { currentSeason } from "../../lib/seasonDomain";
import { useTeamStore } from "../../store/useTeamStore";
import { loadMatchSession } from "../../lib/matchPersistence";
import { normalizeDashboardSearch } from "../../lib/dashboardSelectors";
import { CompetitionType } from "../../types";
import { useAccess } from "../../components/access/AccessProvider";
import { SyncStatusBadge } from "../../components/match/SyncStatusBadge";
import { browserMatchRepository } from "../../lib/sync/localMatchRepository";
import { hasUnreconciledMatchSyncState } from "../../lib/sync/syncTypes";

const STATUS_LABEL: Record<MatchCatalogEntry["status"], string> = {
  DRAFT: "PREPARAR",
  READY: "LISTO",
  LIVE: "EN CURSO",
  FINISHED: "FINALIZADO",
};
const COMPETITION_LABEL: Record<CompetitionType | "UNSPECIFIED", string> = {
  LEAGUE: "LIGA",
  CUP: "COPA",
  FRIENDLY: "AMISTOSO",
  OTHER: "OTRA",
  UNSPECIFIED: "SIN CLASIFICAR",
};

export default function MatchesPage() {
  const { canWrite } = useAccess();
  const [matches, setMatches] = useState<MatchCatalogEntry[]>([]);
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const workspace = useTeamStore((state) => state.teams[state.currentClubId]);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);
  const [seasonId, setSeasonId] = useState("");
  const [legacyAssignments, setLegacyAssignments] = useState<
    Record<string, string>
  >({});
  const [showArchived, setShowArchived] = useState(false);
  const [competition, setCompetition] = useState<
    CompetitionType | "ALL" | "UNSPECIFIED"
  >("ALL");
  const [matchday, setMatchday] = useState("ALL");
  const [rival, setRival] = useState("ALL");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => ensureRegistry(), [ensureRegistry]);
  useEffect(() => {
    ensureTeam(currentClubId);
    setMatches(listMatchCatalog());
    setSeasonId("");
  }, [currentClubId, ensureTeam]);
  useEffect(() => {
    if (workspace && !seasonId)
      setSeasonId(currentSeason(workspace)?.seasonId ?? "ALL");
  }, [seasonId, workspace]);
  const enriched = useMemo(
    () =>
      matches.map((match) => {
        const session = loadMatchSession(match.matchId);
        return { match, preparation: session?.preparation, hasVideoLab: hasVideoLabAvailable(session) };
      }),
    [matches],
  );
  const availableRivals = useMemo(
    () =>
      Array.from(new Set(enriched.map(({ match }) => match.opponent))).sort(),
    [enriched],
  );
  const availableMatchdays = useMemo(
    () =>
      Array.from(
        new Set(
          enriched.flatMap(({ preparation }) =>
            preparation?.matchday ? [preparation.matchday] : [],
          ),
        ),
      ).sort((a, b) => a - b),
    [enriched],
  );
  const visible = useMemo(
    () =>
      visibleMatchCatalog(matches, showArchived)
        .filter((match) => matchCatalogClubId(match) === currentClubId)
        .filter((match) =>
          seasonId === "ALL"
            ? true
            : seasonId === "LEGACY"
              ? !match.seasonId
              : match.seasonId === seasonId,
        )
        .filter((match) => {
          const preparation = enriched.find(
            (item) => item.match.matchId === match.matchId,
          )?.preparation;
          const type = preparation?.competitionType ?? "UNSPECIFIED";
          if (competition !== "ALL" && type !== competition) return false;
          if (
            matchday !== "ALL" &&
            String(preparation?.matchday ?? "") !== matchday
          )
            return false;
          if (rival !== "ALL" && match.opponent !== rival) return false;
          const haystack = normalizeDashboardSearch(
            `${match.opponent} ${match.date} ${preparation?.competition ?? ""} ${preparation?.competitionType ?? ""} ${preparation?.matchday ? `j${preparation.matchday} jornada ${preparation.matchday}` : ""}`,
          );
          return haystack.includes(normalizeDashboardSearch(search));
        }),
    [
      competition,
      currentClubId,
      enriched,
      matchday,
      matches,
      rival,
      search,
      seasonId,
      showArchived,
    ],
  );
  const pendingDeletedMatches = useMemo(
    () => matches.filter((match) =>
      Boolean(match.deletedAt) &&
      hasUnreconciledMatchSyncState(browserMatchRepository.getSyncState(match.matchId)),
    ),
    [matches],
  );
  const deletedMatchSubscriptionKey = useMemo(
    () => matches.filter((match) => match.deletedAt).map((match) => match.matchId).sort().join("|"),
    [matches],
  );
  useEffect(() => {
    const refresh = () => setMatches(listMatchCatalog());
    const subscriptions = deletedMatchSubscriptionKey
      ? deletedMatchSubscriptionKey.split("|").map((matchId) =>
          browserMatchRepository.subscribe(matchId, refresh),
        )
      : [];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [deletedMatchSubscriptionKey]);
  function lifecycle(
    matchId: string,
    action: "ARCHIVE" | "REACTIVATE" | "DELETE",
  ) {
    const result = changeStoredMatchLifecycle(matchId, action);
    setMessage(result.ok
      ? action === "DELETE" && result.pending > 0
        ? "El partido se ha ocultado en este dispositivo. Su eliminación de APP ALAM está pendiente de sincronizar."
        : null
      : result.message);
    setMatches(listMatchCatalog());
  }
  function assignSeason(matchId: string) {
    if (!workspace) return;
    const result = assignStoredMatchSeason(
      matchId,
      workspace,
      legacyAssignments[matchId] ?? "",
    );
    setMessage(result.ok ? null : result.message);
    if (result.ok) setMatches(listMatchCatalog());
  }
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <AppHeader
        title="Partidos"
        actions={
          canWrite ? (
            <Link
              href="/partidos/nuevo"
              className="min-h-10 rounded-lg bg-amber-400 px-4 py-2.5 font-black text-slate-950"
            >
              + PARTIDO
            </Link>
          ) : undefined
        }
      />
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="space-y-3">
          <div className="grid gap-2 rounded-2xl border border-slate-700 bg-slate-800 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-[9px] font-black text-slate-400">
              TEMPORADA
              <select
                value={seasonId}
                onChange={(event) => setSeasonId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white"
              >
                <option value="ALL">TODAS</option>
                {workspace?.seasons
                  .filter((season) => isSeasonVisible(season, showArchived))
                  .map((season) => (
                    <option key={season.seasonId} value={season.seasonId}>
                      {season.label}
                      {season.current ? " · ACTUAL" : ""}
                    </option>
                  ))}
                <option value="LEGACY">LEGACY</option>
              </select>
            </label>
            <label className="text-[9px] font-black text-slate-400">
              COMPETICIÓN
              <select
                value={competition}
                onChange={(event) =>
                  setCompetition(event.target.value as typeof competition)
                }
                className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white"
              >
                <option value="ALL">TODAS</option>
                <option value="LEAGUE">LIGA</option>
                <option value="CUP">COPA</option>
                <option value="FRIENDLY">AMISTOSO</option>
                <option value="OTHER">OTRA</option>
                <option value="UNSPECIFIED">SIN CLASIFICAR</option>
              </select>
            </label>
            <label className="text-[9px] font-black text-slate-400">
              JORNADA
              <select
                value={matchday}
                onChange={(event) => setMatchday(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white"
              >
                <option value="ALL">TODAS</option>
                {availableMatchdays.map((value) => (
                  <option key={value} value={value}>
                    J{value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-black text-slate-400">
              RIVAL
              <select
                value={rival}
                onChange={(event) => setRival(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-white"
              >
                <option value="ALL">TODOS</option>
                {availableRivals.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-black text-slate-400">
              BUSCAR
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rival, J7, fecha…"
                className="mt-1 min-h-11 w-full rounded-xl bg-slate-950 px-3 text-sm text-white"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-xs font-black text-slate-300 sm:col-span-2 lg:col-span-5">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                className="h-5 w-5"
              />
              Mostrar archivados
            </label>
          </div>
          {visible.map((match) => {
            const href =
              match.status === "FINISHED"
                ? `/partido/${match.matchId}/revision`
                : match.status === "LIVE"
                  ? `/partido/${match.matchId}/directo`
                  : `/partido/${match.matchId}/prepartido`;
            const season = workspace?.seasons.find(
              (item) => item.seasonId === match.seasonId,
            );
            const preparation = enriched.find(
              (item) => item.match.matchId === match.matchId,
            )?.preparation;
            const hasVideoLab = enriched.find((item) => item.match.matchId === match.matchId)?.hasVideoLab;
            const legacySeasons =
              workspace?.seasons.filter(
                (item) =>
                  isSeasonVisible(item) &&
                  (match.teamId === workspace.teamId ||
                    item.teamId === match.teamId),
              ) ?? [];
            return (
              <div
                key={match.matchId}
                className={`rounded-2xl border border-slate-700 bg-slate-800 p-3 ${match.archivedAt ? "opacity-65" : ""}`}
              >
                <div className="flex min-h-20 items-center gap-2">
                  <Link
                    href={href}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl p-1 hover:text-amber-300"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-400">
                        {match.date}
                        {match.time ? ` · ${match.time}` : ""} ·{" "}
                        {match.venue === "HOME" ? "LOCAL" : "VISITANTE"} ·{" "}
                        {season?.label ?? "LEGACY · SIN ASIGNAR"}
                        {match.archivedAt ? " · ARCHIVADO" : ""}
                      </span>
                      <span className="mt-1 block truncate text-xl font-black">
                        {match.opponent}
                      </span>
                      <span className="mt-1 block text-[10px] font-black text-cyan-300">
                        {
                          COMPETITION_LABEL[
                            preparation?.competitionType ?? "UNSPECIFIED"
                          ]
                        }
                        {preparation?.matchday
                          ? ` · J${preparation.matchday}`
                          : ""}
                        {preparation?.opponentCategory
                          ? ` · ${preparation.opponentCategory}`
                          : ""}
                      </span>
                    </span>
                    <span
                      className={`rounded-xl px-3 py-2 text-xs font-black ${match.status === "LIVE" ? "bg-red-950 text-red-300" : match.status === "READY" ? "bg-emerald-950 text-emerald-300" : "bg-slate-950 text-slate-300"}`}
                    >
                      {STATUS_LABEL[match.status]} →
                    </span>
                  </Link>
                  <Link
                    href={canWrite ? `/partidos/${match.matchId}/video` : `/partido/${match.matchId}/videos`}
                    aria-label={`Vídeo del partido contra ${match.opponent}`}
                    className="grid min-h-11 place-items-center rounded-xl bg-red-950 px-3 text-[10px] font-black text-red-300"
                  >
                    VÍDEO
                  </Link>
                  {hasVideoLab && (
                    <Link
                      href={`/partido/${match.matchId}/video-lab`}
                      aria-label={`Video Lab del partido contra ${match.opponent}`}
                      className="grid min-h-11 place-items-center rounded-xl bg-cyan-950 px-3 text-[10px] font-black text-cyan-200"
                    >
                      VIDEO LAB
                    </Link>
                  )}
                  {canWrite && (
                    <Link
                      href={`/partidos/${match.matchId}/editar`}
                      aria-label={`Editar partido contra ${match.opponent}`}
                      className="grid min-h-11 min-w-11 place-items-center rounded-xl bg-cyan-950 text-lg font-black text-cyan-300"
                    >
                      ✎
                    </Link>
                  )}
                  <AdminEntityActions
                    label={`partido contra ${match.opponent}`}
                    archived={Boolean(match.archivedAt)}
                    impact={`Este partido contiene ${match.eventCount ?? 0} eventos. Al confirmar se eliminará de APP ALAM en todos los dispositivos cuando la nube lo sincronice. Sus datos deportivos se conservarán dentro del agregado como tombstone para no romper sincronización ni referencias.`}
                    onArchive={() => lifecycle(match.matchId, "ARCHIVE")}
                    onReactivate={() => lifecycle(match.matchId, "REACTIVATE")}
                    onDelete={() => lifecycle(match.matchId, "DELETE")}
                  />
                </div>
                {canWrite && !match.seasonId && legacySeasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-700 pt-2">
                    <select
                      aria-label="Temporada para partido legacy"
                      value={legacyAssignments[match.matchId] ?? ""}
                      onChange={(event) =>
                        setLegacyAssignments((state) => ({
                          ...state,
                          [match.matchId]: event.target.value,
                        }))
                      }
                      className="min-h-11 flex-1 rounded-xl bg-slate-950 px-3 text-sm"
                    >
                      <option value="">ASIGNAR TEMPORADA</option>
                      {legacySeasons.map((item) => (
                        <option key={item.seasonId} value={item.seasonId}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!legacyAssignments[match.matchId]}
                      onClick={() => assignSeason(match.matchId)}
                      className="min-h-11 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 disabled:opacity-30"
                    >
                      ASIGNAR
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {message && (
            <p role="alert" className="rounded-xl bg-slate-800 p-3 text-slate-200">
              {message}
            </p>
          )}
          {pendingDeletedMatches.map((match) => (
            <div
              key={`deleted-sync-${match.matchId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-700 bg-amber-950/50 p-3"
            >
              <div>
                <p className="text-xs font-black text-amber-200">ELIMINACIÓN PENDIENTE</p>
                <p className="mt-1 text-xs text-amber-100">
                  {match.opponent} seguirá protegido localmente hasta que la nube confirme el tombstone.
                </p>
              </div>
              <SyncStatusBadge matchId={match.matchId} />
            </div>
          ))}
          {visible.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-700 p-10 text-center">
              <p className="text-slate-400">
                No hay partidos en esta temporada.
              </p>
              {canWrite && (
                <Link
                  href="/partidos/nuevo"
                  className="mt-5 inline-grid min-h-12 place-items-center rounded-xl bg-amber-400 px-6 font-black text-slate-950"
                >
                  CREAR PARTIDO
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

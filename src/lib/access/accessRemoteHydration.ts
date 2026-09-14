import { collection, doc, DocumentData, getDoc, getDocs, query, QueryDocumentSnapshot, where } from "firebase/firestore";
import { ActiveAccessGrant } from "./accessDomain";
import { getFirebaseDevServices } from "../firebase";
import { saveClubRegistry } from "../clubRegistry";
import { emptyTeamWorkspace } from "../seasonDomain";
import { browserTeamRepository } from "../sync/localTeamRepository";
import { browserMatchRepository } from "../sync/localMatchRepository";
import { syncEntityKey, MatchRemoteMetadata } from "../sync/syncTypes";
import { seasonPlayerEntityId, seasonStaffEntityId, teamEntityKey } from "../sync/teamSyncTypes";
import { ClubProfile, MasterPlayer, MasterStaffMember, MatchEvent, MatchSession, Season, SeasonPlayer, SeasonStaff, TeamProfile, TeamWorkspace } from "../../types";

type RemoteEnvelope<T> = { revision?: number; removed?: boolean; payload?: T } & Partial<T>;

function payload<T>(snapshot: { data(): DocumentData | undefined }): T | null {
  const raw = snapshot.data() as RemoteEnvelope<T> | undefined;
  if (!raw) return null;
  if (raw.removed) return null;
  return (raw.payload ?? raw) as T;
}

function revision(snapshot: { data(): DocumentData | undefined }): number {
  const value = snapshot.data()?.revision;
  return typeof value === "number" ? value : 0;
}

export function remoteMatchSession(metadata: MatchRemoteMetadata, events: MatchEvent[]): MatchSession {
  return {
    matchId: metadata.matchId,
    preparation: metadata.preparation,
    players: metadata.players,
    staff: metadata.staff,
    period: metadata.activePeriod,
    minute: metadata.minute,
    periodMinutes: metadata.periodMinutes,
    closedPeriods: metadata.closedPeriods,
    periodCloseSnapshots: metadata.periodCloseSnapshots,
    reviewPeriod: metadata.reviewPeriod,
    reviewMinute: metadata.reviewMinute,
    matchFinished: metadata.matchFinished,
    reviewStatus: metadata.reviewStatus,
    reviewRevision: metadata.reviewRevision,
    reviewStartedAt: metadata.reviewStartedAt,
    reviewValidatedAt: metadata.reviewValidatedAt,
    reviewReopenedAt: metadata.reviewReopenedAt,
    videoSegments: metadata.videoSegments ?? [],
    videoEventOverrides: metadata.videoEventOverrides ?? [],
    events,
    past: [],
    future: [],
    lastError: null,
    persistenceStatus: "saved",
    lastSavedAt: Date.now(),
  };
}

export function remoteWorkspace(input: {
  club: ClubProfile;
  teams: TeamProfile[];
  players: MasterPlayer[];
  staff: MasterStaffMember[];
  seasons: Season[];
  seasonPlayers: SeasonPlayer[];
  seasonStaff: SeasonStaff[];
}): TeamWorkspace {
  const base = emptyTeamWorkspace(input.club.clubId, Date.now(), input.club);
  return { ...base, ...input, team: input.teams[0] ?? base.team };
}

/** Descarga únicamente documentos autorizados; las queries incluyen club/team. */
export async function hydrateAuthorizedRemoteData(grant: ActiveAccessGrant): Promise<void> {
  const { db } = await getFirebaseDevServices();
  const clubId = grant.profile.clubId;
  const clubSnapshot = await getDoc(doc(db, "clubs", clubId));
  const club = clubSnapshot.exists() ? payload<ClubProfile>(clubSnapshot) : null;
  if (!club) throw new Error("El club autorizado no existe o no es legible.");
  const revisions: Record<string, number> = {
    [teamEntityKey("CLUB", clubId)]: revision(clubSnapshot),
  };

  const teamIds = grant.profile.role !== "VIEWER" || grant.profile.scope.type === "CLUB"
    ? null
    : grant.profile.scope.teamIds;
  const teamSnapshots = teamIds
    ? (await Promise.all(teamIds.map((id) => getDoc(doc(db, "clubs", clubId, "teams", id))))).filter((item) => item.exists())
    : (await getDocs(collection(db, "clubs", clubId, "teams"))).docs;
  const teams = teamSnapshots.map((item) => payload<TeamProfile>(item)).filter((item): item is TeamProfile => Boolean(item));
  teamSnapshots.forEach((item) => { revisions[teamEntityKey("TEAM_UNIT", item.id)] = revision(item); });
  const seasons: Season[] = [];
  const seasonPlayers: SeasonPlayer[] = [];
  const seasonStaff: SeasonStaff[] = [];
  for (const team of teams) {
    const seasonDocs = (await getDocs(collection(db, "clubs", clubId, "teams", team.teamId, "seasons"))).docs;
    for (const seasonDoc of seasonDocs) {
      const season = payload<Season>(seasonDoc);
      if (!season) continue;
      seasons.push(season);
      revisions[teamEntityKey("SEASON", seasonDoc.id)] = revision(seasonDoc);
      const [playerDocs, staffDocs] = await Promise.all([
        getDocs(collection(db, "clubs", clubId, "teams", team.teamId, "seasons", season.seasonId, "players")),
        getDocs(collection(db, "clubs", clubId, "teams", team.teamId, "seasons", season.seasonId, "staff")),
      ]);
      const memberships = playerDocs.docs.map((item) => ({ item, membership: payload<SeasonPlayer>(item) })).filter((entry): entry is { item: typeof entry.item; membership: SeasonPlayer } => Boolean(entry.membership));
      const staffMemberships = staffDocs.docs.map((item) => ({ item, membership: payload<SeasonStaff>(item) })).filter((entry): entry is { item: typeof entry.item; membership: SeasonStaff } => Boolean(entry.membership));
      seasonPlayers.push(...memberships.map((entry) => entry.membership));
      seasonStaff.push(...staffMemberships.map((entry) => entry.membership));
      memberships.forEach(({ item, membership }) => {
        revisions[teamEntityKey("SEASON_PLAYER", seasonPlayerEntityId(membership.seasonId, membership.playerId))] = revision(item);
      });
      staffMemberships.forEach(({ item, membership }) => {
        revisions[teamEntityKey("SEASON_STAFF", seasonStaffEntityId(membership.seasonId, membership.staffId))] = revision(item);
      });
    }
  }
  const playerIds = Array.from(new Set(seasonPlayers.map((item) => item.playerId)));
  const staffIds = Array.from(new Set(seasonStaff.map((item) => item.staffId)));
  const [playerSnapshots, staffSnapshots] = teamIds
    ? await Promise.all([
        Promise.all(playerIds.map((id) => getDoc(doc(db, "clubs", clubId, "players", id)).catch(() => null))),
        Promise.all(staffIds.map((id) => getDoc(doc(db, "clubs", clubId, "staff", id)).catch(() => null))),
      ])
    : await Promise.all([
        getDocs(collection(db, "clubs", clubId, "players")).then((value) => value.docs),
        getDocs(collection(db, "clubs", clubId, "staff")).then((value) => value.docs),
      ]);
  const readablePlayers = playerSnapshots.filter((item): item is NonNullable<typeof item> => Boolean(item?.exists()));
  const readableStaff = staffSnapshots.filter((item): item is NonNullable<typeof item> => Boolean(item?.exists()));
  const players = readablePlayers.map((item) => payload<MasterPlayer>(item)).filter((item): item is MasterPlayer => Boolean(item));
  const staff = readableStaff.map((item) => payload<MasterStaffMember>(item)).filter((item): item is MasterStaffMember => Boolean(item));
  readablePlayers.forEach((item) => { revisions[teamEntityKey("PLAYER", item.id)] = revision(item); });
  readableStaff.forEach((item) => { revisions[teamEntityKey("STAFF", item.id)] = revision(item); });
  const workspace = remoteWorkspace({ club, teams, players, staff, seasons, seasonPlayers, seasonStaff });
  browserTeamRepository.hydrateRemote(clubId, workspace, revisions);
  saveClubRegistry({ schemaVersion: 1, clubIds: [clubId], currentClubId: clubId });

  const matchDocs = [] as QueryDocumentSnapshot<DocumentData>[];
  const scopedTeamIds = teamIds ?? [null];
  for (const teamId of scopedTeamIds) {
    const constraints = [where("payload.preparation.clubId", "==", clubId)];
    if (teamId) constraints.push(where("payload.preparation.teamId", "==", teamId));
    const snapshots = await getDocs(query(collection(db, "matches"), ...constraints));
    matchDocs.push(...snapshots.docs);
  }
  for (const matchDoc of Array.from(new Map(matchDocs.map((item) => [item.id, item])).values())) {
    const metadata = payload<MatchRemoteMetadata>(matchDoc);
    if (!metadata) continue;
    const eventDocs = (await getDocs(collection(db, "matches", matchDoc.id, "events"))).docs;
    const events = eventDocs.map((item) => payload<MatchEvent>(item)).filter((item): item is MatchEvent => Boolean(item));
    const known = { [syncEntityKey("MATCH", matchDoc.id)]: revision(matchDoc) };
    eventDocs.forEach((item) => { known[syncEntityKey("EVENT", item.id)] = revision(item); });
    browserMatchRepository.hydrateRemote(remoteMatchSession(metadata, events), known);
  }
}

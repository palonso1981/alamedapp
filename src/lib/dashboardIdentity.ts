import { MasterPlayer } from "../types";
import { DashboardMatchRecord } from "./dashboardAnalytics";
import { resolveMasterPlayerPhoto } from "./rosterDomain";

/**
 * Resuelve identidad visual actual por playerId sin alterar el hecho histórico del partido.
 * Dorsal, posición, alineación y eventos permanecen como snapshot de aquel encuentro.
 */
export function withCurrentPlayerIdentity(
  records: readonly DashboardMatchRecord[],
  masterPlayers: readonly MasterPlayer[],
): DashboardMatchRecord[] {
  if (masterPlayers.length === 0) return [...records];
  const current = new Map(masterPlayers.map((player) => [player.playerId, player]));
  return records.map((record) => ({
    ...record,
    session: {
      ...record.session,
      players: record.session.players.map((player) => {
        const master = current.get(player.id);
        if (!master) return player;
        return {
          ...player,
          name: master.displayName,
          fullName: master.fullName,
          photoUrl: resolveMasterPlayerPhoto(master),
        };
      }),
    },
  }));
}

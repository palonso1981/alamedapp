"use client";

import { useEffect } from "react";

import { useTeamStore } from "../../store/useTeamStore";

export function ClubContextLabel({ clubId }: { clubId?: string }) {
  const currentClubId = useTeamStore((state) => state.currentClubId);
  const resolvedClubId = clubId ?? currentClubId;
  const club = useTeamStore((state) => state.teams[resolvedClubId]?.club);
  const ensureRegistry = useTeamStore((state) => state.ensureRegistry);
  const ensureTeam = useTeamStore((state) => state.ensureTeam);

  useEffect(() => {
    ensureRegistry();
    ensureTeam(resolvedClubId);
  }, [ensureRegistry, ensureTeam, resolvedClubId]);

  const fullName = club?.name ?? resolvedClubId;
  const compactName = club?.shortName || fullName;
  return (
    <span
      className="inline-flex min-h-7 max-w-full items-center rounded-full border border-cyan-800/70 bg-cyan-950/35 px-2.5 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-200"
      aria-label={`Club actual: ${fullName}`}
      title={`Club actual: ${fullName}`}
    >
      <span className="sm:hidden">{compactName}</span>
      <span className="hidden truncate sm:inline">CLUB · {fullName}</span>
    </span>
  );
}

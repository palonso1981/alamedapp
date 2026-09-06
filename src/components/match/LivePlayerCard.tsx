import { Player, PlayerMinutes } from "../../types";
import { PlayerPhotoCard } from "../player/PlayerPhotoCard";

export function LivePlayerCard({
  player,
  minutes,
  selected = false,
}: {
  player: Player;
  minutes: PlayerMinutes;
  selected?: boolean;
}) {
  return (
    <PlayerPhotoCard player={player} selected={selected} className="h-full min-h-20 w-full">
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent px-2 pb-1.5 pt-8 text-left text-white">
        <span className="block truncate text-[11px] font-black leading-tight">{player.name}</span>
        <span className="mt-0.5 flex items-end justify-between gap-1">
          <strong className="text-xl leading-none text-cyan-200">#{player.number}</strong>
          <span className="text-sm font-black">{minutes.currentStintMinutes}&apos; <small className="text-[9px] font-semibold text-slate-400">({minutes.totalMinutes}&apos;)</small></span>
        </span>
      </span>
    </PlayerPhotoCard>
  );
}

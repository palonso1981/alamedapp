import { Player } from "../../types";
import { PlayerImage } from "./PlayerImage";

interface PlayerAvatarProps {
  player: Player;
  selected?: boolean;
  compact?: boolean;
  bench?: boolean;
}

export function PlayerAvatar({
  player,
  selected = false,
  compact = false,
  bench = false,
}: PlayerAvatarProps) {
  const size = bench
    ? "h-12 w-12"
    : compact
      ? "h-10 w-10"
      : "h-20 w-16 sm:h-24 sm:w-20";

  return (
    <span
      role="img"
      aria-label={`Foto de ${player.name}`}
      className={`relative grid shrink-0 place-items-center ${compact || bench ? "overflow-visible rounded-full" : "overflow-hidden rounded-xl"} border-2 bg-slate-700 ${size} ${
        selected ? "border-slate-950" : "border-white/60"
      }`}
    >
      <PlayerImage src={player.photoUrl} alt="" className={`absolute inset-0 h-full w-full object-cover object-top ${compact || bench ? "rounded-full" : "rounded-xl"}`} fallback={
        <span className={`text-xl font-black ${selected ? "text-slate-950" : "text-white"}`} aria-hidden="true">
          {player.number}
        </span>
      } />
      {player.photoUrl && (compact || bench) && (
        <span
          className={`absolute -bottom-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[10px] font-black shadow ${selected ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}
        >
          {player.number}
        </span>
      )}
    </span>
  );
}

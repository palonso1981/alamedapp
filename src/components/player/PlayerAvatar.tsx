import { Player } from "../../types";

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
      : "h-12 w-12 sm:h-14 sm:w-14";

  return (
    <span
      role="img"
      aria-label={`Foto de ${player.name}`}
      className={`relative grid shrink-0 place-items-center overflow-visible rounded-full border-2 bg-slate-700 bg-cover bg-center ${size} ${
        selected ? "border-slate-950" : "border-white/60"
      }`}
      style={
        player.photoUrl
          ? { backgroundImage: `url("${player.photoUrl}")` }
          : undefined
      }
    >
      {!player.photoUrl && (
        <span className={`text-xl font-black ${selected ? "text-slate-950" : "text-white"}`} aria-hidden="true">
          {player.number}
        </span>
      )}
      {player.photoUrl && (
        <span
          className={`absolute -bottom-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[10px] font-black shadow ${selected ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}
        >
          {player.number}
        </span>
      )}
    </span>
  );
}

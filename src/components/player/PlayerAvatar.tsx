import { Player } from "../../types";

interface PlayerAvatarProps {
  player: Player;
  selected?: boolean;
  compact?: boolean;
}

export function PlayerAvatar({
  player,
  selected = false,
  compact = false,
}: PlayerAvatarProps) {
  const size = compact ? "h-10 w-10" : "h-12 w-12 sm:h-14 sm:w-14";

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
        <svg
          viewBox="0 0 24 24"
          className={`h-2/3 w-2/3 ${selected ? "text-slate-900" : "text-slate-300"}`}
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c.4-5 3-7 8-7s7.6 2 8 7H4Z" />
        </svg>
      )}
      <span
        className={`absolute -bottom-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[10px] font-black shadow ${
          selected ? "bg-slate-950 text-white" : "bg-white text-slate-950"
        }`}
      >
        {player.number}
      </span>
    </span>
  );
}

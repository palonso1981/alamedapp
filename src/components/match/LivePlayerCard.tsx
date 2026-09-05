import { Player, PlayerMinutes } from "../../types";

export function LivePlayerCard({
  player,
  minutes,
  selected = false,
}: {
  player: Player;
  minutes: PlayerMinutes;
  selected?: boolean;
}) {
  const initials = player.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={`relative block h-full min-h-20 w-full overflow-hidden rounded-2xl border-2 bg-slate-800 shadow-lg ${selected ? "border-amber-200 ring-4 ring-amber-300/25" : "border-cyan-700/80"}`}>
      {player.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={player.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
      ) : (
        <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-700 to-slate-950">
          <span className="text-4xl font-black text-slate-400">{initials || player.number}</span>
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent px-2 pb-1.5 pt-8 text-left text-white">
        <span className="block truncate text-[11px] font-black leading-tight">{player.name}</span>
        <span className="mt-0.5 flex items-end justify-between gap-1">
          <strong className="text-xl leading-none text-cyan-200">#{player.number}</strong>
          <span className="text-sm font-black">{minutes.currentStintMinutes}&apos; <small className="text-[9px] font-semibold text-slate-400">({minutes.totalMinutes}&apos;)</small></span>
        </span>
      </span>
    </span>
  );
}

import { ReactNode } from "react";

import { Player } from "../../types";
import { PlayerImage } from "./PlayerImage";

/** Superficie fotográfica reutilizable para fichas visuales tipo cromo. */
export function PlayerPhotoCard({ player, selected = false, className = "", children }: {
  player: Pick<Player, "id" | "name" | "number" | "photoUrl">;
  selected?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const initials = player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className={`relative block overflow-hidden rounded-2xl border-2 bg-slate-800 shadow-lg ${selected ? "border-amber-200 ring-4 ring-amber-300/25" : "border-cyan-700/80"} ${className}`}>
    <PlayerImage src={player.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-top" fallback={<span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-700 to-slate-950"><span className="text-4xl font-black text-slate-400">{initials || player.number}</span></span>} />
    {children}
  </span>;
}

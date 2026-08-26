import { StaffMember } from "../../types";

export function StaffAvatar({ member, compact = false }: { member: StaffMember; compact?: boolean }) {
  const initials = member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <span role="img" aria-label={`Foto de ${member.name}`} className={`${compact ? "h-9 w-9" : "h-11 w-11"} grid shrink-0 place-items-center rounded-full border border-violet-300/70 bg-violet-950 bg-cover bg-center text-xs font-black text-violet-100`} style={member.photoUrl ? { backgroundImage: `url("${member.photoUrl}")` } : undefined}>
      {!member.photoUrl && initials}
    </span>
  );
}

import { Player, PlayerMinutes, StaffMember } from "../../types";
import { LivePlayerCard } from "./LivePlayerCard";
import { StaffAvatar } from "../player/StaffAvatar";
import { PlayerContextActions } from "./contextual/PlayerContextActions";

interface BenchPanelProps {
  players: Player[];
  staff: StaffMember[];
  playerMinutes: Record<string, PlayerMinutes>;
  replacementForLabel?: string;
  selectedPlayerId?: string;
  selectedStaffId?: string;
  onPlayerTap: (playerId: string) => void;
  onStaffTap: (staffId: string) => void;
  onYellow: (playerId: string) => void;
  onRed: (playerId: string) => void;
  onStaffCard: (staffId: string, color: "YELLOW" | "RED") => void;
  onCancel: () => void;
}

export function BenchPanel({ players, staff, playerMinutes, replacementForLabel, selectedPlayerId, selectedStaffId, onPlayerTap, onStaffTap, onYellow, onRed, onStaffCard, onCancel }: BenchPanelProps) {
  const selectedStaff = staff.find((member) => member.id === selectedStaffId);
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/95 p-2 shadow-xl">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Banquillo</h2>
          <span className="text-slate-600" aria-hidden="true">⇄</span>
          {replacementForLabel && <span className="text-xs font-bold text-amber-300">{replacementForLabel}</span>}
        </div>
        <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] text-slate-500">{players.length} + {staff.length}</span>
      </div>
      <div className="directo-bench-grid grid grid-cols-4 items-start gap-1 sm:grid-cols-6" data-testid="bench-grid">
        {players.map((player) => {
          const selected = selectedPlayerId === player.id;
          return (
            <button key={player.id} type="button" onClick={() => onPlayerTap(player.id)} className={`directo-bench-person min-h-32 min-w-0 rounded-2xl p-1 transition ${replacementForLabel ? "bg-amber-950/50 ring-2 ring-inset ring-amber-400" : selected ? "bg-cyan-950 ring-2 ring-inset ring-cyan-300" : "hover:bg-slate-800"}`} aria-label={replacementForLabel ? `${player.name} entra por ${replacementForLabel}` : `${player.name}, suplente`}>
              <LivePlayerCard player={player} minutes={playerMinutes[player.id] ?? { currentStintMinutes: 0, totalMinutes: 0, onCourt: false }} selected={selected} />
            </button>
          );
        })}
        {staff.map((member) => (
          <button key={member.id} type="button" onClick={() => onStaffTap(member.id)} className={`directo-bench-person directo-staff-person flex min-h-[64px] min-w-0 flex-col items-center justify-start rounded-xl px-0.5 py-1 ${selectedStaffId === member.id ? "bg-violet-950 ring-2 ring-inset ring-violet-300" : "hover:bg-slate-950"}`} aria-label={`${member.name}, ${member.role}, cuerpo técnico`}>
            <StaffAvatar member={member} compact />
            <span className="mt-0.5 max-w-full truncate text-[8px] font-bold leading-tight text-violet-100">{member.name}</span>
          </button>
        ))}
      </div>
      {selectedPlayerId && !replacementForLabel && (
        <div className="mt-2 rounded-xl border border-slate-700 bg-slate-950 p-1.5">
          <PlayerContextActions location="BENCH" showCancel onFoulCommitted={() => undefined} onFoulReceived={() => undefined} onPossessionLost={() => undefined} onYellow={() => onYellow(selectedPlayerId)} onRed={() => onRed(selectedPlayerId)} onRedOnly={() => undefined} onRedWithInferiority={() => undefined} onBack={() => undefined} onCancel={onCancel} />
        </div>
      )}
      {selectedStaff && (
        <div className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-violet-900 bg-slate-950 p-2">
          <span className="mr-2 truncate text-xs font-bold text-violet-100">{selectedStaff.name}</span>
          <button type="button" onClick={() => onStaffCard(selectedStaff.id, "YELLOW")} className="min-h-11 min-w-14 rounded-xl bg-amber-400 text-xl text-slate-950" aria-label={`Amarilla a ${selectedStaff.name}`}>▮</button>
          <button type="button" onClick={() => onStaffCard(selectedStaff.id, "RED")} className="min-h-11 min-w-14 rounded-xl bg-red-600 text-xl" aria-label={`Roja a ${selectedStaff.name}`}>▮</button>
          <button type="button" onClick={onCancel} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-xl">×</button>
        </div>
      )}
    </section>
  );
}

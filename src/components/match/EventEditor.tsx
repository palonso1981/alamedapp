"use client";

import { useMemo, useState } from "react";
import { EventEditChanges, REGULATION_MATCH_CLOCK } from "../../lib/matchEngine";
import { assistCandidates } from "../../lib/matchReview";
import { EventPosition, GoalAssist, LiveThreatOutcome, LiveThreatPhase, MatchEvent, Player, StaffMember, TimelineEntry } from "../../types";

const PHASES: LiveThreatPhase[] = ["POSITIONAL", "TRANSITION", "SET_PIECE_CORNER", "SET_PIECE_FREE_KICK", "SET_PIECE_KICK_IN", "FLYING_GOALKEEPER", "PENALTY", "DOUBLE_PENALTY"];

interface EventEditorProps {
  event: MatchEvent;
  entry?: TimelineEntry;
  players: Player[];
  staff: StaffMember[];
  onSave: (target: EventPosition, changes: EventEditChanges) => void;
  onClose: () => void;
}

export function EventEditor({ event, entry, players, staff, onSave, onClose }: EventEditorProps) {
  const [period, setPeriod] = useState(event.period);
  const [minute, setMinute] = useState(event.minute);
  const [order, setOrder] = useState(event.order);
  const [draft, setDraft] = useState<MatchEvent>(event);
  const scorerId = draft.type === "threat_recorded" ? draft.playerId : undefined;
  const assistIds = useMemo(
    () => entry ? assistCandidates(entry.lineupPlayerIds, scorerId) : [],
    [entry, scorerId],
  );

  const save = () => {
    const changes: EventEditChanges = { pendingReview: draft.pendingReview };
    if (draft.type === "substitution") changes.substitution = { playerOutId: draft.playerOutId, playerInId: draft.playerInId };
    if (draft.type === "threat_recorded") changes.threat = { side: draft.side, playerId: draft.playerId, origin: draft.origin, phase: draft.phase as LiveThreatPhase, outcome: draft.outcome, sequenceId: draft.sequenceId, parentEventId: draft.parentEventId, assist: draft.side === "FOR" && draft.outcome === "GOL" ? draft.assist ?? { status: "NONE" } : null };
    if (draft.type === "foul_recorded") changes.foul = { side: draft.side, playerId: draft.playerId, origin: draft.origin };
    if (draft.type === "card_recorded") changes.card = { side: draft.side, color: draft.color, playerId: draft.playerId ?? null, staffId: draft.staffId ?? null };
    if (draft.type === "game_state_changed") changes.gameState = { state: draft.state, active: draft.active };
    onSave({ period, minute, order }, changes);
  };

  const setAssist = (assist: GoalAssist) => {
    if (draft.type === "threat_recorded") setDraft({ ...draft, assist, pendingReview: assist.status === "PENDING" });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/80 p-2 sm:items-center" role="dialog" aria-modal="true" aria-label="Editor de evento">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><h3 className="font-black">Editar evento</h3><button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-xl">×</button></div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="P" value={period} min={1} max={REGULATION_MATCH_CLOCK.regulationPeriods} onChange={setPeriod} />
          <NumberField label="Min" value={minute} min={0} max={REGULATION_MATCH_CLOCK.periodDurationMinutes} onChange={setMinute} />
          <NumberField label="#" value={order} min={1} onChange={setOrder} />
        </div>

        {draft.type === "threat_recorded" && draft.source === "live" && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDraft({ ...draft, side: "FOR", playerId: draft.playerId ?? players[0]?.id })} className={`min-h-11 rounded-xl font-black ${draft.side === "FOR" ? "bg-cyan-700" : "bg-slate-800"}`}>CDA</button>
              <button type="button" onClick={() => setDraft({ ...draft, side: "AGAINST", playerId: undefined, assist: undefined })} className={`min-h-11 rounded-xl font-black ${draft.side === "AGAINST" ? "bg-rose-700" : "bg-slate-800"}`}>RIV</button>
            </div>
            <div className="grid grid-cols-3 gap-2">{(["GOL", "PARADA", "FUERA"] as LiveThreatOutcome[]).map((outcome) => <button key={outcome} type="button" onClick={() => setDraft({ ...draft, outcome, assist: outcome === "GOL" && draft.side === "FOR" ? draft.assist : undefined })} className={`min-h-12 rounded-xl font-black ${draft.outcome === outcome ? "bg-cyan-600" : "bg-slate-800"}`}>{outcome}</button>)}</div>
            {draft.side === "FOR" && <Select label="Jugador" value={draft.playerId ?? ""} onChange={(playerId) => setDraft({ ...draft, playerId })} options={players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` }))} />}
            <Select label="Fase" value={draft.phase} onChange={(phase) => setDraft({ ...draft, phase: phase as LiveThreatPhase })} options={PHASES.map((phase) => ({ value: phase, label: phase }))} />
            <div className="grid grid-cols-2 gap-2"><NumberField label="X (0–1)" value={draft.origin.x} min={0} max={1} step={0.01} onChange={(x) => setDraft({ ...draft, origin: { ...draft.origin, x } })} /><NumberField label="Y (0–1)" value={draft.origin.y} min={0} max={1} step={0.01} onChange={(y) => setDraft({ ...draft, origin: { ...draft.origin, y } })} /></div>
            {draft.side === "FOR" && draft.outcome === "GOL" && <AssistEditor assist={draft.assist} candidateIds={assistIds} players={players} onChange={setAssist} />}
            <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400"><summary className="cursor-pointer font-bold">Secuencia</summary><label className="mt-3 block">sequenceId<input value={draft.sequenceId ?? ""} onChange={(change) => setDraft({ ...draft, sequenceId: change.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2" /></label><label className="mt-2 block">parentEventId<input value={draft.parentEventId ?? ""} onChange={(change) => setDraft({ ...draft, parentEventId: change.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2" /></label></details>
          </div>
        )}

        {draft.type === "substitution" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><Select label="Sale" value={draft.playerOutId} onChange={(playerOutId) => setDraft({ ...draft, playerOutId })} options={[...players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` })), { value: "slot:inferiority", label: "INFERIORIDAD" }]} /><Select label="Entra" value={draft.playerInId} onChange={(playerInId) => setDraft({ ...draft, playerInId })} options={[...players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` })), { value: "slot:inferiority", label: "INFERIORIDAD" }]} /></div>}
        {draft.type === "foul_recorded" && <div className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Select label="Tipo" value={draft.side} onChange={(side) => setDraft({ ...draft, side: side as "FOR" | "AGAINST" })} options={[{ value: "FOR", label: "Cometida" }, { value: "AGAINST", label: "Recibida" }]} /><Select label="Jugador CDA" value={draft.playerId ?? ""} onChange={(playerId) => setDraft({ ...draft, playerId })} options={players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` }))} /></div><button type="button" onClick={() => setDraft({ ...draft, origin: draft.origin ? undefined : { x: 0.5, y: 0.5 } })} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-bold">{draft.origin ? "Quitar ubicación" : "Añadir ubicación"}</button>{draft.origin && <div className="grid grid-cols-2 gap-2"><NumberField label="X (0–1)" value={draft.origin.x} min={0} max={1} step={0.01} onChange={(x) => setDraft({ ...draft, origin: { ...draft.origin!, x } })} /><NumberField label="Y (0–1)" value={draft.origin.y} min={0} max={1} step={0.01} onChange={(y) => setDraft({ ...draft, origin: { ...draft.origin!, y } })} /></div>}</div>}
        {draft.type === "card_recorded" && <CardEditor event={draft} players={players} staff={staff} onChange={setDraft} />}
        {draft.type === "game_state_changed" && <div className="mt-4 grid grid-cols-2 gap-2"><Select label="Estado" value={draft.state} onChange={(state) => setDraft({ ...draft, state: state as typeof draft.state })} options={[{ value: "SUPERIORITY", label: "Superioridad" }, { value: "FLYING_GOALKEEPER", label: "Portero-jugador" }]} /><button type="button" onClick={() => setDraft({ ...draft, active: !draft.active })} className={`rounded-xl font-black ${draft.active ? "bg-emerald-600" : "bg-slate-800"}`}>{draft.active ? "ACTIVO" : "INACTIVO"}</button></div>}

        <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border border-amber-900 bg-amber-950/30 px-3"><input type="checkbox" checked={draft.pendingReview} onChange={(change) => setDraft({ ...draft, pendingReview: change.target.checked })} className="h-5 w-5" /><span className="font-bold text-amber-200">? Pendiente de revisión</span></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-slate-800 px-5 font-bold">Cancelar</button><button type="button" onClick={save} className="min-h-12 rounded-xl bg-cyan-600 px-6 font-black">Guardar y recalcular</button></div>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max?: number; step?: number; onChange: (value: number) => void }) { return <label className="text-[10px] font-bold uppercase text-slate-400">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-white" /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <label className="text-[10px] font-bold uppercase text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

function AssistEditor({ assist, candidateIds, players, onChange }: { assist?: GoalAssist; candidateIds: string[]; players: Player[]; onChange: (assist: GoalAssist) => void }) { return <div><p className="mb-2 text-[10px] font-bold uppercase text-slate-400">Asistencia</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{candidateIds.map((id) => { const player = players.find((candidate) => candidate.id === id); return player ? <button key={id} type="button" onClick={() => onChange({ status: "PLAYER", playerId: id })} className={`min-h-12 rounded-xl text-xs font-bold ${assist?.status === "PLAYER" && assist.playerId === id ? "bg-cyan-600" : "bg-slate-800"}`}>{player.number} · {player.name}</button> : null; })}<button type="button" onClick={() => onChange({ status: "NONE" })} className={`rounded-xl text-xs font-black ${assist?.status === "NONE" ? "bg-cyan-600" : "bg-slate-800"}`}>∅</button><button type="button" onClick={() => onChange({ status: "PENDING" })} className={`rounded-xl text-xs font-black ${assist?.status === "PENDING" ? "bg-amber-600" : "bg-slate-800"}`}>?</button></div></div>; }

function CardEditor({ event, players, staff, onChange }: { event: Extract<MatchEvent, { type: "card_recorded" }>; players: Player[]; staff: StaffMember[]; onChange: (event: MatchEvent) => void }) {
  const target = event.playerId ? `player:${event.playerId}` : event.staffId ? `staff:${event.staffId}` : "rival";
  const options = event.side === "AGAINST" ? [{ value: "rival", label: "Rival" }] : [...players.map((player) => ({ value: `player:${player.id}`, label: `${player.number} · ${player.name}` })), ...staff.map((member) => ({ value: `staff:${member.id}`, label: `${member.name} · ${member.role}` }))];
  return <div className="mt-4 grid gap-3 sm:grid-cols-3"><Select label="Equipo" value={event.side} onChange={(side) => onChange({ ...event, side: side as "FOR" | "AGAINST", playerId: side === "AGAINST" ? undefined : event.playerId ?? players[0]?.id, staffId: undefined })} options={[{ value: "FOR", label: "CDA" }, { value: "AGAINST", label: "Rival" }]} /><Select label="Tarjeta" value={event.color} onChange={(color) => onChange({ ...event, color: color as typeof event.color })} options={[{ value: "YELLOW", label: "Amarilla" }, { value: "RED", label: "Roja" }]} /><Select label="Persona" value={target} onChange={(value) => onChange({ ...event, playerId: value.startsWith("player:") ? value.slice(7) : undefined, staffId: value.startsWith("staff:") ? value.slice(6) : undefined })} options={options} /></div>;
}

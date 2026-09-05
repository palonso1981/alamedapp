"use client";

import { MouseEvent, useMemo, useState } from "react";
import { FutsalCourtMarkings } from "../court/FutsalCourtMarkings";
import { normalizeCourtPoint } from "../../lib/courtGeometry";
import { effectiveThreatPhase, EventEditChanges, REGULATION_MATCH_CLOCK } from "../../lib/matchEngine";
import { assistCandidates } from "../../lib/matchReview";
import { EventPosition, GoalAssist, GoalkeeperReference, GoalTargetCoordinates, KeeperBodyPart, LiveThreatOutcome, LiveThreatPhase, MatchEvent, Player, SaveOutcome, StaffMember, TimelineEntry } from "../../types";
import { isInsideGoalFrame } from "../../lib/goalTarget";
import { GoalTargetPicker, KeeperBodyPicker } from "./contextual/GoalTargetPicker";

const PHASES: LiveThreatPhase[] = ["POSITIONAL", "TRANSITION", "SET_PIECE_CORNER", "SET_PIECE_FREE_KICK", "SET_PIECE_KICK_IN", "FLYING_GOALKEEPER", "PENALTY", "DOUBLE_PENALTY"];

interface EventEditorProps {
  event: MatchEvent;
  events: MatchEvent[];
  entry?: TimelineEntry;
  players: Player[];
  staff: StaffMember[];
  onSave: (target: EventPosition, changes: EventEditChanges) => void;
  onClose: () => void;
}

export function EventEditor({ event, events, entry, players, staff, onSave, onClose }: EventEditorProps) {
  const [period, setPeriod] = useState(event.period);
  const [minute, setMinute] = useState(event.minute);
  const [order, setOrder] = useState(event.order);
  const [draft, setDraft] = useState<MatchEvent>(event);
  const scorerId = draft.type === "threat_recorded" ? draft.playerId : undefined;
  const inheritedPhase =
    draft.type === "threat_recorded" && draft.parentEventId
      ? effectiveThreatPhase(events, draft)
      : null;
  const assistIds = useMemo(
    () => entry ? assistCandidates(entry.lineupPlayerIds, scorerId) : [],
    [entry, scorerId],
  );

  const save = () => {
    const changes: EventEditChanges = { pendingReview: draft.pendingReview };
    if (draft.type === "substitution") changes.substitution = { playerOutId: draft.playerOutId, playerInId: draft.playerInId };
    if (draft.type === "threat_recorded") changes.threat = { side: draft.side, playerId: draft.playerId, origin: draft.origin, ...(!draft.parentEventId ? { phase: draft.phase as LiveThreatPhase } : {}), outcome: draft.outcome, sequenceId: draft.sequenceId, parentEventId: draft.parentEventId, restartEventId: draft.restartEventId, assist: draft.side === "FOR" && draft.outcome === "GOL" ? draft.assist ?? { status: "NONE" } : null, defensive: draft.side === "AGAINST" ? draft.defensive ?? null : null };
    if (draft.type === "foul_recorded") changes.foul = { side: draft.side, playerId: draft.playerId, origin: draft.origin };
    if (draft.type === "card_recorded") changes.card = { side: draft.side, color: draft.color, playerId: draft.playerId ?? null, staffId: draft.staffId ?? null };
    if (draft.type === "game_state_changed") changes.gameState = { state: draft.state, active: draft.active, playerId: draft.playerId, side: draft.side };
    if (draft.type === "restart_recorded") changes.restart = { side: draft.side, restart: draft.restart, spatialSide: draft.spatialSide };
    if (draft.type === "foul_count_adjusted") changes.foulAdjustment = { side: draft.side, delta: draft.delta };
    onSave({ period, minute, order }, changes);
  };

  const setAssist = (assist: GoalAssist) => {
    if (draft.type === "threat_recorded") setDraft({ ...draft, assist, pendingReview: assist.status === "PENDING" });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/80 p-2 sm:items-center" role="dialog" aria-modal="true" aria-label="Editor de evento">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-black">Editar evento</h3>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Origen · {draft.provenance === "MANUAL_REVIEW" ? "Revisión manual" : draft.provenance === "VIDEO" ? "Vídeo" : draft.provenance === "OFFICIAL_ACT" ? "Acta" : draft.provenance === "IMPORT" ? "Importación" : "Directo"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-xl">×</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="P" value={period} min={1} max={REGULATION_MATCH_CLOCK.regulationPeriods} onChange={setPeriod} />
          <NumberField label="Min" value={minute} min={0} max={REGULATION_MATCH_CLOCK.periodDurationMinutes} onChange={setMinute} />
          <NumberField label="#" value={order} min={1} onChange={setOrder} />
        </div>

        {draft.type === "threat_recorded" && draft.source === "live" && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setDraft({ ...draft, side: "FOR", playerId: draft.playerId ?? players[0]?.id, defensive: undefined })} className={`min-h-11 rounded-xl font-black ${draft.side === "FOR" ? "bg-cyan-700" : "bg-slate-800"}`}>CDA</button>
              <button type="button" onClick={() => setDraft({ ...draft, side: "AGAINST", playerId: undefined, assist: undefined })} className={`min-h-11 rounded-xl font-black ${draft.side === "AGAINST" ? "bg-rose-700" : "bg-slate-800"}`}>RIV</button>
            </div>
            {draft.side === "FOR" && <div className="grid grid-cols-3 gap-2">{(["GOL", "PARADA", "FUERA"] as LiveThreatOutcome[]).map((outcome) => <button key={outcome} type="button" onClick={() => setDraft({ ...draft, outcome, assist: outcome === "GOL" ? draft.assist : undefined })} className={`min-h-12 rounded-xl font-black ${draft.outcome === outcome ? "bg-cyan-600" : "bg-slate-800"}`}>{outcome}</button>)}</div>}
            {draft.side === "FOR" && <Select label="Jugador" value={draft.playerId ?? ""} onChange={(playerId) => setDraft({ ...draft, playerId })} options={players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` }))} />}
            {draft.parentEventId ? (
              <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-emerald-400">Fase heredada de la secuencia</p>
                <p className="mt-1 text-sm font-black text-emerald-100">{String(inheritedPhase ?? draft.phase).replaceAll("_", " ")}</p>
              </div>
            ) : (
              <Select label="Fase" value={draft.phase} onChange={(phase) => setDraft({ ...draft, phase: phase as LiveThreatPhase })} options={PHASES.map((phase) => ({ value: phase, label: phase }))} />
            )}
            <CourtPointEditor value={draft.origin} onChange={(origin) => setDraft({ ...draft, origin })} />
            {draft.side === "AGAINST" && (
              <DefensiveDetailEditor
                event={draft}
                lineupIds={entry?.lineupPlayerIds ?? []}
                flyingGoalkeeper={entry?.gameContexts.includes("FLYING_GOALKEEPER") ?? false}
                players={players}
                onChange={(defensiveEvent) => setDraft(defensiveEvent)}
              />
            )}
            {draft.side === "FOR" && draft.outcome === "GOL" && <AssistEditor assist={draft.assist} candidateIds={assistIds} players={players} onChange={setAssist} />}
            <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400"><summary className="cursor-pointer font-bold">Secuencia</summary><label className="mt-3 block">sequenceId<input value={draft.sequenceId ?? ""} onChange={(change) => setDraft({ ...draft, sequenceId: change.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2" /></label><label className="mt-2 block">parentEventId<input value={draft.parentEventId ?? ""} onChange={(change) => setDraft({ ...draft, parentEventId: change.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2" /></label></details>
          </div>
        )}

        {draft.type === "substitution" && <div className="mt-4 grid gap-3 sm:grid-cols-2"><Select label="Sale" value={draft.playerOutId} onChange={(playerOutId) => setDraft({ ...draft, playerOutId })} options={[...players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` })), { value: "slot:inferiority", label: "INFERIORIDAD" }]} /><Select label="Entra" value={draft.playerInId} onChange={(playerInId) => setDraft({ ...draft, playerInId })} options={[...players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` })), { value: "slot:inferiority", label: "INFERIORIDAD" }]} /></div>}
        {draft.type === "foul_recorded" && <div className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Select label="Tipo" value={draft.side} onChange={(side) => setDraft({ ...draft, side: side as "FOR" | "AGAINST" })} options={[{ value: "FOR", label: "Cometida" }, { value: "AGAINST", label: "Recibida" }]} /><Select label="Jugador CDA" value={draft.playerId ?? ""} onChange={(playerId) => setDraft({ ...draft, playerId: playerId || null })} options={[{ value: "", label: "Sin asignar" }, ...players.map((player) => ({ value: player.id, label: `${player.number} · ${player.name}` }))]} /></div><button type="button" onClick={() => setDraft({ ...draft, origin: draft.origin ? undefined : { x: 0.5, y: 0.5 } })} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-bold">{draft.origin ? "Quitar ubicación" : "Añadir ubicación"}</button>{draft.origin && <div className="grid grid-cols-2 gap-2"><NumberField label="X (0–1)" value={draft.origin.x} min={0} max={1} step={0.01} onChange={(x) => setDraft({ ...draft, origin: { ...draft.origin!, x } })} /><NumberField label="Y (0–1)" value={draft.origin.y} min={0} max={1} step={0.01} onChange={(y) => setDraft({ ...draft, origin: { ...draft.origin!, y } })} /></div>}</div>}
        {draft.type === "card_recorded" && <CardEditor event={draft} players={players} staff={staff} onChange={setDraft} />}
        {draft.type === "game_state_changed" && <div className="mt-4 grid grid-cols-2 gap-2"><Select label="Estado" value={draft.state} onChange={(state) => setDraft({ ...draft, state: state as typeof draft.state, playerId: state === "FLYING_GOALKEEPER" ? draft.playerId : undefined })} options={[{ value: "SUPERIORITY", label: "Superioridad" }, { value: "FLYING_GOALKEEPER", label: "Portero-jugador" }]} /><button type="button" onClick={() => setDraft({ ...draft, active: !draft.active, playerId: draft.active ? undefined : draft.playerId })} className={`rounded-xl font-black ${draft.active ? "bg-emerald-600" : "bg-slate-800"}`}>{draft.active ? "ACTIVO" : "INACTIVO"}</button>{draft.state === "FLYING_GOALKEEPER" && <Select label="Equipo" value={draft.side ?? "FOR"} onChange={(side) => setDraft({ ...draft, side: side as "FOR" | "AGAINST", playerId: side === "AGAINST" ? undefined : draft.playerId })} options={[{ value: "FOR", label: "CDA" }, { value: "AGAINST", label: "Rival" }]} />}{draft.state === "FLYING_GOALKEEPER" && draft.side !== "AGAINST" && draft.active && <div className="col-span-2"><Select label="Portero-jugador funcional" value={draft.playerId ?? ""} onChange={(playerId) => setDraft({ ...draft, playerId })} options={[{ value: "", label: "? Pendiente" }, ...(entry?.lineupPlayerIds ?? []).filter((id) => id !== "slot:inferiority").map((id) => { const player = players.find((candidate) => candidate.id === id); return { value: id, label: player ? `${player.number} · ${player.name}` : id }; })]} /></div>}</div>}
        {draft.type === "restart_recorded" && <div className="mt-4 grid grid-cols-3 gap-2"><Select label="Equipo" value={draft.side} onChange={(side) => setDraft({ ...draft, side: side as "FOR" | "AGAINST" })} options={[{ value: "FOR", label: "CDA" }, { value: "AGAINST", label: "Rival" }]} /><Select label="Reinicio" value={draft.restart} onChange={(restart) => setDraft({ ...draft, restart: restart as typeof draft.restart })} options={[{ value: "CORNER", label: "Córner" }, { value: "DANGEROUS_KICK_IN", label: "Banda cercana" }]} /><Select label="Lado" value={draft.spatialSide} onChange={(spatialSide) => setDraft({ ...draft, spatialSide: spatialSide as typeof draft.spatialSide })} options={[{ value: "TOP", label: "Superior" }, { value: "BOTTOM", label: "Inferior" }]} /></div>}
        {draft.type === "foul_count_adjusted" && <div className="mt-4 grid grid-cols-2 gap-2"><Select label="Equipo" value={draft.side} onChange={(side) => setDraft({ ...draft, side: side as "FOR" | "AGAINST" })} options={[{ value: "FOR", label: "CDA" }, { value: "AGAINST", label: "Rival" }]} /><Select label="Ajuste" value={String(draft.delta)} onChange={(delta) => setDraft({ ...draft, delta: Number(delta) as 1 | -1 })} options={[{ value: "1", label: "+1" }, { value: "-1", label: "−1" }]} /></div>}

        <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border border-amber-900 bg-amber-950/30 px-3"><input type="checkbox" checked={draft.pendingReview} onChange={(change) => setDraft({ ...draft, pendingReview: change.target.checked })} className="h-5 w-5" /><span className="font-bold text-amber-200">? Pendiente de revisión</span></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-slate-800 px-5 font-bold">Cancelar</button><button type="button" onClick={save} className="min-h-12 rounded-xl bg-cyan-600 px-6 font-black">Guardar y recalcular</button></div>
      </div>
    </div>
  );
}

function CourtPointEditor({ value, onChange }: { value: { x: number; y: number }; onChange: (value: { x: number; y: number }) => void }) {
  const select = (event: MouseEvent<HTMLButtonElement>) => {
    onChange(normalizeCourtPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()));
  };
  return <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Origen</p><button type="button" onClick={select} className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border-2 border-white/60 bg-[#075a9c]" aria-label="Editar origen sobre la pista"><FutsalCourtMarkings /><span className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} /></button></div>;
}

function DefensiveDetailEditor({ event, lineupIds, flyingGoalkeeper, players, onChange }: { event: Extract<MatchEvent, { type: "threat_recorded" }>; lineupIds: string[]; flyingGoalkeeper: boolean; players: Player[]; onChange: (event: MatchEvent) => void }) {
  const goalkeeper = event.defensive?.goalkeeper ?? { status: "PENDING" };
  const setTarget = (goalTarget: GoalTargetCoordinates) => {
    const inside = isInsideGoalFrame(goalTarget);
    const outcome = inside
      ? event.outcome === "GOL" || event.outcome === "PARADA" ? event.outcome : "GOL"
      : "FUERA";
    onChange({
      ...event,
      outcome,
      defensive: {
        version: 2,
        goalTarget,
        goalkeeper,
        keeperBodyPart: outcome === "PARADA" ? event.defensive?.version === 2 ? event.defensive.keeperBodyPart : undefined : undefined,
        saveOutcome: outcome === "PARADA" ? event.defensive?.saveOutcome : undefined,
      },
      pendingReview: goalkeeper.status === "PENDING" ? true : event.pendingReview,
    });
  };
  const setOutcome = (outcome: "GOL" | "PARADA") => onChange({
    ...event,
    outcome,
    defensive: event.defensive ? {
      version: 2,
      goalTarget: event.defensive.goalTarget,
      goalkeeper: event.defensive.goalkeeper,
      keeperBodyPart: outcome === "PARADA" && event.defensive.version === 2 ? event.defensive.keeperBodyPart : undefined,
      saveOutcome: outcome === "PARADA" ? event.defensive.saveOutcome : undefined,
    } : undefined,
  });
  const setBodyPart = (keeperBodyPart: KeeperBodyPart) => onChange({
    ...event,
    defensive: event.defensive ? {
      version: 2,
      goalTarget: event.defensive.goalTarget,
      goalkeeper: event.defensive.goalkeeper,
      keeperBodyPart,
      saveOutcome: event.defensive.saveOutcome,
    } : undefined,
  });
  const clearBodyPart = () => onChange({ ...event, defensive: event.defensive?.version === 2 ? { ...event.defensive, keeperBodyPart: undefined } : event.defensive });
  const setGoalkeeper = (reference: GoalkeeperReference) => onChange({ ...event, defensive: event.defensive ? { ...event.defensive, goalkeeper: reference.status === "PLAYER" ? { ...reference, resolution: "MANUAL" } : reference } : undefined, pendingReview: reference.status === "PENDING" ? true : event.pendingReview });
  const setSaveOutcome = (saveOutcome: SaveOutcome) => onChange({ ...event, defensive: event.defensive ? { ...event.defensive, saveOutcome } : undefined });
  const eligibleGoalkeepers = lineupIds.filter((id) => {
    const player = players.find((candidate) => candidate.id === id);
    return Boolean(player) && (flyingGoalkeeper || player?.position?.toUpperCase().includes("PORTERO"));
  });
  const inside = event.defensive ? isInsideGoalFrame(event.defensive.goalTarget) : false;
  return <div className="space-y-2 rounded-xl border border-rose-900 bg-rose-950/20 p-2"><div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase text-rose-200">Portería CDA</p>{!event.defensive && <span className="rounded-full bg-slate-800 px-2 py-1 text-[9px] text-slate-400">LEGACY · sin destino</span>}</div><GoalTargetPicker value={event.defensive?.goalTarget} onSelect={setTarget} compact />{event.defensive && <>{inside && <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setOutcome("GOL")} className={`min-h-12 rounded-xl font-black ${event.outcome === "GOL" ? "bg-rose-600" : "bg-slate-800"}`}>GOL</button><button type="button" onClick={() => setOutcome("PARADA")} className={`min-h-12 rounded-xl font-black ${event.outcome === "PARADA" ? "bg-sky-600" : "bg-slate-800"}`}>PARADA</button></div>}<Select label="Portero en el instante" value={goalkeeper.status === "PLAYER" ? goalkeeper.playerId : "PENDING"} onChange={(value) => setGoalkeeper(value === "PENDING" ? { status: "PENDING" } : { status: "PLAYER", playerId: value })} options={[...eligibleGoalkeepers.map((id) => { const player = players.find((candidate) => candidate.id === id)!; return { value: id, label: `${player.number} · ${player.name}` }; }), { value: "PENDING", label: "? Pendiente de identificar" }]} />{event.outcome === "PARADA" && <><KeeperBodyPicker onSelect={setBodyPart} selected={event.defensive.version === 2 ? event.defensive.keeperBodyPart : undefined} /><button type="button" onClick={clearBodyPart} className={`min-h-11 w-full rounded-xl text-xs font-black ${event.defensive.version === 2 && event.defensive.keeperBodyPart ? "bg-slate-800 text-slate-300" : "bg-cyan-950 text-cyan-200 ring-1 ring-cyan-700"}`}>SIN INDICAR</button><div className="grid grid-cols-3 gap-2">{([['CATCH','BLOCAJE'],['REBOUND','RECHACE'],['CLEARANCE','DESPEJE']] as Array<[SaveOutcome,string]>).map(([value,label]) => <button key={value} type="button" onClick={() => setSaveOutcome(value)} className={`min-h-11 rounded-xl text-[10px] font-black ${event.defensive?.saveOutcome === value ? "bg-sky-600" : "bg-slate-800"}`}>{label}</button>)}</div></>}</>}</div>;
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max?: number; step?: number; onChange: (value: number) => void }) { return <label className="text-[10px] font-bold uppercase text-slate-400">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-white" /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) { return <label className="text-[10px] font-bold uppercase text-slate-400">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

function AssistEditor({ assist, candidateIds, players, onChange }: { assist?: GoalAssist; candidateIds: string[]; players: Player[]; onChange: (assist: GoalAssist) => void }) { return <div><p className="mb-2 text-[10px] font-bold uppercase text-slate-400">Asistencia</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{candidateIds.map((id) => { const player = players.find((candidate) => candidate.id === id); return player ? <button key={id} type="button" onClick={() => onChange({ status: "PLAYER", playerId: id })} className={`min-h-12 rounded-xl text-xs font-bold ${assist?.status === "PLAYER" && assist.playerId === id ? "bg-cyan-600" : "bg-slate-800"}`}>{player.number} · {player.name}</button> : null; })}<button type="button" onClick={() => onChange({ status: "NONE" })} className={`rounded-xl text-xs font-black ${assist?.status === "NONE" ? "bg-cyan-600" : "bg-slate-800"}`}>∅</button><button type="button" onClick={() => onChange({ status: "PENDING" })} className={`rounded-xl text-xs font-black ${assist?.status === "PENDING" ? "bg-amber-600" : "bg-slate-800"}`}>?</button></div></div>; }

function CardEditor({ event, players, staff, onChange }: { event: Extract<MatchEvent, { type: "card_recorded" }>; players: Player[]; staff: StaffMember[]; onChange: (event: MatchEvent) => void }) {
  const target = event.playerId ? `player:${event.playerId}` : event.staffId ? `staff:${event.staffId}` : "rival";
  const options = event.side === "AGAINST" ? [{ value: "rival", label: "Rival" }] : [...players.map((player) => ({ value: `player:${player.id}`, label: `${player.number} · ${player.name}` })), ...staff.map((member) => ({ value: `staff:${member.id}`, label: `${member.name} · ${member.role}` }))];
  return <div className="mt-4 grid gap-3 sm:grid-cols-3"><Select label="Equipo" value={event.side} onChange={(side) => onChange({ ...event, side: side as "FOR" | "AGAINST", playerId: side === "AGAINST" ? undefined : event.playerId ?? players[0]?.id, staffId: undefined })} options={[{ value: "FOR", label: "CDA" }, { value: "AGAINST", label: "Rival" }]} /><Select label="Tarjeta" value={event.color} onChange={(color) => onChange({ ...event, color: color as typeof event.color })} options={[{ value: "YELLOW", label: "Amarilla" }, { value: "RED", label: "Roja" }]} /><Select label="Persona" value={target} onChange={(value) => onChange({ ...event, playerId: value.startsWith("player:") ? value.slice(7) : undefined, staffId: value.startsWith("staff:") ? value.slice(6) : undefined })} options={options} /></div>;
}

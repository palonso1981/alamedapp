"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { EventEditChanges } from "../../lib/matchEngine";
import { eventDescription } from "../../lib/eventPresentation";
import { filterTimelineEvents, TimelineFilter } from "../../lib/matchReview";
import { EventPosition, MatchEvent, Player, StaffMember, TimelineEntry } from "../../types";
import { EventEditor } from "./EventEditor";

interface RecentEventsPanelProps {
  events: MatchEvent[];
  timeline: TimelineEntry[];
  players: Player[];
  staff: StaffMember[];
  onDelete: (eventId: string) => void;
  onRestore: (eventId: string) => void;
  onPendingReview: (eventId: string, pending: boolean) => void;
  onSave: (eventId: string, target: EventPosition, changes: EventEditChanges) => void;
  onMoveWithinMinute: (eventId: string, targetEventId: string, placement: "BEFORE" | "AFTER") => void;
  errorMessage?: string | null;
  onDismissError?: () => void;
  disciplineFocusRequest?: DisciplineFocusRequest | null;
  activePeriod: number;
  matchFinished?: boolean;
  closedPeriods: number[];
  reviewPeriod?: number;
  onStartPeriodReview: (period: number) => void;
  onClose: () => void;
}

export interface DisciplineFocusRequest {
  token: number;
  side: "FOR" | "AGAINST";
  kind: "FOUL" | "CARD";
  period: number;
}

export function RecentEventsPanel({ events, timeline, players, staff, onDelete, onRestore, onPendingReview, onSave, onMoveWithinMinute, errorMessage, onDismissError, disciplineFocusRequest, activePeriod, matchFinished = false, closedPeriods, reviewPeriod, onStartPeriodReview, onClose }: RecentEventsPanelProps) {
  const [filter, setFilter] = useState<TimelineFilter>("ACTIVE");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ eventId: string; placement: "BEFORE" | "AFTER" } | null>(null);
  const [disciplineFocus, setDisciplineFocus] = useState<DisciplineFocusRequest | null>(null);
  const [reviewCandidate, setReviewCandidate] = useState<number | null>(null);
  const dragRef = useRef<{ eventId: string; pointerId: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    if (!disciplineFocusRequest) return;
    setDisciplineFocus(disciplineFocusRequest);
    setFilter("ACTIVE");
  }, [disciplineFocusRequest]);
  const filtered = disciplineFocus
    ? filterTimelineEvents(events, "ACTIVE").filter((event) =>
        disciplineFocus.kind === "FOUL"
          ? event.type === "foul_recorded" &&
            event.side === disciplineFocus.side &&
            event.period === disciplineFocus.period
          : event.type === "card_recorded" && event.side === disciplineFocus.side,
      )
    : filterTimelineEvents(events, filter);
  const visible = reviewPeriod
    ? filtered.filter((event) => event.period === reviewPeriod)
    : filtered;
  const displayed = visible;
  const pendingCount = events.filter(
    (event) =>
      event.pendingReview &&
      event.deletedAt === null &&
      event.type !== "lineup_initialized",
  ).length;
  const editingEvent = events.find((event) => event.id === editingId);
  const editingEntry = timeline.find((entry) => entry.event.id === editingId);

  const resetDrag = () => { dragRef.current = null; setDraggingId(null); setDropTarget(null); };
  const pointerDown = (pointer: PointerEvent<HTMLButtonElement>, event: MatchEvent) => {
    pointer.currentTarget.setPointerCapture(pointer.pointerId);
    dragRef.current = { eventId: event.id, pointerId: pointer.pointerId, startX: pointer.clientX, startY: pointer.clientY };
  };
  const pointerMove = (pointer: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointer.pointerId) return;
    if (!draggingId && Math.hypot(pointer.clientX - drag.startX, pointer.clientY - drag.startY) < 10) return;
    if (!draggingId) setDraggingId(drag.eventId);
    const source = events.find((event) => event.id === drag.eventId);
    const element = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>("[data-event-id]");
    const target = events.find((event) => event.id === element?.dataset.eventId);
    if (!source || !target || source.id === target.id || source.period !== target.period || source.minute !== target.minute || target.deletedAt !== null) { setDropTarget(null); return; }
    const bounds = element?.getBoundingClientRect();
    setDropTarget({ eventId: target.id, placement: bounds && pointer.clientY < bounds.top + bounds.height / 2 ? "AFTER" : "BEFORE" });
    pointer.preventDefault();
  };
  const pointerUp = (pointer: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag && draggingId && dropTarget) onMoveWithinMinute(drag.eventId, dropTarget.eventId, dropTarget.placement);
    if (pointer.currentTarget.hasPointerCapture(pointer.pointerId)) pointer.currentTarget.releasePointerCapture(pointer.pointerId);
    resetDrag();
  };

  return (
    <section className="directo-timeline-panel fixed inset-2 z-[60] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl sm:inset-6" aria-label="Historial completo" role="dialog">
      <div className="directo-timeline-toolbar mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-xs font-black uppercase tracking-wider text-slate-300">Cronología</h2><span className="rounded-full bg-slate-950 px-2 py-1 text-[10px] text-slate-400">{visible.length}/{events.length - 1}</span>{pendingCount > 0 && <span className="rounded-full bg-amber-950 px-2 py-1 text-[10px] font-black text-amber-200">? {pendingCount}</span>}{[1, 2].map((period) => { const active = activePeriod === period && !matchFinished; const closed = closedPeriods.includes(period); const reviewing = reviewPeriod === period; const canReview = closed && (matchFinished || period < activePeriod); const confirming = reviewCandidate === period; return <button key={period} type="button" disabled={!canReview || reviewing} onClick={() => { if (confirming) { onStartPeriodReview(period); setReviewCandidate(null); } else setReviewCandidate(period); }} className={`min-h-8 rounded-full px-2 text-[10px] font-black ${reviewing ? "bg-amber-400 text-slate-950" : active ? "bg-cyan-800 text-cyan-100" : canReview ? "bg-slate-800 text-slate-300" : "bg-slate-900 text-slate-600"}`} aria-label={confirming ? `Confirmar revisar P${period}` : `Periodo ${period}${active ? " activo" : closed ? " finalizado" : ""}`}>{confirming ? `REVISAR P${period}` : `P${period} ${active ? "●" : closed ? "✓" : ""}`}</button>; })}{disciplineFocus && <button type="button" onClick={() => setDisciplineFocus(null)} className="min-h-8 rounded-full bg-violet-950 px-2 text-[10px] font-black text-violet-200" aria-label="Quitar filtro disciplinario">{disciplineFocus.side === "FOR" ? "CDA" : "RIV"} · {disciplineFocus.kind === "FOUL" ? `F P${disciplineFocus.period}` : "▮"} ×</button>}</div>
        <div className="flex gap-1"><button type="button" onClick={() => { setDisciplineFocus(null); setFilter("ACTIVE"); }} className={`min-h-10 rounded-lg px-3 text-[10px] font-black ${filter === "ACTIVE" && !disciplineFocus ? "bg-cyan-700" : "bg-slate-800"}`}>ACTIVOS</button><button type="button" onClick={() => { setDisciplineFocus(null); setFilter("PENDING"); }} className={`min-h-10 rounded-lg px-3 text-[10px] font-black ${filter === "PENDING" && !disciplineFocus ? "bg-amber-700" : "bg-slate-800"}`}>? {pendingCount || ""}</button><button type="button" onClick={() => { setDisciplineFocus(null); setFilter("DELETED"); }} className={`min-h-10 rounded-lg px-3 text-[10px] font-black ${filter === "DELETED" && !disciplineFocus ? "bg-red-900" : "bg-slate-800"}`}>ELIMINADOS</button><button type="button" onClick={onClose} className="min-h-10 min-w-10 rounded-lg bg-slate-800 text-lg" aria-label="Cerrar historial">×</button></div>
      </div>
      {errorMessage && (
        <div role="alert" className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-500/60 bg-red-950/90 px-3 py-2 text-[11px] font-semibold leading-snug text-red-100">
          <span><strong className="text-red-300">No eliminado.</strong> {errorMessage}</span>
          {onDismissError && <button type="button" onClick={onDismissError} className="grid min-h-8 min-w-8 place-items-center rounded-lg bg-red-900 text-base" aria-label="Cerrar aviso de eliminación">×</button>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-800">
        <div className="sticky top-0 z-10 grid grid-cols-[58px_110px_minmax(0,1fr)_110px] bg-slate-950 px-2 py-1 text-[9px] font-bold uppercase text-slate-500"><span>Min</span><span>Tipo</span><span>Acción</span><span className="text-right">Revisar</span></div>
        {visible.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Sin eventos en este filtro.</p>}
        {displayed.map((event) => {
          const entry = timeline.find((candidate) => candidate.event.id === event.id);
          const deleted = event.deletedAt !== null;
          return (
            <div key={event.id} data-event-id={event.id} className={`grid min-h-11 grid-cols-[58px_110px_minmax(0,1fr)_110px] items-center border-t px-2 py-1 text-xs ${dropTarget?.eventId === event.id ? "border-cyan-300 bg-cyan-950" : "border-slate-800"} ${deleted ? "opacity-60" : ""}`}>
              <span className="font-mono text-[10px] font-black text-cyan-300">P{event.period} {String(event.minute).padStart(2, "0")}&apos;</span>
              <span className="truncate text-[10px] font-bold uppercase text-slate-500" aria-hidden="true">{event.type.replaceAll("_", " ")}</span>
              <button type="button" onClick={() => setEditingId(event.id)} className="min-w-0 truncate text-left font-semibold text-slate-100">{eventDescription(event, players, entry, staff)}</button>
              <div className="flex justify-end gap-1">
                {!deleted && <button type="button" onClick={() => onPendingReview(event.id, !event.pendingReview)} className={`min-h-9 min-w-9 rounded-lg text-base font-black ${event.pendingReview ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-500"}`} aria-label={event.pendingReview ? "Quitar pendiente" : "Marcar pendiente"}>?</button>}
                {!deleted && <button type="button" onPointerDown={(pointer) => pointerDown(pointer, event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={resetDrag} className="hidden min-h-9 min-w-9 touch-none rounded-lg bg-slate-800 text-base text-slate-400 sm:block" aria-label="Reordenar dentro del mismo minuto">⠿</button>}
                <button type="button" onClick={() => deleted ? onRestore(event.id) : onDelete(event.id)} className="min-h-9 min-w-9 rounded-lg bg-slate-800 text-base" aria-label={deleted ? "Restaurar" : "Eliminar"}>{deleted ? "↺" : "×"}</button>
              </div>
            </div>
          );
        })}
      </div>
      {editingEvent && <EventEditor event={editingEvent} events={events} entry={editingEntry} players={players} staff={staff} onClose={() => setEditingId(null)} onSave={(target, changes) => { onSave(editingEvent.id, target, changes); setEditingId(null); }} />}
    </section>
  );
}

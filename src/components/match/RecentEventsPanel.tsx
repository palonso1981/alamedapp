"use client";

import { PointerEvent, useRef, useState } from "react";

import {
  EventEditChanges,
  normalizeMatchClock,
  REGULATION_MATCH_CLOCK,
} from "../../lib/matchEngine";
import {
  contextLabel,
  eventDescription,
} from "../../lib/eventPresentation";
import {
  EventPosition,
  LiveThreatOutcome,
  LiveThreatPhase,
  MatchEvent,
  Player,
  TimelineEntry,
} from "../../types";

const EDIT_PHASES: Array<{ value: LiveThreatPhase; label: string }> = [
  { value: "POSITIONAL", label: "Pos." },
  { value: "TRANSITION", label: "Trans." },
  { value: "SET_PIECE_CORNER", label: "Córner" },
  { value: "SET_PIECE_FREE_KICK", label: "Falta" },
  { value: "SET_PIECE_KICK_IN", label: "Banda" },
  { value: "FLYING_GOALKEEPER", label: "P-J" },
  { value: "PENALTY", label: "6m" },
  { value: "DOUBLE_PENALTY", label: "10m" },
];

interface EventDraft {
  period: number;
  minute: number;
  order: number;
  outcome?: LiveThreatOutcome;
  phase?: LiveThreatPhase;
  cardColor?: "YELLOW" | "RED";
  stateActive?: boolean;
  playerId?: string;
}

interface RecentEventsPanelProps {
  events: MatchEvent[];
  timeline: TimelineEntry[];
  players: Player[];
  onDelete: (eventId: string) => void;
  onRestore: (eventId: string) => void;
  onSave: (
    eventId: string,
    target: EventPosition,
    changes: EventEditChanges,
  ) => void;
  onMoveWithinMinute: (
    eventId: string,
    targetEventId: string,
    placement: "BEFORE" | "AFTER",
  ) => void;
}

function draftFor(event: MatchEvent): EventDraft {
  const draft: EventDraft = {
    period: event.period,
    minute: event.minute,
    order: event.order,
  };
  if (event.type === "threat_recorded" && event.source === "live") {
    draft.outcome = event.outcome;
    draft.phase = event.phase;
  } else if (event.type === "card_recorded") {
    draft.cardColor = event.color;
    draft.playerId = event.playerId;
  } else if (event.type === "foul_recorded") {
    draft.playerId = event.playerId;
  } else if (event.type === "game_state_changed") {
    draft.stateActive = event.active;
  }
  return draft;
}

function editChanges(event: MatchEvent, draft: EventDraft): EventEditChanges {
  if (event.type === "threat_recorded" && event.source === "live") {
    return {
      threat: {
        outcome: draft.outcome ?? event.outcome,
        phase: draft.phase ?? event.phase,
      },
    };
  }
  if (event.type === "card_recorded") {
    return {
      card: {
        color: draft.cardColor ?? event.color,
        playerId: draft.playerId ?? event.playerId,
      },
    };
  }
  if (event.type === "foul_recorded") {
    return { foul: { playerId: draft.playerId ?? event.playerId } };
  }
  if (event.type === "game_state_changed") {
    return { gameState: { active: draft.stateActive ?? event.active } };
  }
  return {};
}

export function RecentEventsPanel({
  events,
  timeline,
  players,
  onDelete,
  onRestore,
  onSave,
  onMoveWithinMinute,
}: RecentEventsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    eventId: string;
    placement: "BEFORE" | "AFTER";
  } | null>(null);
  const dragRef = useRef<{
    eventId: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const startEditing = (event: MatchEvent) => {
    setEditingId(event.id);
    setDraft(draftFor(event));
  };

  const resetDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const handlePointerDown = (
    pointer: PointerEvent<HTMLButtonElement>,
    event: MatchEvent,
  ) => {
    pointer.currentTarget.setPointerCapture(pointer.pointerId);
    dragRef.current = {
      eventId: event.id,
      pointerId: pointer.pointerId,
      startX: pointer.clientX,
      startY: pointer.clientY,
    };
  };

  const handlePointerMove = (pointer: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointer.pointerId) return;
    const distance = Math.hypot(
      pointer.clientX - drag.startX,
      pointer.clientY - drag.startY,
    );
    if (!draggingId && distance < 10) return;
    if (!draggingId) setDraggingId(drag.eventId);

    const source = events.find((event) => event.id === drag.eventId);
    const targetElement = document
      .elementFromPoint(pointer.clientX, pointer.clientY)
      ?.closest<HTMLElement>("[data-event-id]");
    const target = events.find(
      (event) => event.id === targetElement?.dataset.eventId,
    );
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.period !== target.period ||
      source.minute !== target.minute ||
      target.deletedAt !== null
    ) {
      setDropTarget(null);
      return;
    }
    const bounds = targetElement?.getBoundingClientRect();
    const appearsBefore = bounds
      ? pointer.clientY < bounds.top + bounds.height / 2
      : true;
    setDropTarget({
      eventId: target.id,
      // La lista se pinta en orden descendente: arriba equivale a más tarde.
      placement: appearsBefore ? "AFTER" : "BEFORE",
    });
    pointer.preventDefault();
  };

  const handlePointerUp = (pointer: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag && draggingId && dropTarget) {
      onMoveWithinMinute(
        drag.eventId,
        dropTarget.eventId,
        dropTarget.placement,
      );
    }
    if (pointer.currentTarget.hasPointerCapture(pointer.pointerId)) {
      pointer.currentTarget.releasePointerCapture(pointer.pointerId);
    }
    resetDrag();
  };

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl bg-gray-900 p-3 shadow-xl sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold">Recientes</h2>
          <p className="text-xs text-gray-500">Toque directo para corregir</p>
        </div>
        <span className="rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-400">
          {events.length}
        </span>
      </div>

      <div className="grid flex-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
        {events.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-700 p-5 text-center text-sm text-gray-500">
            Los últimos eventos aparecerán aquí.
          </div>
        )}

        {events.map((event) => {
          const entry = timeline.find((candidate) => candidate.event.id === event.id);
          const editing = editingId === event.id && draft;
          const deleted = event.deletedAt !== null;
          return (
            <article
              key={event.id}
              data-event-id={event.id}
              className={`rounded-xl border p-3 text-sm ${
                dropTarget?.eventId === event.id
                  ? "border-cyan-300 ring-2 ring-cyan-400/40"
                  : ""
              } ${
                deleted
                  ? "border-dashed border-gray-700 bg-gray-950/70 opacity-60"
                  : "border-gray-800 bg-gray-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold text-cyan-300">
                    P{event.period} · {event.minute}&apos; · #{event.order}
                  </span>
                  <p className="truncate font-semibold text-gray-100">
                    {eventDescription(event, players, entry)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {deleted ? (
                    <button
                      type="button"
                      onClick={() => onRestore(event.id)}
                      className="rounded-lg bg-cyan-950 px-2 py-1 text-xs font-bold text-cyan-200"
                    >
                      Restaurar
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onPointerDown={(pointer) =>
                          handlePointerDown(pointer, event)
                        }
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={resetDrag}
                        className="grid min-h-10 min-w-10 touch-none place-items-center rounded-lg bg-gray-950 text-xl text-gray-400 active:cursor-grabbing"
                        aria-label={`Reordenar ${eventDescription(event, players, entry)}`}
                        title="Arrastra dentro del mismo minuto"
                      >
                        ⠿
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditing(event)}
                        className="rounded-lg bg-gray-700 px-2 py-1 text-xs font-bold hover:bg-gray-600"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(event.id)}
                        className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-red-950 hover:text-red-200"
                        aria-label={`Eliminar ${eventDescription(event, players, entry)}`}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              </div>

              {entry && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {entry.gameContexts.map((context) => (
                    <span
                      key={context}
                      className="rounded bg-gray-950 px-1.5 py-0.5 text-[9px] font-bold text-gray-400"
                    >
                      {contextLabel(context)}
                    </span>
                  ))}
                </div>
              )}

              {editing && (
                <div className="mt-3 space-y-2 border-t border-gray-700 pt-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(["period", "minute", "order"] as const).map((field) => (
                      <label key={field} className="text-[9px] uppercase text-gray-500">
                        {field === "period" ? "P" : field === "minute" ? "Min" : "Orden"}
                        <input
                          type="number"
                          min={field === "period" || field === "order" ? 1 : 0}
                          max={
                            field === "period"
                              ? REGULATION_MATCH_CLOCK.regulationPeriods
                              : field === "minute"
                                ? REGULATION_MATCH_CLOCK.periodDurationMinutes
                                : undefined
                          }
                          value={draft[field]}
                          onChange={(change) =>
                            setDraft({
                              ...draft,
                              [field]: Number(change.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-2 text-center text-sm text-white"
                        />
                      </label>
                    ))}
                  </div>

                  {event.type === "threat_recorded" && event.source === "live" && (
                    <>
                      <div className="grid grid-cols-3 gap-1">
                        {(["GOL", "PARADA", "FUERA"] as const).map((outcome) => (
                          <button
                            key={outcome}
                            type="button"
                            onClick={() => setDraft({ ...draft, outcome })}
                            className={`rounded-lg px-1 py-2 text-[10px] font-bold ${
                              draft.outcome === outcome ? "bg-cyan-600" : "bg-gray-950"
                            }`}
                          >
                            {outcome}
                          </button>
                        ))}
                      </div>
                      <select
                        value={draft.phase}
                        onChange={(change) =>
                          setDraft({
                            ...draft,
                            phase: change.target.value as LiveThreatPhase,
                          })
                        }
                        className="w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-2 text-xs"
                        aria-label="Fase de la amenaza"
                      >
                        {EDIT_PHASES.map((phase) => (
                          <option key={phase.value} value={phase.value}>
                            {phase.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {event.type === "card_recorded" && (
                    <div className="grid grid-cols-2 gap-1">
                      {(["YELLOW", "RED"] as const).map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setDraft({ ...draft, cardColor: color })}
                          className={`rounded-lg px-2 py-2 font-bold ${
                            draft.cardColor === color ? "ring-2 ring-white" : "opacity-60"
                          } ${color === "YELLOW" ? "bg-yellow-400 text-black" : "bg-red-600"}`}
                        >
                          {color === "YELLOW" ? "AMARILLA" : "ROJA"}
                        </button>
                      ))}
                    </div>
                  )}

                  {(event.type === "foul_recorded" ||
                    (event.type === "card_recorded" && event.side === "FOR")) && (
                    <label className="block text-[9px] uppercase text-gray-500">
                      Jugador CDA
                      <select
                        value={draft.playerId ?? ""}
                        onChange={(change) =>
                          setDraft({ ...draft, playerId: change.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 py-2 text-xs text-white"
                      >
                        {players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.number}. {player.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {event.type === "game_state_changed" && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, stateActive: !draft.stateActive })
                      }
                      className={`w-full rounded-lg py-2 text-xs font-bold ${
                        draft.stateActive ? "bg-emerald-600" : "bg-gray-950"
                      }`}
                    >
                      {draft.stateActive ? "ACTIVAR" : "DESACTIVAR"}
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const clock = normalizeMatchClock(
                          draft.period,
                          draft.minute,
                        );
                        onSave(
                          event.id,
                          {
                            ...clock,
                            order: Math.max(1, Math.trunc(draft.order)),
                          },
                          editChanges(event, draft),
                        );
                        setEditingId(null);
                        setDraft(null);
                      }}
                      className="rounded-lg bg-emerald-600 py-2 text-xs font-bold"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setDraft(null);
                      }}
                      className="rounded-lg bg-gray-700 py-2 text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}

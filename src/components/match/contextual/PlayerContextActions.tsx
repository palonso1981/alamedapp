"use client";

import { consumeContextualPointer } from "../../../lib/liveInteraction";

interface PlayerContextActionsProps {
  location: "COURT" | "BENCH";
  redDecision?: boolean;
  showCancel?: boolean;
  captureBlocked?: boolean;
  onFoulCommitted: () => void;
  onFoulReceived: () => void;
  onYellow: () => void;
  onRed: () => void;
  onRedOnly: () => void;
  onRedWithInferiority: () => void;
  onBack: () => void;
  onCancel: () => void;
}

function CardGlyph({ color }: { color: "yellow" | "red" }) {
  return (
    <span
      className={`block h-7 w-5 rotate-3 rounded-sm border border-white/60 shadow ${
        color === "yellow" ? "bg-yellow-400" : "bg-red-500"
      }`}
      aria-hidden="true"
    />
  );
}

function FoulDirectionGlyph({ direction }: { direction: "OUT" | "IN" }) {
  const outgoing = direction === "OUT";
  return (
    <svg viewBox="0 0 52 30" className="h-8 w-14" aria-hidden="true">
      <circle cx={outgoing ? 8 : 44} cy="8" r="4" fill="currentColor" />
      <path d={outgoing ? "M3 26c1-8 3-11 5-11s4 3 5 11" : "M39 26c1-8 3-11 5-11s4 3 5 11"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d={outgoing ? "M17 15h20" : "M35 15H15"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d={outgoing ? "m32 10 6 5-6 5" : "m20 10-6 5 6 5"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={outgoing ? "m45 7 1.5 4 4 .5-3 2.7 1 4.1-3.5-2.1-3.5 2.1 1-4.1-3-2.7 4-.5z" : "m7 7 1.5 4 4 .5-3 2.7 1 4.1L7 16.2l-3.5 2.1 1-4.1-3-2.7 4-.5z"} fill="currentColor" />
    </svg>
  );
}

export function PlayerContextActions({
  location,
  redDecision = false,
  showCancel = false,
  captureBlocked = false,
  onFoulCommitted,
  onFoulReceived,
  onYellow,
  onRed,
  onRedOnly,
  onRedWithInferiority,
  onBack,
  onCancel,
}: PlayerContextActionsProps) {
  const consumePointer = (event: React.SyntheticEvent) => consumeContextualPointer(event.nativeEvent);
  if (captureBlocked) {
    return (
      <div onPointerDown={consumePointer} onPointerUp={consumePointer} onClick={consumePointer} className="rounded-xl border border-red-500/60 bg-red-950/90 p-3 text-center text-xs font-black text-red-100">
        <span className="text-2xl" aria-hidden="true">⇄</span>
        <p>Repara con banquillo o cronología</p>
        <button type="button" onClick={onCancel} className="mt-2 min-h-12 w-full rounded-lg bg-slate-800">×</button>
      </div>
    );
  }
  if (redDecision) {
    return (
      <div onPointerDown={consumePointer} onPointerUp={consumePointer} onClick={consumePointer} className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRedOnly}
          className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-red-900 bg-slate-800 px-2 text-xs font-black text-white"
        >
          <CardGlyph color="red" />
          <span>Solo tarjeta</span>
        </button>
        <button
          type="button"
          onClick={onRedWithInferiority}
          className="flex min-h-16 items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-700 px-2 text-xs font-black text-white"
        >
          <CardGlyph color="red" />
          <span>+ ▼ 4v5</span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="col-span-2 min-h-12 rounded-xl text-xs font-bold text-slate-400"
        >
          ↶
        </button>
      </div>
    );
  }

  return (
    <div onPointerDown={consumePointer} onPointerUp={consumePointer} onClick={consumePointer} className="relative">
      {showCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="absolute -right-1 -top-1 z-10 grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-lg text-slate-400"
          aria-label="Cerrar acciones del jugador"
        >
          ×
        </button>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {location === "COURT" && (
          <>
            <button
              type="button"
              onClick={onFoulCommitted}
              className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-orange-700 bg-orange-950/90 px-1 text-orange-100"
              aria-label="Comete falta"
            >
              <FoulDirectionGlyph direction="OUT" />
              <span className="mt-1 text-[9px] font-black">COMETE</span>
            </button>
            <button
              type="button"
              onClick={onFoulReceived}
              className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-sky-700 bg-sky-950/90 px-1 text-sky-100"
              aria-label="Recibe falta"
            >
              <FoulDirectionGlyph direction="IN" />
              <span className="mt-1 text-[9px] font-black">RECIBE</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onYellow}
          className="flex min-h-14 items-center justify-center rounded-xl border border-yellow-700 bg-yellow-950/90 px-1"
          aria-label="Tarjeta amarilla"
        >
          <CardGlyph color="yellow" />
        </button>
        <button
          type="button"
          onClick={onRed}
          className="flex min-h-14 items-center justify-center rounded-xl border border-red-700 bg-red-950/90 px-1"
          aria-label="Tarjeta roja"
        >
          <CardGlyph color="red" />
        </button>
      </div>
    </div>
  );
}

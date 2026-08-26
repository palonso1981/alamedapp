"use client";

interface PlayerContextActionsProps {
  location: "COURT" | "BENCH";
  redDecision?: boolean;
  showCancel?: boolean;
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

function WhistleGlyph({ direction }: { direction: "OUT" | "IN" }) {
  return (
    <span className="flex items-center gap-0.5 text-xl font-black" aria-hidden="true">
      {direction === "IN" && <span>←</span>}
      <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-current text-xs">●</span>
      {direction === "OUT" && <span>→</span>}
    </span>
  );
}

export function PlayerContextActions({
  location,
  redDecision = false,
  showCancel = false,
  onFoulCommitted,
  onFoulReceived,
  onYellow,
  onRed,
  onRedOnly,
  onRedWithInferiority,
  onBack,
  onCancel,
}: PlayerContextActionsProps) {
  if (redDecision) {
    return (
      <div className="grid grid-cols-2 gap-2">
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
          className="col-span-2 min-h-10 rounded-xl text-xs font-bold text-slate-400"
        >
          ↶
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {showCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="absolute -right-1 -top-1 z-10 grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-lg text-slate-400"
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
              <WhistleGlyph direction="OUT" />
              <span className="mt-1 text-[9px] font-black">COMETE</span>
            </button>
            <button
              type="button"
              onClick={onFoulReceived}
              className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-sky-700 bg-sky-950/90 px-1 text-sky-100"
              aria-label="Recibe falta"
            >
              <WhistleGlyph direction="IN" />
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

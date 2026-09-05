export function MatchSteamDeck({
  flyingGoalkeeperFor,
  flyingGoalkeeperAgainst,
  superiority,
  inferiority,
  changeActive,
  canUndo,
  canRedo,
  onFlyingGoalkeeperFor,
  onFlyingGoalkeeperAgainst,
  onChange,
  onBench,
  onFlip,
  onUndo,
  onRedo,
}: {
  flyingGoalkeeperFor: boolean;
  flyingGoalkeeperAgainst: boolean;
  superiority: boolean;
  inferiority: boolean;
  changeActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onFlyingGoalkeeperFor: () => void;
  onFlyingGoalkeeperAgainst: () => void;
  onChange: () => void;
  onBench: () => void;
  onFlip: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <section className="directo-steam-deck mx-auto mb-2 grid max-w-7xl grid-cols-4 gap-2 rounded-3xl border border-slate-700 bg-slate-900/95 p-2 shadow-xl sm:grid-cols-8" aria-label="Controles tácticos del partido">
      <DeckToggle active={flyingGoalkeeperFor} label="PJ CDA" icon="◇⁺" onClick={onFlyingGoalkeeperFor} tone="cyan" />
      <DeckToggle active={flyingGoalkeeperAgainst} label="PJ RIVAL" icon="◇⁺" onClick={onFlyingGoalkeeperAgainst} tone="rose" />
      <div className={`grid min-h-16 place-items-center rounded-2xl border-2 px-2 text-center font-black ${inferiority ? "border-red-300 bg-red-900 text-white" : superiority ? "border-amber-200 bg-amber-400 text-slate-950" : "border-slate-700 bg-slate-950 text-slate-500"}`}>
        <strong className="text-xl">{inferiority ? "4v5" : superiority ? "5v4" : "5v5"}</strong>
        <span className="text-[8px]">{inferiority ? "INFERIORIDAD" : superiority ? "SUPERIORIDAD" : "IGUALDAD"}</span>
      </div>
      <button type="button" onClick={onChange} className={`min-h-16 rounded-2xl border-2 text-sm font-black active:scale-95 ${changeActive ? "border-amber-100 bg-amber-400 text-slate-950" : "border-amber-500 bg-amber-950 text-amber-100"}`}>⇄<span className="block text-[10px]">CAMBIO</span></button>
      <button type="button" onClick={onBench} className="min-h-16 rounded-2xl border border-violet-500 bg-violet-950 text-xl font-black text-violet-100 active:scale-95">▦<span className="block text-[10px]">BANCO</span></button>
      <button type="button" onClick={onFlip} className="min-h-16 rounded-2xl border border-sky-600 bg-sky-950 text-2xl font-black text-sky-100 active:scale-95" aria-label="Girar campo">↔<span className="block text-[9px]">GIRAR</span></button>
      <button type="button" disabled={!canUndo} onClick={onUndo} className="min-h-16 rounded-2xl border border-slate-500 bg-slate-800 text-2xl font-black active:scale-95 disabled:opacity-25" aria-label="Deshacer">↶<span className="block text-[9px]">DESHACER</span></button>
      <button type="button" disabled={!canRedo} onClick={onRedo} className="min-h-16 rounded-2xl border border-slate-700 bg-slate-950 text-xl font-black text-slate-400 active:scale-95 disabled:opacity-20" aria-label="Rehacer">↷<span className="block text-[9px]">REHACER</span></button>
    </section>
  );
}

function DeckToggle({ active, label, icon, tone, onClick }: { active: boolean; label: string; icon: string; tone: "cyan" | "rose"; onClick: () => void }) {
  const activeClass = tone === "cyan" ? "border-cyan-100 bg-cyan-500 text-slate-950 ring-cyan-200" : "border-rose-100 bg-rose-600 text-white ring-rose-200";
  return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-16 rounded-2xl border-2 text-xl font-black active:scale-95 ${active ? `${activeClass} ring-2` : "border-slate-600 bg-slate-950 text-slate-400"}`}>{icon}<span className="block text-[10px]">{label}</span></button>;
}

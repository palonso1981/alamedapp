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
  onSuperiority,
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
  onSuperiority: () => void;
  onChange: () => void;
  onBench: () => void;
  onFlip: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <section className="directo-steam-deck grid grid-cols-4 gap-1.5 sm:grid-cols-[repeat(4,minmax(5.25rem,1fr))_3.25rem_repeat(3,2.75rem)]" aria-label="Controles tácticos del partido">
      <DeckToggle active={flyingGoalkeeperFor} label="PJ CDA" icon="◇⁺" onClick={onFlyingGoalkeeperFor} tone="cyan" />
      <DeckToggle active={flyingGoalkeeperAgainst} label="PJ RIVAL" icon="◇⁺" onClick={onFlyingGoalkeeperAgainst} tone="rose" />
      <button type="button" onClick={onChange} className={`min-h-14 rounded-xl border-2 text-lg font-black active:scale-95 ${changeActive ? "border-amber-100 bg-amber-400 text-slate-950" : "border-amber-500 bg-amber-950 text-amber-100"}`}>⇄<span className="ml-1 text-[10px]">CAMBIO</span></button>
      <button type="button" onClick={onBench} className="min-h-14 rounded-xl border border-violet-500 bg-violet-950 text-lg font-black text-violet-100 active:scale-95">▦<span className="ml-1 text-[10px]">BANCO</span></button>
      <button type="button" onClick={onSuperiority} disabled={inferiority} aria-pressed={superiority} className={`grid min-h-11 place-items-center rounded-xl border px-1 text-center font-black active:scale-95 disabled:cursor-not-allowed ${inferiority ? "border-red-300 bg-red-900 text-white" : superiority ? "border-amber-200 bg-amber-400 text-slate-950" : "border-slate-700 bg-slate-950 text-slate-500"}`} aria-label={inferiority ? "Inferioridad 4 contra 5" : superiority ? "Superioridad 5 contra 4 activa" : "Igualdad 5 contra 5; activar superioridad"}>
        <strong className="text-sm">{inferiority ? "4v5" : superiority ? "5v4" : "5v5"}</strong>
      </button>
      <button type="button" onClick={onFlip} className="min-h-11 rounded-xl border border-sky-800 bg-sky-950 text-xl font-black text-sky-200 active:scale-95" aria-label="Girar campo" title="Girar campo">↔</button>
      <button type="button" disabled={!canUndo} onClick={onUndo} className="min-h-11 rounded-xl border border-slate-700 bg-slate-800 text-xl font-black active:scale-95 disabled:opacity-25" aria-label="Deshacer" title="Deshacer">↶</button>
      <button type="button" disabled={!canRedo} onClick={onRedo} className="min-h-11 rounded-xl border border-slate-800 bg-slate-950 text-xl font-black text-slate-400 active:scale-95 disabled:opacity-20" aria-label="Rehacer" title="Rehacer">↷</button>
    </section>
  );
}

function DeckToggle({ active, label, icon, tone, onClick }: { active: boolean; label: string; icon: string; tone: "cyan" | "rose"; onClick: () => void }) {
  const activeClass = tone === "cyan" ? "border-cyan-100 bg-cyan-500 text-slate-950 ring-cyan-200" : "border-rose-100 bg-rose-600 text-white ring-rose-200";
  return <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-14 rounded-xl border-2 text-lg font-black active:scale-95 ${active ? `${activeClass} ring-2` : "border-slate-600 bg-slate-950 text-slate-300"}`}>{icon}<span className="ml-1 text-[10px]">{label}</span></button>;
}

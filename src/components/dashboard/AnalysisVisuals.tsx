import { KeeperBodyPart, SaveOutcome } from "../../types";
import { GoalkeeperAnalysis, PitchOriginZone, ZoneStats } from "../../lib/dashboardAnalysis";
import { GoalZoneV1 } from "../../lib/spatialZones";

const BODY_LABEL: Record<KeeperBodyPart, string> = {
  HEAD: "CABEZA",
  TORSO: "TRONCO",
  LEFT_ARM_HAND: "BRAZO IZQ.",
  RIGHT_ARM_HAND: "BRAZO DER.",
  LEFT_LEG_FOOT: "PIERNA IZQ.",
  RIGHT_LEG_FOOT: "PIERNA DER.",
};

const SAVE_LABEL: Record<SaveOutcome, string> = {
  CATCH: "BLOCAJE",
  REBOUND: "RECHACE",
  CLEARANCE: "DESPEJE",
};

function percentage(value: number | null) {
  return value === null ? "N/D" : `${value.toFixed(1).replace(".", ",")}%`;
}

export function PitchZoneGrid({ zones, selected = [], onSelect }: { zones: ZoneStats<PitchOriginZone>[]; selected?: PitchOriginZone[]; onSelect?: (zone: PitchOriginZone) => void }) {
  const total = zones.reduce((sum, zone) => sum + zone.threats, 0);
  return (
    <article className="self-start rounded-3xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">PERSPECTIVA PORTERO CDA</p>
      <h3 className="mb-3 font-black">ZONAS DE ORIGEN 1–6</h3>
      <p className="mb-1 text-center text-[9px] font-black tracking-[.3em] text-slate-500">▲ PORTERÍA CDA</p>
      <div className="relative mx-auto min-h-[25rem] max-w-xl overflow-hidden rounded-b-[1.5rem] rounded-t-[2.5rem] border-[3px] border-white/75 bg-emerald-950/55 p-3 pb-8 pt-7 shadow-inner sm:aspect-[1.2/1] sm:min-h-0" aria-label="Medio campo defensivo con portería CDA arriba: Z1 Z2 Z3 cercanas; Z4 Z5 Z6 lejanas">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-5 border-t-2 border-white/55"/><span aria-hidden="true" className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-black tracking-[.2em] text-white/55">MEDIO CAMPO</span><span aria-hidden="true" className="pointer-events-none absolute -top-14 left-1/2 h-32 w-48 -translate-x-1/2 rounded-b-full border-2 border-white/40"/><span aria-hidden="true" className="pointer-events-none absolute -top-1 left-1/2 h-4 w-20 -translate-x-1/2 border-x-2 border-b-2 border-white/80"/>
        <div className="relative z-10 grid h-full grid-cols-3 grid-rows-2 overflow-hidden rounded-[1.2rem] border border-white/20">
        {zones.map((zone, index) => (
          <button type="button" disabled={!onSelect} onClick={() => onSelect?.(zone.zone)} key={zone.zone} className={`grid min-h-40 place-content-center border border-white/15 bg-slate-950/55 p-2 text-center backdrop-blur-[1px] transition sm:min-h-0 ${selected.includes(zone.zone) ? "z-10 border-cyan-300 bg-cyan-950/60 ring-2 ring-inset ring-cyan-300/60" : "hover:bg-slate-900/75"}`}>
            <strong className="text-lg text-cyan-300">{zone.zone}</strong><span className="text-[8px] text-slate-500">{index < 3 ? "CERCANA" : "LEJANA"} · {index % 3 === 0 ? "DCHA." : index % 3 === 1 ? "CENTRO" : "IZQ."}</span>
            <strong className="mt-2 block text-2xl text-rose-100 sm:text-3xl">{percentage(zone.goalPercentage)}</strong>
            <p className="text-[9px] font-black text-rose-300">DAÑO · {zone.goals} GOLES</p>
            <p className="mt-1 text-[10px] text-slate-300">{zone.threats} amenazas · {total ? percentage(zone.threats / total * 100) : "N/D"}</p>
            <p className="text-[9px] text-slate-500">{zone.saves} paradas · {zone.outside} fuera</p>
          </button>
        ))}
        </div>
      </div>
      <p className="mt-3 text-[10px] text-slate-500">Solo medio campo defensivo. Portería arriba; derecha/izquierda son las del portero CDA mirando hacia la pista.</p>
    </article>
  );
}

const GOAL_ORDER: GoalZoneV1[] = [
  "LEFT_HIGH", "CENTER_HIGH", "RIGHT_HIGH",
  "LEFT_LOW", "CENTER_LOW", "RIGHT_LOW",
];

export function GoalZoneGrid({ zones, selected = [], onSelect }: { zones: ZoneStats<GoalZoneV1>[]; selected?: GoalZoneV1[]; onSelect?: (zone: GoalZoneV1) => void }) {
  const byZone = new Map(zones.map((zone) => [zone.zone, zone]));
  return (
    <article className="self-start rounded-3xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">TARGET EXACTO → AGREGACIÓN</p>
      <h3 className="mb-3 font-black">PORTERÍA 3×2</h3>
      <div className="relative grid grid-cols-3 overflow-hidden rounded-t-[2.5rem] border-x-[5px] border-t-[5px] border-white/90 bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,rgba(255,255,255,.04)_8px,rgba(255,255,255,.04)_10px)] pt-2 shadow-[0_-4px_20px_rgba(255,255,255,.08)]">
        {GOAL_ORDER.map((key) => {
          const zone = byZone.get(key)!;
          return <button type="button" disabled={!onSelect} onClick={() => onSelect?.(key)} key={key} className={`min-h-28 border bg-sky-950/80 p-2 text-center ${selected.includes(key) ? "border-cyan-300 ring-2 ring-inset ring-cyan-300" : "border-slate-700"}`}><strong className="block text-2xl text-rose-200">{percentage(zone.goalPercentage)}</strong><span className="block text-[9px] font-black text-rose-300">GOL · {zone.goals}</span><span className="mt-2 block text-sm font-black">{zone.threats}</span><span className="block text-[8px] text-slate-400">VOLUMEN</span></button>;
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">FUERA no entra en la matriz interior.</p>
    </article>
  );
}

export function KeeperBodySummary({ keeper, selected = [], onSelect }: { keeper: GoalkeeperAnalysis; selected?: KeeperBodyPart[]; onSelect?: (part: KeeperBodyPart) => void }) {
  const parts: Array<{ key: KeeperBodyPart; left: string; top: string }> = [
    { key: "HEAD", left: "50%", top: "10%" },
    { key: "TORSO", left: "50%", top: "39%" },
    { key: "LEFT_ARM_HAND", left: "19%", top: "40%" },
    { key: "RIGHT_ARM_HAND", left: "81%", top: "40%" },
    { key: "LEFT_LEG_FOOT", left: "36%", top: "79%" },
    { key: "RIGHT_LEG_FOOT", left: "64%", top: "79%" },
  ];
  const total = Object.values(keeper.bodyParts).reduce((sum, value) => sum + value, 0);
  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">PARADAS POR INTERVENCIÓN</p>
      <h3 className="font-black">SILUETA · {keeper.name}</h3>
      <div className="relative mx-auto mt-3 h-64 max-w-xs" aria-label={`Paradas por parte corporal de ${keeper.name}`}>
        <svg viewBox="0 0 100 160" className="absolute inset-0 h-full w-full text-slate-700" aria-hidden="true"><circle cx="50" cy="20" r="13" fill="currentColor"/><path d="M36 39Q50 30 64 39L70 91H30Z" fill="currentColor"/><path d="M31 44L4 79L14 86L39 62M69 44L96 79L86 86L61 62M40 88L23 151L38 155L51 103M60 88L77 151L62 155L49 103" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round"/></svg>
        {parts.map(({ key, left, top }) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(key)} key={key} title={BODY_LABEL[key]} aria-pressed={selected.includes(key)} className={`absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-slate-950 text-sm font-black text-white shadow ${selected.includes(key) ? "border-amber-300 ring-2 ring-amber-300/40" : "border-cyan-300"}`} style={{ left, top }}>{keeper.bodyParts[key]}</button>)}
      </div>
      <p className="text-center text-[10px] text-slate-500">{total > 0 ? `${total} paradas con parte corporal registrada` : "N/D · Sin parte corporal registrada"}</p>
    </article>
  );
}

export function SaveOutcomeSummary({ keeper, selected = [], onSelect }: { keeper: GoalkeeperAnalysis; selected?: SaveOutcome[]; onSelect?: (outcome: SaveOutcome) => void }) {
  const documented = Object.values(keeper.saveOutcomes).reduce((sum, value) => sum + value, 0);
  return <div className="grid grid-cols-3 gap-2">{(Object.keys(SAVE_LABEL) as SaveOutcome[]).map((key) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(key)} aria-pressed={selected.includes(key)} key={key} className={`rounded-xl border bg-slate-950 p-2 text-center ${selected.includes(key) ? "border-amber-300 ring-2 ring-amber-300/30" : "border-transparent"}`}><strong className="block text-xl">{keeper.saveOutcomes[key]}</strong><span className="text-[9px] font-black text-slate-500">{SAVE_LABEL[key]}</span><span className="block text-xs font-black text-cyan-300">{documented > 0 ? `${(keeper.saveOutcomes[key] / documented * 100).toFixed(1).replace(".", ",")}%` : "N/D"}</span></button>)}</div>;
}

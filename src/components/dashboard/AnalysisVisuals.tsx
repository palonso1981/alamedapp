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

export function PitchZoneGrid({ zones }: { zones: ZoneStats<PitchOriginZone>[] }) {
  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">PERSPECTIVA PORTERO CDA</p>
      <h3 className="mb-3 font-black">ZONAS DE ORIGEN 1–6</h3>
      <p className="mb-1 text-center text-[9px] font-black tracking-[.3em] text-slate-500">PORTERÍA</p>
      <div className="grid grid-cols-3 gap-2" aria-label="Z1 Z2 Z3 cercanas; Z4 Z5 Z6 lejanas">
        {zones.map((zone, index) => (
          <div key={zone.zone} className="rounded-xl border border-slate-700 bg-slate-950 p-3">
            <div className="flex items-center justify-between"><strong className="text-cyan-300">{zone.zone}</strong><span className="text-[8px] text-slate-500">{index % 3 === 0 ? "DCHA." : index % 3 === 1 ? "CENTRO" : "IZQ."}</span></div>
            <strong className="mt-1 block text-2xl">{zone.threats}</strong>
            <p className="text-[10px] text-slate-400">{zone.goals} G · {zone.saves} P · {zone.outside} F</p>
            <p className="text-[10px] font-bold text-slate-500">GOL {percentage(zone.goalPercentage)}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-slate-500">Derecha/izquierda son las del portero CDA mirando hacia la pista.</p>
    </article>
  );
}

const GOAL_ORDER: GoalZoneV1[] = [
  "LEFT_HIGH", "CENTER_HIGH", "RIGHT_HIGH",
  "LEFT_LOW", "CENTER_LOW", "RIGHT_LOW",
];

export function GoalZoneGrid({ zones }: { zones: ZoneStats<GoalZoneV1>[] }) {
  const byZone = new Map(zones.map((zone) => [zone.zone, zone]));
  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900 p-4">
      <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">TARGET EXACTO → AGREGACIÓN</p>
      <h3 className="mb-3 font-black">PORTERÍA 3×2</h3>
      <div className="grid grid-cols-3 overflow-hidden rounded-2xl border-2 border-white/80">
        {GOAL_ORDER.map((key) => {
          const zone = byZone.get(key)!;
          return <div key={key} className="min-h-24 border border-slate-700 bg-sky-950/80 p-2 text-center"><strong className="block text-xl">{zone.threats}</strong><span className="block text-[9px] text-emerald-300">{zone.saves} P</span><span className="block text-[9px] text-rose-300">{zone.goals} G</span><span className="block text-[9px] text-slate-500">%P {percentage(zone.savePercentage)}</span></div>;
        })}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">FUERA no entra en la matriz interior.</p>
    </article>
  );
}

export function KeeperBodySummary({ keeper }: { keeper: GoalkeeperAnalysis }) {
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
        {parts.map(({ key, left, top }) => <span key={key} title={BODY_LABEL[key]} className="absolute grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-cyan-300 bg-slate-950 text-sm font-black text-white shadow" style={{ left, top }}>{keeper.bodyParts[key]}</span>)}
      </div>
      <p className="text-center text-[10px] text-slate-500">{total > 0 ? `${total} paradas con parte corporal registrada` : "N/D · Sin parte corporal registrada"}</p>
    </article>
  );
}

export function SaveOutcomeSummary({ keeper }: { keeper: GoalkeeperAnalysis }) {
  return <div className="grid grid-cols-3 gap-2">{(Object.keys(SAVE_LABEL) as SaveOutcome[]).map((key) => <div key={key} className="rounded-xl bg-slate-950 p-2 text-center"><strong className="block text-xl">{keeper.saveOutcomes[key]}</strong><span className="text-[9px] font-black text-slate-500">{SAVE_LABEL[key]}</span></div>)}</div>;
}

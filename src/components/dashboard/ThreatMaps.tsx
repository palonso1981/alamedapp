import { FutsalCourtMarkings } from "../court/FutsalCourtMarkings";
import {
  DashboardGoalPoint,
  DashboardThreatPoint,
} from "../../lib/dashboardAnalytics";

const OUTCOME_COLOR = {
  GOL: "bg-rose-500",
  PARADA: "bg-emerald-400",
  FUERA: "bg-amber-300",
  BLOQUEADO: "bg-slate-400",
} as const;

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[10px] font-black text-slate-400">
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />GOL</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />PARADA</span>
      <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-300" />FUERA</span>
    </div>
  );
}

export function PitchThreatMap({
  points,
  side,
  onSelect,
  pointTitle,
}: {
  points: DashboardThreatPoint[];
  side: "FOR" | "AGAINST";
  onSelect?: (point: DashboardThreatPoint) => void;
  pointTitle?: (point: DashboardThreatPoint) => string;
}) {
  const visible = points.filter((point) => point.side === side);
  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">ORIGEN</p>
          <h3 className="font-black">{side === "FOR" ? "MAPA DE REMATES" : "MAPA DE AMENAZAS"}</h3>
        </div>
        <span className="text-2xl font-black text-slate-500">{visible.length}</span>
      </div>
      <div className="relative aspect-[2/1] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-sky-800 to-blue-950" aria-label={side === "FOR" ? "Mapa de remates CDA" : "Mapa de amenazas recibidas"}>
        <FutsalCourtMarkings />
        {visible.map((point) => (
          <button type="button"
            key={`${point.matchId}:${point.eventId}`}
            onClick={() => onSelect?.(point)}
            aria-label={`${point.outcome} · abrir evento ${point.eventId}`}
            title={pointTitle?.(point) ?? `${point.outcome} · X ${Math.round(point.x * 100)} · Y ${Math.round(point.y * 100)}`}
            className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow focus:ring-4 focus:ring-white/50 ${OUTCOME_COLOR[point.outcome]}`}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          />
        ))}
      </div>
    </article>
  );
}

export function GoalThreatMap({ points, onSelect, pointTitle }: { points: DashboardGoalPoint[]; onSelect?: (point: DashboardGoalPoint) => void; pointTitle?: (point: DashboardGoalPoint) => string }) {
  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.16em] text-cyan-300">DESTINO RIV</p>
          <h3 className="font-black">PORTERÍA CDA</h3>
        </div>
        <Legend />
      </div>
      <div className="relative aspect-[25/16] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-slate-950 to-sky-950" aria-label="Mapa de destinos de amenazas rivales">
        <svg viewBox="0 0 100 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d="M22 50V15H78V50" fill="none" stroke="#f8fafc" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
          <path d="M22 15L27 19H73L78 15M27 19V55M73 19V55M27 55H73" fill="none" stroke="#64748b" strokeWidth="0.7" />
          <g stroke="#475569" strokeWidth="0.4" opacity="0.65">
            {[27, 34.7, 42.3, 50, 57.7, 65.3, 73].map((x) => <line key={`v-${x}`} x1={x} y1="19" x2={x} y2="55" />)}
            {[25, 31, 37, 43, 49].map((y) => <line key={`h-${y}`} x1="27" y1={y} x2="73" y2={y} />)}
          </g>
        </svg>
        {points.map((point) => (
          <button type="button"
            key={`${point.matchId}:${point.eventId}`}
            onClick={() => onSelect?.(point)}
            aria-label={`${point.outcome} · abrir evento ${point.eventId}`}
            title={pointTitle?.(point) ?? `${point.outcome} · geometría V${point.target.geometryVersion}`}
            className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow focus:ring-4 focus:ring-white/50 ${OUTCOME_COLOR[point.outcome]}`}
            style={{ left: `${point.target.x * 100}%`, top: `${point.target.y * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">Coordenada normalizada original · geometría versionada conservada</p>
    </article>
  );
}

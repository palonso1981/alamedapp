"use client";

import { MouseEvent, useEffect, useMemo, useState } from "react";
import { FutsalCourtMarkings } from "../court/FutsalCourtMarkings";
import { normalizeCourtPoint } from "../../lib/courtGeometry";
import { AttackDirection, visualToCanonicalPoint } from "../../lib/captureOrientation";
import { replayVideoReviewAt, shiftPreciseVideoSecond, formatPreciseVideoTime, VideoReviewCreation, VideoReviewEventInput, createVideoReviewEvent } from "../../lib/videoReviewWorkspace";
import { MatchSession, MatchVideoSegment, NormalizedCoordinates } from "../../types";

const KINDS: Array<[VideoReviewEventInput["kind"], string]> = [
  ["THREAT", "REMATE / AMENAZA"], ["LOSS", "PÉRDIDA"], ["SUBSTITUTION", "CAMBIO"], ["FOUL", "FALTA"],
  ["CARD", "TARJETA"], ["RESTART", "ABP"], ["GAME_STATE", "ESTADO"], ["FOUL_ADJUSTMENT", "AJUSTAR FALTAS"],
];

interface Props {
  session: MatchSession;
  segment: MatchVideoSegment;
  initialPeriod: number;
  initialMinute: number;
  initialVideoSecond: number;
  referenceEventId?: string;
  onSeek: (second: number) => void;
  readCurrentTime: () => number;
  onSave: (creation: VideoReviewCreation) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function VideoReviewEventComposer({ session, segment, initialPeriod, initialMinute, initialVideoSecond, referenceEventId, onSeek, readCurrentTime, onSave, onCancel, onDirtyChange }: Props) {
  const [kind, setKind] = useState<VideoReviewEventInput["kind"]>("THREAT");
  const [period, setPeriod] = useState(initialPeriod);
  const [minute, setMinute] = useState(initialMinute);
  const [videoSecond, setVideoSecond] = useState(initialVideoSecond);
  const [side, setSide] = useState<"FOR" | "AGAINST">("FOR");
  const [playerId, setPlayerId] = useState("");
  const [secondPlayerId, setSecondPlayerId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [outcome, setOutcome] = useState<"GOL" | "PARADA" | "FUERA">("PARADA");
  const [phase, setPhase] = useState<"POSITIONAL" | "TRANSITION" | "SET_PIECE_CORNER" | "SET_PIECE_FREE_KICK" | "SET_PIECE_KICK_IN" | "FLYING_GOALKEEPER" | "PENALTY" | "DOUBLE_PENALTY">("POSITIONAL");
  const [color, setColor] = useState<"YELLOW" | "RED">("YELLOW");
  const [restart, setRestart] = useState<"CORNER" | "DANGEROUS_KICK_IN">("CORNER");
  const [spatialSide, setSpatialSide] = useState<"TOP" | "BOTTOM">("TOP");
  const [gameState, setGameState] = useState<"SUPERIORITY" | "FLYING_GOALKEEPER">("FLYING_GOALKEEPER");
  const [gameStateActive, setGameStateActive] = useState(true);
  const [origin, setOrigin] = useState<NormalizedCoordinates>({ x: 0.5, y: 0.5 });
  const [attackDirection, setAttackDirection] = useState<AttackDirection>("RIGHT");
  useEffect(() => { onDirtyChange?.(true); return () => onDirtyChange?.(false); }, [onDirtyChange]);

  const replay = useMemo(() => replayVideoReviewAt(session, period, minute), [minute, period, session]);
  const onCourt = new Set(replay.onCourtPlayerIds);
  const players = [...session.players].sort((a, b) => Number(onCourt.has(b.id)) - Number(onCourt.has(a.id)) || a.number - b.number);
  const chooseOrigin = (event: MouseEvent<HTMLButtonElement>) => {
    const point = normalizeCourtPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    setOrigin(visualToCanonicalPoint(point, attackDirection));
  };
  const shiftAnchor = (delta: -5 | -1 | 1 | 5) => {
    const next = shiftPreciseVideoSecond(videoSecond, delta);
    setVideoSecond(next);
    onSeek(next);
  };
  const currentAnchor = () => {
    const next = Math.max(0, Math.round(readCurrentTime() * 10) / 10);
    setVideoSecond(next);
    onSeek(next);
  };

  function save() {
    let input: VideoReviewEventInput;
    if (kind === "THREAT") input = { kind, side, playerId: side === "FOR" ? playerId || undefined : undefined, origin, outcome, phase };
    else if (kind === "LOSS") { if (!playerId) return; input = { kind, playerId }; }
    else if (kind === "FOUL") input = { kind, side, playerId: playerId || null, origin };
    else if (kind === "CARD") input = { kind, side, color, playerId: staffId ? undefined : playerId || undefined, staffId: staffId || undefined };
    else if (kind === "RESTART") input = { kind, side, restart, spatialSide };
    else if (kind === "SUBSTITUTION") { if (!playerId || !secondPlayerId) return; input = { kind, playerOutId: playerId, playerInId: secondPlayerId }; }
    else if (kind === "GAME_STATE") input = { kind, state: gameState, active: gameStateActive, playerId: gameState === "FLYING_GOALKEEPER" && side === "FOR" && gameStateActive ? playerId || undefined : undefined, side };
    else input = { kind, side, delta: 1 };
    onSave(createVideoReviewEvent(session, segment, { period, minute }, videoSecond, input, { referenceEventId }));
  }

  const playerOptions = players.map((player) => <option key={player.id} value={player.id}>{onCourt.has(player.id) ? "●" : "○"} #{player.number} · {player.name}</option>);
  const requiresPlayer = kind === "LOSS" || kind === "SUBSTITUTION";
  const valid = segment.periods.includes(period as 1 | 2) && (!requiresPlayer || Boolean(playerId)) && (kind !== "SUBSTITUTION" || Boolean(secondPlayerId) && playerId !== secondPlayerId);

  return <section role="dialog" aria-label="Registrar evento canónico desde vídeo" className="rounded-3xl border border-cyan-700 bg-slate-900 p-3 sm:p-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.18em] text-cyan-300">NUEVO EVENTO CANÓNICO · ORIGEN VÍDEO</p><h2 className="text-lg font-black">Partido P{period} · min {minute} <span className="text-slate-500">/</span> Vídeo {segment.label} · {formatPreciseVideoTime(videoSecond)}</h2></div><button type="button" onClick={onCancel} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-xl">×</button></header>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{KINDS.map(([value, label]) => <button key={value} type="button" onClick={() => setKind(value)} className={`min-h-12 rounded-xl px-2 text-xs font-black ${kind === value ? "bg-cyan-400 text-slate-950" : "bg-slate-800"}`}>{label}</button>)}</div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[110px_130px_1fr]">
      <label className="text-[10px] font-black text-slate-400">PERIODO<select value={period} onChange={(event) => setPeriod(Number(event.target.value))} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value={1}>P1</option><option value={2}>P2</option></select></label>
      <label className="text-[10px] font-black text-slate-400">MINUTO DE PARTIDO<input type="number" min={0} max={20} value={minute} onChange={(event) => setMinute(Math.max(0, Math.min(20, Number(event.target.value))))} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm" /></label>
      <div><p className="text-[10px] font-black text-slate-400">ANCHOR DE VÍDEO · VERIFIED</p><div className="mt-1 flex flex-wrap gap-1">{([-5, -1, 1, 5] as const).map((delta) => <button key={delta} type="button" onClick={() => shiftAnchor(delta)} className="min-h-12 rounded-xl bg-slate-800 px-3 font-black">{delta > 0 ? `+${delta}` : delta}</button>)}<span className="grid min-h-12 place-items-center rounded-xl bg-slate-950 px-3 font-mono font-black text-cyan-200">{formatPreciseVideoTime(videoSecond)}</span><button type="button" onClick={currentAnchor} className="min-h-12 flex-1 rounded-xl bg-violet-500 px-3 text-xs font-black text-slate-950">USAR POSICIÓN ACTUAL</button></div></div>
    </div>
    {!segment.periods.includes(period as 1 | 2) && <p role="alert" className="mt-2 rounded-xl bg-rose-950 p-2 text-xs font-bold text-rose-200">Esta parte no cubre P{period}. Cambia de parte o de periodo.</p>}
    {kind !== "LOSS" && kind !== "SUBSTITUTION" && kind !== "FOUL_ADJUSTMENT" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSide("FOR")} className={`min-h-11 rounded-xl font-black ${side === "FOR" ? "bg-cyan-500 text-slate-950" : "bg-slate-800"}`}>CDA</button><button type="button" onClick={() => setSide("AGAINST")} className={`min-h-11 rounded-xl font-black ${side === "AGAINST" ? "bg-rose-500" : "bg-slate-800"}`}>RIVAL</button></div>}
    {(kind === "THREAT" || kind === "LOSS" || kind === "FOUL" || kind === "CARD" || kind === "SUBSTITUTION" || kind === "GAME_STATE") && <label className="mt-3 block text-[10px] font-black text-slate-400">{kind === "SUBSTITUTION" ? "SALE" : "JUGADOR · EN PISTA PRIMERO"}<select value={playerId} onChange={(event) => { setPlayerId(event.target.value); if (kind === "CARD") setStaffId(""); }} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="">SIN ASIGNAR</option>{playerOptions}</select></label>}
    {kind === "SUBSTITUTION" && <label className="mt-3 block text-[10px] font-black text-slate-400">ENTRA<select value={secondPlayerId} onChange={(event) => setSecondPlayerId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="">ELIGE JUGADOR</option>{playerOptions}</select></label>}
    {kind === "THREAT" && <><div className="mt-3 grid grid-cols-3 gap-2">{(["GOL", "PARADA", "FUERA"] as const).map((value) => <button key={value} type="button" onClick={() => setOutcome(value)} className={`min-h-11 rounded-xl text-xs font-black ${outcome === value ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>{value}</button>)}</div><label className="mt-3 block text-[10px] font-black text-slate-400">FASE<select value={phase} onChange={(event) => setPhase(event.target.value as typeof phase)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="POSITIONAL">POSICIONAL</option><option value="TRANSITION">TRANSICIÓN</option><option value="SET_PIECE_CORNER">CÓRNER</option><option value="SET_PIECE_FREE_KICK">FALTA / LIBRE</option><option value="SET_PIECE_KICK_IN">BANDA CERCANA</option><option value="FLYING_GOALKEEPER">PORTERO-JUGADOR</option><option value="PENALTY">PENALTI</option><option value="DOUBLE_PENALTY">DOBLE PENALTI</option></select></label></>}
    {(kind === "THREAT" || kind === "FOUL") && <div className="mt-3"><div className="mb-1 flex items-center justify-between gap-2"><p className="text-[10px] font-black text-slate-400">MAPA CANÓNICO COMPLETO · ORIGEN</p><button type="button" onClick={() => setAttackDirection((value) => value === "RIGHT" ? "LEFT" : "RIGHT")} className="min-h-10 rounded-lg bg-slate-800 px-3 text-[10px] font-black">ATAQUE {attackDirection === "RIGHT" ? "→" : "←"}</button></div><button type="button" onClick={chooseOrigin} className="relative aspect-[2/1] w-full overflow-hidden rounded-2xl border-4 border-white/80 bg-[#075a9c]" aria-label="Seleccionar origen en la pista completa"><FutsalCourtMarkings /><span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500" style={{ left: `${(attackDirection === "RIGHT" ? origin.x : 1 - origin.x) * 100}%`, top: `${origin.y * 100}%` }} /></button></div>}
    {kind === "CARD" && <><div className="mt-3 grid grid-cols-2 gap-2">{(["YELLOW", "RED"] as const).map((value) => <button key={value} type="button" onClick={() => setColor(value)} className={`min-h-11 rounded-xl font-black ${color === value ? value === "RED" ? "bg-red-500" : "bg-yellow-400 text-slate-950" : "bg-slate-800"}`}>{value === "RED" ? "ROJA" : "AMARILLA"}</button>)}</div>{session.staff.length > 0 && <label className="mt-3 block text-[10px] font-black text-slate-400">O STAFF<select value={staffId} onChange={(event) => { setStaffId(event.target.value); if (event.target.value) setPlayerId(""); }} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="">NINGUNO</option>{session.staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}</>}
    {kind === "RESTART" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setRestart("CORNER")} className={`min-h-11 rounded-xl font-black ${restart === "CORNER" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>CÓRNER</button><button type="button" onClick={() => setRestart("DANGEROUS_KICK_IN")} className={`min-h-11 rounded-xl font-black ${restart === "DANGEROUS_KICK_IN" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>BANDA CERCANA</button>{(["TOP", "BOTTOM"] as const).map((value) => <button key={value} type="button" onClick={() => setSpatialSide(value)} className={`min-h-11 rounded-xl font-black ${spatialSide === value ? "bg-violet-500" : "bg-slate-800"}`}>{value === "TOP" ? "LADO SUPERIOR" : "LADO INFERIOR"}</button>)}</div>}
    {kind === "GAME_STATE" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setGameState("FLYING_GOALKEEPER")} className={`min-h-11 rounded-xl font-black ${gameState === "FLYING_GOALKEEPER" ? "bg-violet-500" : "bg-slate-800"}`}>PORTERO-JUGADOR</button><button type="button" onClick={() => setGameState("SUPERIORITY")} className={`min-h-11 rounded-xl font-black ${gameState === "SUPERIORITY" ? "bg-violet-500" : "bg-slate-800"}`}>SUPERIORIDAD</button><button type="button" onClick={() => setGameStateActive(true)} className={`min-h-11 rounded-xl font-black ${gameStateActive ? "bg-emerald-500 text-slate-950" : "bg-slate-800"}`}>ACTIVAR</button><button type="button" onClick={() => setGameStateActive(false)} className={`min-h-11 rounded-xl font-black ${!gameStateActive ? "bg-rose-500" : "bg-slate-800"}`}>DESACTIVAR</button></div>}
    {referenceEventId && <p className="mt-3 text-[10px] font-bold text-slate-500">Se insertará después del hito seleccionado si comparte P{period} · min {minute}; en otro caso se usará el orden canónico del minuto.</p>}
    <button type="button" disabled={!valid} onClick={save} className="mt-4 min-h-14 w-full rounded-xl bg-emerald-400 text-base font-black text-slate-950 disabled:opacity-40">GUARDAR EVENTO + ANCLA VERIFIED</button>
  </section>;
}

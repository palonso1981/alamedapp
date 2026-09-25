"use client";

import { useMemo, useState } from "react";
import { createVideoSportsInsertion, VideoLabSyncSegment, VideoSportsEventInput, proposeVideoSportsInsertion } from "../../lib/videoLab";
import { MatchEvent, MatchSession, MatchVideoEventOverride } from "../../types";

interface Props {
  session: MatchSession;
  referenceEventId: string;
  segment: VideoLabSyncSegment;
  videoSecond: number;
  onSave: (event: MatchEvent, override: MatchVideoEventOverride) => void;
  onCancel: () => void;
}

const KINDS = [
  ["THREAT", "REMATE"], ["LOSS", "PÉRDIDA"], ["FOUL", "FALTA"], ["CARD", "TARJETA"], ["RESTART", "REINICIO"],
] as const;

export function VideoSportsEventComposer({ session, referenceEventId, segment, videoSecond, onSave, onCancel }: Props) {
  const proposal = useMemo(() => proposeVideoSportsInsertion(session, referenceEventId, "AFTER"), [referenceEventId, session]);
  const [kind, setKind] = useState<VideoSportsEventInput["kind"]>("THREAT");
  const [side, setSide] = useState<"FOR" | "AGAINST">("FOR");
  const [playerId, setPlayerId] = useState("");
  const [outcome, setOutcome] = useState<"GOL" | "PARADA" | "FUERA">("PARADA");
  const [phase, setPhase] = useState<Extract<VideoSportsEventInput, { kind: "THREAT" }>["phase"]>("POSITIONAL");
  const [color, setColor] = useState<"YELLOW" | "RED">("YELLOW");
  const [restart, setRestart] = useState<"CORNER" | "DANGEROUS_KICK_IN">("CORNER");
  const [origin, setOrigin] = useState({ x: 0.5, y: 0.5 });
  const onCourt = new Set(proposal?.onCourtPlayerIds ?? []);
  const orderedPlayers = [...session.players].sort((a, b) => Number(onCourt.has(b.id)) - Number(onCourt.has(a.id)) || a.number - b.number);

  function save() {
    let input: VideoSportsEventInput;
    if (kind === "THREAT") input = { kind, side, playerId: playerId || undefined, outcome, phase, origin };
    else if (kind === "LOSS") {
      if (!playerId) return;
      input = { kind, playerId };
    } else if (kind === "FOUL") input = { kind, side, playerId: playerId || null };
    else if (kind === "CARD") input = { kind, side, color, playerId: playerId || undefined };
    else input = { kind, side, restart, spatialSide: "TOP" };
    const result = createVideoSportsInsertion(session, referenceEventId, segment, videoSecond, input);
    if (result) onSave(result.event, result.override);
  }

  return <div className="rounded-2xl border border-cyan-700 bg-slate-950 p-3" role="dialog" aria-label="Añadir evento desde vídeo">
    <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-black text-cyan-300">+ EVENTO · P{proposal?.period} {proposal?.minute}&apos;</p><p className="text-xs text-slate-400">Se insertará tras el hito seleccionado · vídeo {Math.round(videoSecond)}s</p></div><button type="button" onClick={onCancel} className="min-h-10 rounded-lg bg-slate-800 px-3 font-black">×</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{KINDS.map(([value, label]) => <button key={value} type="button" onClick={() => setKind(value)} className={`min-h-11 rounded-xl px-2 text-xs font-black ${kind === value ? "bg-cyan-400 text-slate-950" : "bg-slate-800"}`}>{label}</button>)}</div>
    {kind !== "LOSS" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSide("FOR")} className={`min-h-11 rounded-xl font-black ${side === "FOR" ? "bg-cyan-500 text-slate-950" : "bg-slate-800"}`}>CDA</button><button type="button" onClick={() => setSide("AGAINST")} className={`min-h-11 rounded-xl font-black ${side === "AGAINST" ? "bg-rose-500 text-white" : "bg-slate-800"}`}>RIV</button></div>}
    {(kind === "THREAT" || kind === "LOSS" || kind === "FOUL" || kind === "CARD") && <label className="mt-3 block text-[10px] font-black text-slate-400">JUGADOR {proposal ? "· EN PISTA PRIMERO" : ""}<select value={playerId} onChange={(event) => setPlayerId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="">SIN ASIGNAR</option>{orderedPlayers.map((player) => <option key={player.id} value={player.id}>{onCourt.has(player.id) ? "● " : "○ "}#{player.number} · {player.name}</option>)}</select></label>}
    {kind === "THREAT" && <><div className="mt-3 grid grid-cols-3 gap-2">{(["GOL", "PARADA", "FUERA"] as const).map((value) => <button key={value} type="button" onClick={() => setOutcome(value)} className={`min-h-11 rounded-xl text-xs font-black ${outcome === value ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>{value}</button>)}</div><select aria-label="Fase" value={phase} onChange={(event) => setPhase(event.target.value as typeof phase)} className="mt-2 min-h-12 w-full rounded-xl bg-slate-800 px-3 text-sm"><option value="POSITIONAL">POSICIONAL</option><option value="TRANSITION">TRANSICIÓN</option><option value="SET_PIECE_CORNER">CÓRNER</option><option value="SET_PIECE_FREE_KICK">FALTA</option><option value="SET_PIECE_KICK_IN">BANDA</option><option value="FLYING_GOALKEEPER">PORTERO-JUGADOR</option><option value="PENALTY">PENALTI</option><option value="DOUBLE_PENALTY">DOBLE PENALTI</option></select><div className="mt-2"><p className="text-[10px] font-black text-slate-400">ORIGEN APROXIMADO</p><div className="mt-1 grid grid-cols-3 gap-1">{[0.2, 0.5, 0.8].flatMap((y) => [0.2, 0.5, 0.8].map((x) => <button key={`${x}-${y}`} type="button" aria-label={`Origen ${x}, ${y}`} onClick={() => setOrigin({ x, y })} className={`min-h-9 rounded-lg border ${origin.x === x && origin.y === y ? "border-amber-300 bg-amber-300/20" : "border-slate-700 bg-blue-950"}`}>·</button>))}</div></div></>}
    {kind === "CARD" && <div className="mt-3 grid grid-cols-2 gap-2">{(["YELLOW", "RED"] as const).map((value) => <button key={value} type="button" onClick={() => setColor(value)} className={`min-h-11 rounded-xl font-black ${color === value ? (value === "RED" ? "bg-red-500" : "bg-yellow-400 text-slate-950") : "bg-slate-800"}`}>{value === "RED" ? "ROJA" : "AMARILLA"}</button>)}</div>}
    {kind === "RESTART" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setRestart("CORNER")} className={`min-h-11 rounded-xl font-black ${restart === "CORNER" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>CÓRNER</button><button type="button" onClick={() => setRestart("DANGEROUS_KICK_IN")} className={`min-h-11 rounded-xl font-black ${restart === "DANGEROUS_KICK_IN" ? "bg-amber-400 text-slate-950" : "bg-slate-800"}`}>BANDA</button></div>}
    <button type="button" disabled={!proposal || (kind === "LOSS" && !playerId)} onClick={save} className="mt-3 min-h-12 w-full rounded-xl bg-emerald-400 font-black text-slate-950 disabled:opacity-40">GUARDAR EVENTO VIDEO</button>
  </div>;
}

"use client";

import { useMemo, useState } from "react";
import { createVideoAnalysisClip, defaultVideoClipWindow, VIDEO_CLIP_SUGGESTED_CATEGORIES, videoClipTagSuggestions, VideoLabSyncSegment } from "../../lib/videoLab";
import { MatchSession, MatchVideoAnalysisClip } from "../../types";
import { formatVideoTimestamp } from "../../lib/videoIndex";

interface Props { session: MatchSession; segment: VideoLabSyncSegment; currentSecond: () => number; onSave: (clip: MatchVideoAnalysisClip) => void; onCancel: () => void; }

export function VideoClipComposer({ session, segment, currentSecond, onSave, onCancel }: Props) {
  const initial = useMemo(() => defaultVideoClipWindow(currentSecond()), [currentSecond]);
  const [startSecond, setStart] = useState(initial.startSecond);
  const [endSecond, setEnd] = useState(initial.endSecond);
  const [category, setCategory] = useState("");
  const [tagText, setTagText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [playerIds, setPlayerIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const suggestions = videoClipTagSuggestions(session.videoAnalysisClips ?? []).filter((tag) => !tags.includes(tag));
  const addTag = (value: string) => { const tag = value.trim(); if (tag && !tags.includes(tag)) setTags([...tags, tag]); setTagText(""); };
  const shift = (edge: "start" | "end", delta: number) => edge === "start" ? setStart((value) => Math.max(0, Math.min(endSecond, value + delta))) : setEnd((value) => Math.max(startSecond, value + delta));
  const save = () => onSave(createVideoAnalysisClip({ clubId: session.preparation?.clubId ?? "", matchId: session.matchId, segmentId: segment.id, videoId: segment.videoId, referenceSecond: initial.referenceSecond, startSecond, endSecond, category, tags, playerIds, comment }));

  return <div className="rounded-2xl border border-violet-700 bg-slate-950 p-3" role="dialog" aria-label="Crear clip de análisis">
    <div className="flex items-center justify-between"><div><p className="text-[10px] font-black text-violet-300">+ CLIP · REFERENCIA {formatVideoTimestamp(initial.referenceSecond)}</p><p className="text-xs text-slate-400">No modifica eventos ni estadísticas.</p></div><button type="button" onClick={onCancel} className="min-h-10 rounded-lg bg-slate-800 px-3 font-black">×</button></div>
    <div className="mt-3 grid grid-cols-2 gap-2">{(["start", "end"] as const).map((edge) => { const value = edge === "start" ? startSecond : endSecond; return <div key={edge} className="rounded-xl bg-slate-900 p-2"><p className="text-[9px] font-black text-slate-500">{edge === "start" ? "INICIO" : "FIN"}</p><p className="font-mono text-lg font-black text-cyan-300">{formatVideoTimestamp(value)}</p><div className="mt-2 grid grid-cols-3 gap-1"><button type="button" onClick={() => shift(edge, -1)} className="min-h-10 rounded-lg bg-slate-800 font-black">−1</button><button type="button" onClick={() => edge === "start" ? setStart(Math.min(currentSecond(), endSecond)) : setEnd(Math.max(currentSecond(), startSecond))} className="min-h-10 rounded-lg bg-cyan-950 text-[9px] font-black text-cyan-200">{edge === "start" ? "INICIO AQUÍ" : "FIN AQUÍ"}</button><button type="button" onClick={() => shift(edge, 1)} className="min-h-10 rounded-lg bg-slate-800 font-black">+1</button></div></div>; })}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setCategory("")} className={`min-h-10 rounded-full px-3 text-xs font-black ${!category ? "bg-violet-400 text-slate-950" : "bg-slate-800"}`}>SIN CATEGORÍA</button>{VIDEO_CLIP_SUGGESTED_CATEGORIES.map((value) => <button key={value} type="button" onClick={() => setCategory(value)} className={`min-h-10 rounded-full px-3 text-xs font-black ${category === value ? "bg-violet-400 text-slate-950" : "bg-slate-800"}`}>{value}</button>)}</div>
    <div className="mt-3"><label className="text-[10px] font-black text-slate-400">ETIQUETAS LIBRES<div className="mt-1 flex gap-2"><input list="video-lab-tags" value={tagText} onChange={(event) => setTagText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(tagText); } }} placeholder="presión alta…" className="min-h-11 min-w-0 flex-1 rounded-xl bg-slate-800 px-3 text-sm"/><button type="button" onClick={() => addTag(tagText)} className="min-h-11 rounded-xl bg-slate-700 px-3 font-black">+</button></div></label><datalist id="video-lab-tags">{suggestions.map((tag) => <option key={tag} value={tag}/>)}</datalist><div className="mt-2 flex flex-wrap gap-1">{[...tags, ...suggestions.slice(0, 5)].map((tag, index) => <button key={`${tag}-${index}`} type="button" onClick={() => tags.includes(tag) ? setTags(tags.filter((item) => item !== tag)) : addTag(tag)} className={`rounded-full px-3 py-2 text-[10px] font-black ${tags.includes(tag) ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{tag}</button>)}</div></div>
    <div className="mt-3"><p className="text-[10px] font-black text-slate-400">JUGADORES CDA · OPCIONAL</p><div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-5">{session.players.map((player) => <button key={player.id} type="button" onClick={() => setPlayerIds(playerIds.includes(player.id) ? playerIds.filter((id) => id !== player.id) : [...playerIds, player.id])} className={`min-h-11 rounded-xl text-xs font-black ${playerIds.includes(player.id) ? "bg-cyan-400 text-slate-950" : "bg-slate-800"}`}>#{player.number} {player.name}</button>)}</div></div>
    <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Comentario opcional" className="mt-3 min-h-20 w-full rounded-xl bg-slate-800 p-3 text-sm"/>
    <button type="button" onClick={save} className="mt-3 min-h-12 w-full rounded-xl bg-violet-400 font-black text-slate-950">GUARDAR CLIP</button>
  </div>;
}

"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatPreciseVideoTime, preciseVideoSecond } from "../../lib/videoReviewWorkspace";
import { isVideoReviewPopoutEvent, videoReviewChannelName, VideoReviewPopoutCommand } from "../../lib/videoReviewPopout";
import { YouTubeLabPlayer, YouTubeLabPlayerHandle } from "./YouTubeLabPlayer";

export interface VideoReviewPlayerHandle {
  currentTime: () => number;
  seekTo: (second: number) => void;
  play: () => void;
  pause: () => void;
  setPlaybackRate: (rate: number) => void;
  openPopout: () => boolean;
}

interface Props {
  matchId: string;
  videoId: string;
  label: string;
  initialSecond?: number;
  onVisualTimeChange?: (second: number) => void;
  onPopoutChange?: (external: boolean) => void;
}

export const VideoReviewPlayer = forwardRef<VideoReviewPlayerHandle, Props>(function VideoReviewPlayer(
  { matchId, videoId, label, initialSecond = 0, onVisualTimeChange, onPopoutChange },
  ref,
) {
  const playerRef = useRef<YouTubeLabPlayerHandle>(null);
  const popupRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const exactSecondRef = useRef(preciseVideoSecond(initialSecond));
  const playingRef = useRef(false);
  const rateRef = useRef(1);
  const [external, setExternal] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [visualSecond, setVisualSecond] = useState(preciseVideoSecond(initialSecond));
  const [inlineStartSecond, setInlineStartSecond] = useState(preciseVideoSecond(initialSecond));

  const post = useCallback((message: VideoReviewPopoutCommand) => {
    channelRef.current?.postMessage(message);
    popupRef.current?.postMessage({ channel: videoReviewChannelName(matchId), payload: message }, window.location.origin);
  }, [matchId]);

  const stateMessage = useCallback((): VideoReviewPopoutCommand => ({
    type: "STATE",
    videoId,
    label,
    second: exactSecondRef.current,
    playing: playingRef.current,
    playbackRate: rateRef.current,
  }), [label, videoId]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(videoReviewChannelName(matchId));
    channelRef.current = channel;
    const receive = (value: unknown) => {
      if (!isVideoReviewPopoutEvent(value)) return;
      if (value.type === "READY") post(stateMessage());
      if (value.type === "TIME" || value.type === "CAPTURED_TIME") {
        exactSecondRef.current = preciseVideoSecond(value.second);
        setVisualSecond(exactSecondRef.current);
        onVisualTimeChange?.(exactSecondRef.current);
      }
      if (value.type === "TIME") {
        playingRef.current = value.playing;
        rateRef.current = value.playbackRate;
      }
      if (value.type === "CLOSED") {
        popupRef.current = null;
        setInlineStartSecond(exactSecondRef.current);
        setExternal(false);
        onPopoutChange?.(false);
      }
    };
    if (channel) channel.onmessage = (message: MessageEvent<unknown>) => receive(message.data);
    const onMessage = (message: MessageEvent<unknown>) => {
      if (message.origin !== window.location.origin || !message.data || typeof message.data !== "object") return;
      const envelope = message.data as { channel?: string; payload?: unknown };
      if (envelope.channel === videoReviewChannelName(matchId)) receive(envelope.payload);
    };
    window.addEventListener("message", onMessage);
    return () => { channel?.close(); channelRef.current = null; window.removeEventListener("message", onMessage); };
  }, [matchId, onPopoutChange, onVisualTimeChange, post, stateMessage]);

  useEffect(() => {
    const next = preciseVideoSecond(initialSecond);
    exactSecondRef.current = next;
    setVisualSecond(next);
    setInlineStartSecond(next);
  }, [initialSecond, videoId]);

  useEffect(() => {
    if (!external) return;
    post(stateMessage());
  }, [external, post, stateMessage]);

  useEffect(() => {
    if (!external) return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setInlineStartSecond(exactSecondRef.current);
        setExternal(false);
        onPopoutChange?.(false);
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [external, onPopoutChange]);

  const seekTo = (second: number) => {
    const next = preciseVideoSecond(second);
    exactSecondRef.current = next;
    setVisualSecond(next);
    onVisualTimeChange?.(next);
    if (external) post({ type: "SEEK", second: next });
    else playerRef.current?.seekTo(next);
  };
  const play = () => { playingRef.current = true; if (external) post({ type: "PLAY" }); else playerRef.current?.play(); };
  const pause = () => { playingRef.current = false; if (external) post({ type: "PAUSE" }); else playerRef.current?.pause(); };
  const setPlaybackRate = (playbackRate: number) => {
    rateRef.current = playbackRate;
    if (external) post({ type: "RATE", playbackRate }); else playerRef.current?.setPlaybackRate(playbackRate);
  };
  const openPopout = () => {
    const channel = encodeURIComponent(videoReviewChannelName(matchId));
    const url = `/partido/${encodeURIComponent(matchId)}/video-review/player?channel=${channel}`;
    const popup = window.open(url, `alamedapp-video-${matchId}`, "popup=yes,width=980,height=720,resizable=yes");
    if (!popup) { setPopupBlocked(true); return false; }
    popupRef.current = popup;
    setPopupBlocked(false);
    setExternal(true);
    onPopoutChange?.(true);
    return true;
  };

  useImperativeHandle(ref, () => ({
    currentTime: () => external
      ? exactSecondRef.current
      : preciseVideoSecond(playerRef.current?.currentTime() ?? exactSecondRef.current),
    seekTo,
    play,
    pause,
    setPlaybackRate,
    openPopout,
  }));

  return <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
      <div><p className="text-[10px] font-black tracking-[.16em] text-cyan-300">VÍDEO ACTIVO</p><p className="text-sm font-black">{label}</p></div>
      <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-950 px-3 py-2 font-mono text-sm font-black text-cyan-200">{formatPreciseVideoTime(visualSecond)}</span><button type="button" onClick={openPopout} disabled={external} className="min-h-11 rounded-xl bg-violet-500 px-3 text-xs font-black text-slate-950 disabled:opacity-40">{external ? "VÍDEO EN VENTANA" : "ABRIR VÍDEO EN OTRA VENTANA"}</button></div>
    </header>
    {external ? <div className="grid aspect-video place-items-center bg-black p-8 text-center"><div><p className="text-lg font-black text-violet-200">REPRODUCTOR ACTIVO EN LA VENTANA SEPARADA</p><p className="mt-2 text-sm text-slate-400">La cronología solo se edita aquí. Al cerrar la ventana, el vídeo vuelve automáticamente.</p></div></div> : <YouTubeLabPlayer ref={playerRef} videoId={videoId} initialSecond={inlineStartSecond} onPreciseTimeChange={(second) => { exactSecondRef.current = preciseVideoSecond(second); setVisualSecond(exactSecondRef.current); onVisualTimeChange?.(exactSecondRef.current); }} onPlayingChange={(playing) => { playingRef.current = playing; }} />}
    {popupBlocked && <p role="status" className="border-t border-amber-800 bg-amber-950/50 px-3 py-2 text-xs font-bold text-amber-200">El navegador bloqueó la ventana. El reproductor sigue disponible aquí; permite pop-ups para separarlo.</p>}
  </section>;
});

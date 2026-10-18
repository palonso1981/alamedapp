"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { YouTubeLabPlayer, YouTubeLabPlayerHandle } from "../../../../../components/video/YouTubeLabPlayer";
import { formatPreciseVideoTime, preciseVideoSecond } from "../../../../../lib/videoReviewWorkspace";
import { isVideoReviewPopoutCommand, VideoReviewPopoutEvent } from "../../../../../lib/videoReviewPopout";

interface PlayerState {
  videoId: string;
  label: string;
  second: number;
  playing: boolean;
  playbackRate: number;
}

export default function VideoReviewPlayerPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const channelName = searchParams.get("channel") ?? `alamedapp:video-review:${matchId}`;
  const playerRef = useRef<YouTubeLabPlayerHandle>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const currentSecondRef = useRef(0);
  const [state, setState] = useState<PlayerState | null>(null);
  const [currentSecond, setCurrentSecond] = useState(0);
  const [playing, setPlaying] = useState(false);

  const post = useCallback((message: VideoReviewPopoutEvent) => {
    channelRef.current?.postMessage(message);
    window.opener?.postMessage({ channel: channelName, payload: message }, window.location.origin);
  }, [channelName]);

  const applyCommand = useCallback((value: unknown) => {
    if (!isVideoReviewPopoutCommand(value)) return;
    if (value.type === "STATE") {
      setState({ videoId: value.videoId, label: value.label, second: value.second, playing: value.playing, playbackRate: value.playbackRate });
      currentSecondRef.current = value.second;
      setCurrentSecond(value.second);
      window.setTimeout(() => {
        playerRef.current?.seekTo(value.second);
        playerRef.current?.setPlaybackRate(value.playbackRate);
        if (value.playing) playerRef.current?.play();
      }, 80);
    }
    if (value.type === "SEEK") { currentSecondRef.current = value.second; setCurrentSecond(value.second); playerRef.current?.seekTo(value.second); }
    if (value.type === "PLAY") playerRef.current?.play();
    if (value.type === "PAUSE") playerRef.current?.pause();
    if (value.type === "RATE") { setState((current) => current ? { ...current, playbackRate: value.playbackRate } : current); playerRef.current?.setPlaybackRate(value.playbackRate); }
    if (value.type === "REQUEST_TIME") post({ type: "CAPTURED_TIME", requestId: value.requestId, second: playerRef.current?.currentTime() ?? currentSecondRef.current });
  }, [post]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
    channelRef.current = channel;
    if (channel) channel.onmessage = (message: MessageEvent<unknown>) => applyCommand(message.data);
    const onMessage = (message: MessageEvent<unknown>) => {
      if (message.origin !== window.location.origin || !message.data || typeof message.data !== "object") return;
      const envelope = message.data as { channel?: string; payload?: unknown };
      if (envelope.channel === channelName) applyCommand(envelope.payload);
    };
    const close = () => post({ type: "CLOSED" });
    window.addEventListener("message", onMessage);
    window.addEventListener("beforeunload", close);
    post({ type: "READY" });
    return () => { close(); channel?.close(); channelRef.current = null; window.removeEventListener("message", onMessage); window.removeEventListener("beforeunload", close); };
  }, [applyCommand, channelName, post]);

  return <main className="flex min-h-screen flex-col bg-black text-white">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2">
      <div><p className="text-[10px] font-black tracking-[.18em] text-violet-300">APP ALAM · VÍDEO SEPARADO</p><h1 className="font-black">{state?.label ?? "Esperando al workspace…"}</h1></div>
      <div className="flex items-center gap-2"><span className="rounded-lg bg-slate-900 px-3 py-2 font-mono text-sm font-black text-cyan-200">{formatPreciseVideoTime(currentSecond)}</span><button type="button" onClick={() => window.close()} className="min-h-11 rounded-xl bg-slate-800 px-4 text-xs font-black">CERRAR</button></div>
    </header>
    <section className="min-h-0 flex-1">
      {state ? <YouTubeLabPlayer ref={playerRef} videoId={state.videoId} initialSecond={state.second} autoPlay={state.playing} presentation="REEL" onPreciseTimeChange={(second) => { const exact = preciseVideoSecond(second); currentSecondRef.current = exact; setCurrentSecond(exact); post({ type: "TIME", second: exact, playing, playbackRate: state.playbackRate }); }} onPlayingChange={setPlaying} /> : <div className="grid h-full min-h-[60vh] place-items-center text-slate-500">Conecta el workspace principal.</div>}
    </section>
  </main>;
}

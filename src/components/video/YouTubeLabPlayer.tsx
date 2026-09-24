"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatVideoTimestamp } from "../../lib/videoIndex";
import { shiftVideoSecond } from "../../lib/videoLab";

type YTPlayer = {
  destroy?: () => void;
  getCurrentTime?: () => number;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (rate: number) => void;
};

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: Record<string, unknown>) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YouTubeLabPlayerHandle {
  currentSecond: () => number;
  seekTo: (second: number) => void;
}

interface Props {
  videoId: string;
  initialSecond?: number;
  onTimeChange?: (second: number) => void;
  onActionHere?: (second: number) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export const YouTubeLabPlayer = forwardRef<YouTubeLabPlayerHandle, Props>(function YouTubeLabPlayer(
  { videoId, initialSecond = 0, onTimeChange, onActionHere },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const currentSecondRef = useRef(initialSecond);
  const [currentSecond, setCurrentSecond] = useState(initialSecond);
  const [speed, setSpeed] = useState(1);
  const readCurrentSecond = useCallback(() => {
    const value = playerRef.current?.getCurrentTime?.();
    return Number.isFinite(value) ? Math.max(0, Number(value)) : currentSecondRef.current;
  }, []);

  useImperativeHandle(ref, () => ({
    currentSecond: () => Math.round(readCurrentSecond()),
    seekTo: (second) => playerRef.current?.seekTo?.(Math.max(0, second), true),
  }), [readCurrentSecond]);

  useEffect(() => {
    let disposed = false;
    const create = () => {
      if (disposed || !hostRef.current || !window.YT?.Player) return;
      playerRef.current?.destroy?.();
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: { autoplay: 0, start: Math.max(0, Math.round(initialSecond)), playsinline: 1, rel: 0 },
      });
    };
    if (window.YT?.Player) create();
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); create(); };
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    }
    return () => {
      disposed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [initialSecond, videoId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const value = playerRef.current?.getCurrentTime?.();
      if (!Number.isFinite(value)) return;
      const next = Math.max(0, Math.round(Number(value)));
      currentSecondRef.current = next;
      setCurrentSecond(next);
      onTimeChange?.(next);
    }, 500);
    return () => window.clearInterval(interval);
  }, [onTimeChange]);

  const shift = (delta: -5 | -1 | 1 | 5) => {
    const next = shiftVideoSecond(readCurrentSecond(), delta);
    playerRef.current?.seekTo?.(next, true);
    currentSecondRef.current = next;
    setCurrentSecond(next);
    onTimeChange?.(next);
  };

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-2xl bg-black"><div ref={hostRef} className="h-full w-full" /></div>
      <div className="flex flex-wrap items-center gap-2">
        {([-5, -1, 1, 5] as const).map((delta) => (
          <button key={delta} type="button" onClick={() => shift(delta)} className="min-h-11 min-w-14 rounded-xl bg-slate-700 px-3 font-black active:scale-95">
            {delta > 0 ? `+${delta}` : delta}
          </button>
        ))}
        <span className="rounded-xl bg-slate-950 px-3 py-2 font-mono text-sm font-black text-cyan-300">{formatVideoTimestamp(currentSecond)}</span>
        <button type="button" onClick={() => onActionHere?.(Math.round(readCurrentSecond()))} className="min-h-12 flex-1 rounded-xl bg-amber-400 px-4 text-sm font-black text-slate-950 active:scale-[.99]">ACCIÓN AQUÍ</button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Velocidad de reproducción">
        {SPEEDS.map((value) => (
          <button key={value} type="button" onClick={() => { playerRef.current?.setPlaybackRate?.(value); setSpeed(value); }} className={`min-h-10 rounded-lg px-3 text-xs font-black ${speed === value ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{value}×</button>
        ))}
      </div>
    </div>
  );
});

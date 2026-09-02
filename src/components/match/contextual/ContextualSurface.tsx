"use client";

import { CSSProperties, MouseEvent, ReactNode } from "react";

import { contextualPlacement } from "../../../lib/contextualPlacement";
import { NormalizedCoordinates } from "../../../types";

interface ContextualSurfaceProps {
  anchor: NormalizedCoordinates;
  children: ReactNode;
  label: string;
  onCancel: () => void;
  compact?: boolean;
  viewportOnMobile?: boolean;
  wide?: boolean;
  immersive?: boolean;
}

type ContextualStyle = CSSProperties & {
  "--context-left": string;
  "--context-right": string;
  "--context-top": string;
  "--context-bottom": string;
  "--context-translate-x": string;
  "--context-mobile-top": string;
  "--context-mobile-bottom": string;
  "--context-mobile-left": string;
  "--context-mobile-right": string;
  "--context-width": string;
};

export function ContextualSurface({
  anchor,
  children,
  label,
  onCancel,
  compact = false,
  viewportOnMobile = false,
  wide = false,
  immersive = false,
}: ContextualSurfaceProps) {
  const placement = contextualPlacement(anchor);
  const center = placement.horizontal === "CENTER";
  const anchorGap = compact ? "4.25rem" : "2rem";
  const style: ContextualStyle = {
    "--context-left":
      placement.horizontal === "START"
        ? "0.5rem"
        : center
          ? `${anchor.x * 100}%`
          : "auto",
    "--context-right": placement.horizontal === "END" ? "0.5rem" : "auto",
    "--context-top":
      placement.vertical === "BELOW"
        ? `calc(${anchor.y * 100}% + ${anchorGap})`
        : "auto",
    "--context-bottom":
      placement.vertical === "ABOVE"
        ? `calc(${(1 - anchor.y) * 100}% + ${anchorGap})`
        : "auto",
    "--context-translate-x": center ? "-50%" : "0",
    "--context-mobile-top": anchor.y >= 0.5 ? "0.5rem" : "auto",
    "--context-mobile-bottom": anchor.y < 0.5 ? "5.5rem" : "auto",
    "--context-mobile-left": anchor.x >= 0.5 ? "0.5rem" : "auto",
    "--context-mobile-right": anchor.x < 0.5 ? "0.5rem" : "auto",
    "--context-width": compact ? "13rem" : immersive ? "64rem" : wide ? "29rem" : "25rem",
  };

  const stopPropagation = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div
      className={`pointer-events-none ${
        immersive
          ? "fixed inset-0 z-[90] bg-slate-950/80"
          : viewportOnMobile
          ? "fixed inset-0 z-[80] bg-slate-950/65 sm:absolute sm:z-30 sm:bg-transparent"
          : "absolute inset-0 z-30"
      }`}
    >
      <section
        className={`contextual-surface-frame ${compact ? "contextual-surface-frame--compact p-2" : immersive ? "p-2.5" : "p-2.5 pr-12"} ${viewportOnMobile ? "contextual-surface-frame--viewport" : ""} ${immersive ? "contextual-surface-frame--immersive" : ""} pointer-events-auto overflow-y-auto rounded-2xl border border-white/20 bg-slate-950/95 shadow-2xl backdrop-blur-sm`}
        style={style}
        aria-label={label}
        onClick={stopPropagation}
      >
        {!compact && <button
          type="button"
          onClick={onCancel}
          className="absolute right-2 top-2 grid min-h-11 min-w-11 place-items-center rounded-xl bg-slate-800 text-xl font-bold text-slate-300"
          aria-label="Cancelar acción pendiente"
        >
          ×
        </button>}
        {children}
      </section>
    </div>
  );
}

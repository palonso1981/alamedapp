"use client";

import { ReactNode, useEffect, useState } from "react";

export function PlayerImage({ src, alt = "", className = "", fallback }: { src?: string; alt?: string; className?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback}</>;
  // Firebase Storage y las URLs legacy se resuelven en runtime, por eso no se usa next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

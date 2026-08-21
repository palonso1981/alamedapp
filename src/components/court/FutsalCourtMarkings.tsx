export function FutsalCourtMarkings() {
  const line = "rgba(255,255,255,0.78)";
  const goal = "rgba(125,211,252,0.95)";
  const substitution = "rgba(251,191,36,0.95)";

  return (
    <svg
      viewBox="0 0 100 50"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g fill="none" stroke={line} strokeWidth="0.45" vectorEffect="non-scaling-stroke">
        <line x1="50" y1="0" x2="50" y2="50" />
        <circle cx="50" cy="25" r="7.5" />
        <circle cx="50" cy="25" r="0.45" fill={line} />
        <path d="M 0 6.25 A 15 15 0 0 1 15 21.25 L 15 28.75 A 15 15 0 0 1 0 43.75" />
        <path d="M 100 6.25 A 15 15 0 0 0 85 21.25 L 85 28.75 A 15 15 0 0 0 100 43.75" />
        <path d="M 0 1.5 A 1.5 1.5 0 0 0 1.5 0" />
        <path d="M 98.5 0 A 1.5 1.5 0 0 0 100 1.5" />
        <path d="M 0 48.5 A 1.5 1.5 0 0 1 1.5 50" />
        <path d="M 98.5 50 A 1.5 1.5 0 0 1 100 48.5" />
      </g>

      <g fill={line}>
        <circle cx="15" cy="25" r="0.6" />
        <circle cx="85" cy="25" r="0.6" />
      </g>
      <g fill={substitution}>
        <circle cx="25" cy="25" r="0.7" />
        <circle cx="75" cy="25" r="0.7" />
      </g>
      <g fill="none" stroke={goal} strokeWidth="0.7" vectorEffect="non-scaling-stroke">
        <rect x="0.35" y="21.25" width="2.8" height="7.5" rx="0.4" />
        <rect x="96.85" y="21.25" width="2.8" height="7.5" rx="0.4" />
        <line x1="1.3" y1="21.25" x2="1.3" y2="28.75" opacity="0.55" />
        <line x1="2.2" y1="21.25" x2="2.2" y2="28.75" opacity="0.55" />
        <line x1="97.8" y1="21.25" x2="97.8" y2="28.75" opacity="0.55" />
        <line x1="98.7" y1="21.25" x2="98.7" y2="28.75" opacity="0.55" />
      </g>

      <g
        fill="none"
        stroke={substitution}
        strokeWidth="1"
        strokeDasharray="1.4 1"
        vectorEffect="non-scaling-stroke"
      >
        <line x1="31" y1="49" x2="44" y2="49" />
        <line x1="56" y1="49" x2="69" y2="49" />
      </g>
      <g stroke={substitution} strokeWidth="0.7" vectorEffect="non-scaling-stroke">
        {[31, 44, 56, 69].map((x) => (
          <line key={x} x1={x} y1="47" x2={x} y2="50" />
        ))}
      </g>
    </svg>
  );
}

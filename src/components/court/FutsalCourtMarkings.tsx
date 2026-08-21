export function FutsalCourtMarkings() {
  const line = "rgba(255,255,255,0.78)";
  const goal = "rgba(255,255,255,0.88)";

  return (
    <svg
      viewBox="0 0 100 50"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g fill="none" stroke={line} strokeWidth="0.45" vectorEffect="non-scaling-stroke">
        <rect x="3" y="2" width="94" height="46" />
        <line x1="50" y1="2" x2="50" y2="48" />
        <circle cx="50" cy="25" r="7.5" />
        <circle cx="50" cy="25" r="0.45" fill={line} />
        <path d="M 3 6.25 A 15 15 0 0 1 18 21.25 L 18 28.75 A 15 15 0 0 1 3 43.75" />
        <path d="M 97 6.25 A 15 15 0 0 0 82 21.25 L 82 28.75 A 15 15 0 0 0 97 43.75" />
        <path d="M 3 3.5 A 1.5 1.5 0 0 0 4.5 2" />
        <path d="M 95.5 2 A 1.5 1.5 0 0 0 97 3.5" />
        <path d="M 3 46.5 A 1.5 1.5 0 0 1 4.5 48" />
        <path d="M 95.5 48 A 1.5 1.5 0 0 1 97 46.5" />
      </g>

      <g fill={line}>
        <circle cx="18" cy="25" r="0.55" />
        <circle cx="82" cy="25" r="0.55" />
        <circle cx="28" cy="25" r="0.55" />
        <circle cx="72" cy="25" r="0.55" />
      </g>
      <g fill="none" stroke={goal} strokeWidth="0.7" vectorEffect="non-scaling-stroke">
        <path d="M 3 21.25 H 0.5 V 28.75 H 3" />
        <path d="M 97 21.25 H 99.5 V 28.75 H 97" />
        <line x1="1.35" y1="21.25" x2="1.35" y2="28.75" opacity="0.45" />
        <line x1="98.65" y1="21.25" x2="98.65" y2="28.75" opacity="0.45" />
      </g>

      <g
        stroke={line}
        strokeWidth="0.55"
        vectorEffect="non-scaling-stroke"
      >
        {[31, 44, 56, 69].map((x) => (
          <line key={x} x1={x} y1="46.7" x2={x} y2="49.3" />
        ))}
      </g>
    </svg>
  );
}

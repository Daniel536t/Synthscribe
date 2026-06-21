// A lightweight, CSS-only echo of the 3D Resonance orb. Used as a recurring
// motif in places where a full WebGL canvas would be overkill — empty states,
// loading states, small accents — so the orb identity stays consistent app-wide
// without spawning extra GPU contexts.

interface OrbMarkProps {
  className?: string;
  spinning?: boolean;
}

export default function OrbMark({ className, spinning = false }: OrbMarkProps) {
  return (
    <div className={`relative ${className ?? ""}`} aria-hidden="true">
      <div className="orb-mark absolute inset-0" />
      <div
        className={`orb-mark-ring absolute inset-0 ${spinning ? "orb-mark-spin" : ""}`}
      />
    </div>
  );
}

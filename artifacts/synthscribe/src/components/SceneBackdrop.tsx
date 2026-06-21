import { Component, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { audioReactive } from "@/lib/audioReactive";

// A single, persistent, audio-reactive backdrop that lives behind the whole app.
// It renders a slow-drifting field of soft "bokeh" lights in the brand palette so
// the 3D identity feels like the environment, not a one-off widget. It is mounted
// once at the app root (so it survives route changes) and never captures pointer
// events. Degrades to nothing (the CSS body gradient shows through) when WebGL is
// unavailable, and calms right down when the user prefers reduced motion.

let webglSupported: boolean | null = null;
function hasWebGL(): boolean {
  if (webglSupported !== null) return webglSupported;
  try {
    const canvas = document.createElement("canvas");
    webglSupported = !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// Brand palette (primary / secondary / accent family) as sRGB hexes.
const PALETTE = ["#7c3aed", "#a855f7", "#ec4899", "#22d3ee", "#6366f1"];

// Soft round sprite so each particle is a gentle glow rather than a hard dot.
function makeSprite(): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Particles({ reduced }: { reduced: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const smooth = useRef(0);
  const sprite = useMemo(() => makeSprite(), []);

  const { positions, colors, count } = useMemo(() => {
    const count = reduced ? 110 : 260;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 9 - 2;
      c.set(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, colors, count };
  }, [reduced]);

  useFrame((state, delta) => {
    const d = Math.min(0.05, delta);
    const level = audioReactive.isActive ? audioReactive.getLevel() : 0;
    smooth.current += (level - smooth.current) * Math.min(1, d * 4);
    const drive = smooth.current;
    const t = state.clock.elapsedTime;

    if (pointsRef.current) {
      pointsRef.current.rotation.y += d * (reduced ? 0.004 : 0.018);
      pointsRef.current.rotation.x = Math.sin(t * 0.05) * 0.05;
      pointsRef.current.position.y = reduced ? 0 : Math.sin(t * 0.12) * 0.4;
    }
    if (matRef.current) {
      matRef.current.size = (reduced ? 0.34 : 0.42) + drive * 0.5;
      matRef.current.opacity = 0.32 + drive * 0.4;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute
          attach="attributes-uv"
          args={[new Float32Array(count * 2), 2]}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        map={sprite}
        vertexColors
        transparent
        size={0.42}
        sizeAttenuation
        depthWrite={false}
        opacity={0.34}
      />
    </points>
  );
}

class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function SceneBackdrop() {
  const reduced = prefersReducedMotion();
  if (!hasWebGL()) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ contain: "strict" }}
    >
      <CanvasBoundary>
        <Canvas
          camera={{ position: [0, 0, 7], fov: 60 }}
          dpr={[1, 1.5]}
          gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
          frameloop={reduced ? "demand" : "always"}
        >
          <Particles reduced={reduced} />
        </Canvas>
      </CanvasBoundary>
    </div>
  );
}

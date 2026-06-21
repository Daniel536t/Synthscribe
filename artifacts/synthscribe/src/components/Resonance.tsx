import {
  Component,
  Suspense,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import { audioReactive, vibeColor } from "@/lib/audioReactive";

type Mode = "idle" | "recording" | "playing";

interface ResonanceProps {
  vibe?: string | null;
  mode?: Mode;
  className?: string;
}

// Detect WebGL support once so we can degrade to a CSS orb instead of crashing.
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

// The breathing / reacting orb. Reads the shared analyser every frame — never
// via React state — so it stays smooth and only re-renders when props change.
function Orb({
  vibe,
  mode,
  reduced,
}: {
  vibe?: string | null;
  mode?: Mode;
  reduced: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.Material & { distort: number; speed: number }>(
    null as never,
  );
  const lightRef = useRef<THREE.PointLight>(null);
  const smooth = useRef(0);
  const targetColor = useMemo(
    () => new THREE.Color(vibeColor(vibe)),
    [vibe],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const d = Math.min(0.05, delta);
    // When the caller pins us to "idle" we always breathe, regardless of any
    // stale analyser state left over from a previous record/playback session.
    const active = mode !== "idle" && audioReactive.isActive;
    const level = active ? audioReactive.getLevel() : 0;
    const bands = active
      ? audioReactive.getBands()
      : { bass: 0, mid: 0, treble: 0 };

    // Smooth the incoming level so the surface eases rather than jitters.
    const idleBreath = (Math.sin(t * 1.3) * 0.5 + 0.5) * (reduced ? 0.12 : 0.22);
    const incoming = active ? Math.min(1, level * 1.6) : idleBreath;
    smooth.current += (incoming - smooth.current) * Math.min(1, d * 7);
    const drive = smooth.current;

    if (meshRef.current) {
      const s = 1 + drive * (reduced ? 0.12 : 0.4);
      meshRef.current.scale.setScalar(s);
      const spin = reduced ? 0.04 : 0.12 + drive * 0.8 + bands.treble * 0.6;
      meshRef.current.rotation.y += d * spin;
      meshRef.current.rotation.x += d * spin * 0.4;
    }
    if (shellRef.current) {
      const s = 1.18 + drive * 0.5 + bands.bass * 0.3;
      shellRef.current.scale.setScalar(s);
      shellRef.current.rotation.y -= d * (0.05 + drive * 0.3);
      shellRef.current.rotation.z += d * 0.03;
    }
    if (matRef.current) {
      matRef.current.distort = 0.22 + drive * (reduced ? 0.15 : 0.55);
      matRef.current.speed = 1 + drive * 3;
      const mat = matRef.current as unknown as {
        color: THREE.Color;
        emissive: THREE.Color;
        emissiveIntensity: number;
      };
      mat.color.lerp(targetColor, 0.06);
      mat.emissive.lerp(targetColor, 0.06);
      mat.emissiveIntensity = 0.15 + drive * 0.9;
    }
    if (lightRef.current) {
      lightRef.current.color.lerp(targetColor, 0.06);
      lightRef.current.intensity = 6 + drive * 30;
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight ref={lightRef} position={[2, 3, 4]} intensity={8} />
      <pointLight position={[-4, -2, -2]} intensity={2} color="#4c1d95" />

      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1, 12]} />
        <MeshDistortMaterial
          ref={matRef as never}
          color={vibeColor(vibe)}
          emissive={vibeColor(vibe)}
          emissiveIntensity={0.2}
          roughness={0.18}
          metalness={0.45}
          distort={0.25}
          speed={1.5}
        />
      </mesh>

      <mesh ref={shellRef}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial
          color={vibeColor(vibe)}
          wireframe
          transparent
          opacity={0.12}
        />
      </mesh>
    </>
  );
}

// CSS fallback orb when WebGL is unavailable (or the canvas errors out).
function FallbackOrb({ vibe }: { vibe?: string | null }) {
  const color = vibeColor(vibe);
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="blob-shape h-2/3 aspect-square animate-pulse"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${color}, transparent 70%)`,
          filter: "blur(8px)",
          opacity: 0.85,
        }}
      />
    </div>
  );
}

class CanvasBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function Resonance({ vibe, mode, className }: ResonanceProps) {
  const reduced = prefersReducedMotion();
  // Runtime WebGL context loss (GPU reset, too many contexts) doesn't throw a
  // React error, so the error boundary can't catch it. Track it explicitly and
  // overlay the CSS orb until/unless the context is restored.
  const [contextLost, setContextLost] = useState(false);

  if (!hasWebGL()) {
    return (
      <div className={className} style={{ position: "relative" }}>
        <FallbackOrb vibe={vibe} />
      </div>
    );
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      <CanvasBoundary fallback={<FallbackOrb vibe={vibe} />}>
        <Canvas
          camera={{ position: [0, 0, 4.2], fov: 45 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            const canvas = gl.domElement;
            canvas.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              setContextLost(true);
            });
            canvas.addEventListener("webglcontextrestored", () => {
              setContextLost(false);
            });
          }}
        >
          <Suspense fallback={null}>
            <Orb vibe={vibe} mode={mode} reduced={reduced} />
          </Suspense>
        </Canvas>
        {contextLost && <FallbackOrb vibe={vibe} />}
      </CanvasBoundary>
    </div>
  );
}

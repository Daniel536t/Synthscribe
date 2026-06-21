// A tiny shared Web Audio analyser that the 3D "Resonance" interface reads from.
//
// Two sources can feed it:
//   - a live microphone MediaStream (while the user records a hum)
//   - an <audio> element (while a finished song plays back)
//
// Components don't subscribe via React state (that would re-render every frame).
// Instead they read getLevel()/getBands() inside their requestAnimationFrame /
// useFrame loop. When nothing is connected the getters return 0 and callers fall
// back to a gentle idle "breathing" animation.

type Bands = { bass: number; mid: number; treble: number };

class AudioReactive {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private currentSource: AudioNode | null = null;
  // createMediaElementSource may only be called once per element, so cache it.
  private elementSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private active = false;

  private ensureAnalyser(): AnalyserNode | null {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.82;
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
      }
      return this.analyser;
    } catch {
      return null;
    }
  }

  private disconnectSource() {
    if (this.currentSource) {
      try {
        this.currentSource.disconnect();
      } catch {
        /* noop */
      }
      this.currentSource = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* noop */
      }
    }
    this.active = false;
  }

  /** Feed the analyser from a live microphone stream (not routed to speakers). */
  async connectStream(stream: MediaStream): Promise<void> {
    const analyser = this.ensureAnalyser();
    if (!analyser || !this.ctx) return;
    try {
      await this.ctx.resume();
      this.disconnectSource();
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      this.currentSource = src;
      this.active = true;
    } catch {
      this.active = false;
    }
  }

  /** Feed the analyser from a playing <audio> element (also routed to speakers). */
  async connectElement(el: HTMLAudioElement): Promise<void> {
    const analyser = this.ensureAnalyser();
    if (!analyser || !this.ctx) return;
    try {
      await this.ctx.resume();
      this.disconnectSource();
      let src = this.elementSources.get(el);
      if (!src) {
        src = this.ctx.createMediaElementSource(el);
        this.elementSources.set(el, src);
      }
      src.connect(analyser);
      analyser.connect(this.ctx.destination);
      this.currentSource = src;
      this.active = true;
    } catch {
      // Cross-origin/tainted media or unsupported: playback still works through
      // the element itself; the visual just falls back to idle breathing.
      this.active = false;
    }
  }

  /** Stop reacting; the visual returns to idle breathing. */
  stop(): void {
    this.disconnectSource();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Overall loudness, 0..1. Returns 0 when nothing is connected. */
  getLevel(): number {
    if (!this.analyser || !this.active) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum / this.data.length / 255;
  }

  /** Normalised energy in low / mid / high frequency bands, each 0..1. */
  getBands(): Bands {
    if (!this.analyser || !this.active) return { bass: 0, mid: 0, treble: 0 };
    this.analyser.getByteFrequencyData(this.data);
    const n = this.data.length;
    const third = Math.max(1, Math.floor(n / 3));
    const avg = (start: number, end: number) => {
      let s = 0;
      for (let i = start; i < end; i++) s += this.data[i];
      return s / (end - start) / 255;
    };
    return {
      bass: avg(0, third),
      mid: avg(third, third * 2),
      treble: avg(third * 2, n),
    };
  }
}

export const audioReactive = new AudioReactive();

// Per-vibe accent color for the 3D surface (hex, sRGB).
export const VIBE_COLORS: Record<string, string> = {
  pop: "#ff4fd8",
  lofi: "#f59e0b",
  cinematic: "#6366f1",
  rnb: "#a855f7",
  electronic: "#22d3ee",
  acoustic: "#10b981",
  ambient: "#2dd4bf",
  serenity: "#fb7185",
  soul: "#f97316",
  jazz: "#3b82f6",
  folk: "#84cc16",
  afrobeat: "#ef4444",
  synthwave: "#d946ef",
};

export function vibeColor(vibe: string | undefined | null): string {
  return (vibe && VIBE_COLORS[vibe]) || "#a855f7";
}

"""Rule-based CPU arranger: build a backing track around the user's melody.

Reads a JSON spec, writes a mono WAV:
  {
    "key": "C minor",      # detected key ("<root> <major|minor>")
    "tempo": 103.0,         # detected tempo (BPM)
    "vibe": "acoustic",     # chosen vibe -> arrangement style
    "targetDuration": 24.0, # song length in seconds
    "sampleRate": 44100
  }

This is a deterministic, GPU-free "studio band": it picks a chord progression in
the detected key, lays down drums + bass + chord/keys layers locked to the
detected tempo, and renders everything with lightweight numpy synthesis. The
user's faithfully-transcribed melody is mixed ON TOP of this bed by the pipeline,
so the bed is intentionally kept in a supporting register with melodic space.

All synthesis is procedural (no soundfonts/samples) so it never depends on
external binaries or downloads and always produces output.
"""

import json
import sys
import zlib

import numpy as np

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Triad qualities -> semitone intervals from the chord root.
TRIADS = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "dim": [0, 3, 6],
}

# Diatonic chord progressions as (semitone offset from tonic, quality). Chosen to
# sound good with a hummed melody and to leave harmonic space for it.
MAJOR_PROGRESSIONS = [
    [(0, "maj"), (7, "maj"), (9, "min"), (5, "maj")],   # I  V  vi IV
    [(0, "maj"), (5, "maj"), (7, "maj"), (5, "maj")],   # I  IV V  IV
    [(9, "min"), (5, "maj"), (0, "maj"), (7, "maj")],   # vi IV I  V
]
MINOR_PROGRESSIONS = [
    [(0, "min"), (8, "maj"), (3, "maj"), (10, "maj")],  # i  VI III VII
    [(0, "min"), (5, "min"), (8, "maj"), (7, "min")],   # i  iv VI  v
    [(0, "min"), (10, "maj"), (8, "maj"), (10, "maj")], # i  VII VI VII
]


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


# ---------------------------------------------------------------------------
# Drum synthesis
# ---------------------------------------------------------------------------
def synth_kick(sr, dur=0.20):
    n = int(dur * sr)
    t = np.arange(n) / sr
    # Pitch sweep from ~110Hz down to ~45Hz.
    f = 110.0 * np.exp(-t * 28.0) + 45.0
    phase = 2 * np.pi * np.cumsum(f) / sr
    body = np.sin(phase) * np.exp(-t * 9.0)
    click = np.exp(-t * 220.0) * 0.6  # transient attack
    return (body + click).astype(np.float32)


def synth_snare(sr, rng, dur=0.20):
    n = int(dur * sr)
    t = np.arange(n) / sr
    noise = rng.uniform(-1, 1, n) * np.exp(-t * 22.0)
    tone = np.sin(2 * np.pi * 185.0 * t) * np.exp(-t * 30.0) * 0.5
    return (noise * 0.8 + tone).astype(np.float32)


def synth_hat(sr, rng, dur=0.05, decay=90.0):
    n = int(dur * sr)
    t = np.arange(n) / sr
    noise = rng.uniform(-1, 1, n)
    # Crude brightening: emphasise the high-frequency difference.
    noise = np.diff(noise, prepend=noise[0])
    return (noise * np.exp(-t * decay)).astype(np.float32)


# ---------------------------------------------------------------------------
# Pitched synthesis
# ---------------------------------------------------------------------------
def adsr(n, sr, a=0.01, d=0.08, s=0.7, r=0.12):
    env = np.zeros(n, dtype=np.float32)
    ai = min(int(a * sr), n)
    di = min(int(d * sr), max(0, n - ai))
    ri = min(int(r * sr), n)
    if ai > 0:
        env[:ai] = np.linspace(0, 1, ai)
    if di > 0:
        env[ai:ai + di] = np.linspace(1, s, di)
    sustain_end = max(ai + di, n - ri)
    env[ai + di:sustain_end] = s
    if ri > 0:
        start = env[sustain_end - 1] if sustain_end - 1 >= 0 else s
        env[sustain_end:] = np.linspace(start, 0, n - sustain_end)
    return env


def synth_keys(freq, dur, sr, partials=(1.0, 0.5, 0.22, 0.1)):
    """Warm electric-piano-ish tone (additive + soft attack/decay)."""
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr
    wave = np.zeros(n, dtype=np.float32)
    for i, amp in enumerate(partials, start=1):
        wave += amp * np.sin(2 * np.pi * freq * i * t)
    env = adsr(n, sr, a=0.008, d=0.25, s=0.55, r=min(0.3, dur * 0.4))
    return (wave * env).astype(np.float32)


def synth_bass(freq, dur, sr):
    """Round bass: fundamental + a touch of 2nd/3rd harmonic, punchy envelope."""
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr
    wave = (
        1.0 * np.sin(2 * np.pi * freq * t)
        + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
        + 0.08 * np.sin(2 * np.pi * freq * 3 * t)
    )
    env = adsr(n, sr, a=0.006, d=0.10, s=0.75, r=min(0.12, dur * 0.4))
    return (wave * env).astype(np.float32)


# ---------------------------------------------------------------------------
# Placement helper
# ---------------------------------------------------------------------------
def place(buf, seg, start_sec, sr, gain=1.0):
    i0 = int(start_sec * sr)
    if i0 >= len(buf):
        return
    i1 = min(i0 + len(seg), len(buf))
    buf[i0:i1] += seg[: i1 - i0] * gain


# ---------------------------------------------------------------------------
# Style configuration
# ---------------------------------------------------------------------------
# Each style: drum pattern, bass pattern, keys pattern, gains, and tempo feel.
STYLES = {
    "groove": {
        "drums": "backbeat", "bass": "eighths", "keys": "rhodes",
        "gains": {"drums": 0.55, "bass": 0.6, "keys": 0.4}, "swing": 0.0,
    },
    "electronic": {
        "drums": "four_floor", "bass": "eighths", "keys": "arp",
        "gains": {"drums": 0.6, "bass": 0.6, "keys": 0.38}, "swing": 0.0,
    },
    "lofi": {
        "drums": "boombap", "bass": "quarters", "keys": "rhodes",
        "gains": {"drums": 0.45, "bass": 0.55, "keys": 0.42}, "swing": 0.14,
    },
    "gentle": {
        "drums": "soft", "bass": "half", "keys": "pad",
        "gains": {"drums": 0.3, "bass": 0.5, "keys": 0.45}, "swing": 0.0,
    },
    "cinematic": {
        "drums": "none", "bass": "half", "keys": "pad",
        "gains": {"drums": 0.0, "bass": 0.5, "keys": 0.5}, "swing": 0.0,
    },
}

VIBE_STYLE = {
    "pop": "groove", "rnb": "groove", "soul": "groove", "afrobeat": "groove",
    "electronic": "electronic", "synthwave": "electronic",
    "lofi": "lofi",
    "acoustic": "gentle", "folk": "gentle", "ambient": "gentle",
    "serenity": "gentle", "jazz": "gentle",
    "cinematic": "cinematic",
}


def parse_key(key):
    if not key:
        return 0, "minor"
    parts = key.strip().split()
    root = parts[0] if parts else "C"
    mode = parts[1].lower() if len(parts) > 1 else "major"
    try:
        root_pc = PITCH_CLASSES.index(root)
    except ValueError:
        root_pc = 0
    mode = "minor" if mode.startswith("min") else "major"
    return root_pc, mode


def build_chords(root_pc, mode, vibe):
    progs = MINOR_PROGRESSIONS if mode == "minor" else MAJOR_PROGRESSIONS
    # Deterministic progression choice per vibe so the same input is reproducible.
    idx = (sum(ord(c) for c in vibe) if vibe else 0) % len(progs)
    prog = progs[idx]
    chords = []
    # Keys around C4 (MIDI 60); centre chord roots near MIDI 60.
    base = 60 + root_pc
    while base > 67:
        base -= 12
    for off, qual in prog:
        croot = base + off
        tones = [croot + iv for iv in TRIADS[qual]]
        chords.append({"root": croot, "tones": tones})
    return chords


def render(spec):
    sr = int(spec.get("sampleRate", 44100))
    target = float(spec.get("targetDuration", 24) or 24)
    vibe = str(spec.get("vibe", "pop"))
    root_pc, mode = parse_key(spec.get("key"))

    tempo = float(spec.get("tempo", 0) or 0)
    if not (60 <= tempo <= 160):
        tempo = 100.0
    beat = 60.0 / tempo
    bar = beat * 4.0

    style = STYLES[VIBE_STYLE.get(vibe, "groove")]
    chords = build_chords(root_pc, mode, vibe)

    # Seed RNG from stable inputs so the same spec always renders an identical
    # backing track (the only randomness is in the drum noise synthesis). Use a
    # stable hash (zlib.crc32), since Python's built-in hash() of strings is
    # salted per process and would break cross-run determinism.
    seed_str = f"{root_pc}|{mode}|{vibe}|{round(tempo, 2)}|{round(target, 2)}"
    seed = zlib.crc32(seed_str.encode("utf-8"))
    rng = np.random.default_rng(seed)

    n_bars = max(1, int(np.ceil(target / bar)))
    total_sec = n_bars * bar
    n = int(total_sec * sr) + sr
    drums = np.zeros(n, dtype=np.float32)
    bass = np.zeros(n, dtype=np.float32)
    keys = np.zeros(n, dtype=np.float32)

    # Pre-render drum one-shots once.
    kick, snare, hat = synth_kick(sr), synth_snare(sr, rng), synth_hat(sr, rng)

    def swing(pos):
        # Delay the off-eighths slightly for a laid-back feel.
        if style["swing"] and (round((pos % 1.0) * 2) % 2 == 1):
            return pos + style["swing"] * 0.5
        return pos

    for b in range(n_bars):
        bar_t = b * bar
        chord = chords[b % len(chords)]

        # --- Drums ---------------------------------------------------------
        d = style["drums"]
        if d != "none":
            if d == "four_floor":
                kicks, snares = [0, 1, 2, 3], [1, 3]
                hats = [0.5, 1.5, 2.5, 3.5]
            elif d == "boombap":
                kicks, snares = [0, 2.5], [1, 3]
                hats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
            elif d == "soft":
                kicks, snares = [0, 2], [2]
                hats = [1, 3]
            else:  # backbeat
                kicks, snares = [0, 2], [1, 3]
                hats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
            for k in kicks:
                place(drums, kick, bar_t + swing(k) * beat, sr, 1.0)
            for s in snares:
                place(drums, snare, bar_t + s * beat, sr, 0.8)
            for h in hats:
                place(drums, hat, bar_t + swing(h) * beat, sr, 0.5)

        # --- Bass ----------------------------------------------------------
        bass_midi = chord["root"] - 24  # two octaves down
        bp = style["bass"]
        if bp == "eighths":
            hits = [i * 0.5 for i in range(8)]
        elif bp == "quarters":
            hits = [0, 1, 2, 3]
        else:  # half
            hits = [0, 2]
        for j, h in enumerate(hits):
            nxt = hits[j + 1] if j + 1 < len(hits) else 4.0
            dur = (nxt - h) * beat * 0.95
            # Occasional fifth for movement on eighth patterns.
            note = bass_midi + (7 if (bp == "eighths" and j % 4 == 3) else 0)
            seg = synth_bass(midi_to_hz(note), dur, sr)
            place(bass, seg, bar_t + swing(h) * beat, sr, 1.0)

        # --- Keys / chords -------------------------------------------------
        kp = style["keys"]
        if kp == "pad":
            for tone in chord["tones"]:
                seg = synth_keys(midi_to_hz(tone), bar * 0.98, sr)
                place(keys, seg, bar_t, sr, 0.5)
        elif kp == "stabs":
            for s in [0, 1, 2, 3]:
                for tone in chord["tones"]:
                    seg = synth_keys(midi_to_hz(tone), beat * 0.4, sr)
                    place(keys, seg, bar_t + s * beat, sr, 0.5)
        elif kp == "arp":
            arp = chord["tones"] + [chord["tones"][0] + 12]
            for i in range(8):
                tone = arp[i % len(arp)]
                seg = synth_keys(midi_to_hz(tone), beat * 0.5, sr)
                place(keys, seg, bar_t + swing(i * 0.5) * beat, sr, 0.55)
        else:  # rhodes: chord on 0 and 2
            for s in [0, 2]:
                for tone in chord["tones"]:
                    seg = synth_keys(midi_to_hz(tone), beat * 1.8, sr)
                    place(keys, seg, bar_t + s * beat, sr, 0.5)

    g = style["gains"]

    def norm(x):
        peak = float(np.max(np.abs(x))) if x.size else 0.0
        return x / peak if peak > 0 else x

    mix = norm(drums) * g["drums"] + norm(bass) * g["bass"] + norm(keys) * g["keys"]
    mix = mix[: int(total_sec * sr)]
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 0:
        mix = mix / peak * 0.85
    return mix.astype(np.float32), sr


def main(spec_path, out_path):
    import soundfile as sf

    with open(spec_path) as fh:
        spec = json.load(fh)
    mix, sr = render(spec)
    sf.write(out_path, mix, sr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: arrange.py <spec.json> <out.wav>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])

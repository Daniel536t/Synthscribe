"""Synthesize a clean lead-instrument WAV from a transcribed note list.

Reads a JSON spec, writes a mono 44.1kHz WAV:
  {
    "notes": [[startSec, durationSec, midi], ...],  # melody phrase
    "targetDuration": 24.0,                          # fill the song by looping
    "sampleRate": 44100
  }

The tone is a warm additive lead (fundamental + a couple of harmonics) with an
ADSR envelope and gentle vibrato so it sounds musical rather than like a bare
sine. The transcribed phrase is repeated (with a short rest) to roughly fill the
song length, keeping the user's hummed motif present throughout.
"""

import json
import sys

import numpy as np
import soundfile as sf


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def synth_note(freq, dur, sr):
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr

    # Gentle vibrato (~5.5 Hz) for a more human, expressive tone.
    vib = 1.0 + 0.004 * np.sin(2 * np.pi * 5.5 * t)
    phase = 2 * np.pi * freq * t * vib

    # Warm additive timbre: fundamental + soft harmonics.
    wave = (
        1.00 * np.sin(phase)
        + 0.28 * np.sin(2 * phase)
        + 0.12 * np.sin(3 * phase)
        + 0.05 * np.sin(4 * phase)
    )

    # ADSR envelope (click-free attack/release).
    env = np.ones(n)
    a = min(int(0.012 * sr), n // 2)
    d = min(int(0.06 * sr), n // 2)
    r = min(int(0.09 * sr), n)
    sustain = 0.82
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if d > 0:
        env[a : a + d] = np.linspace(1.0, sustain, d)
    env[a + d : n - r] = sustain
    if r > 0:
        env[n - r :] = np.linspace(env[n - r - 1] if n - r - 1 >= 0 else sustain, 0.0, r)

    return (wave * env).astype(np.float32)


def render_phrase(notes, sr):
    if not notes:
        return np.zeros(0, dtype=np.float32)
    end = max(s + d for s, d, _ in notes)
    buf = np.zeros(int(end * sr) + sr // 10, dtype=np.float32)
    for start, dur, midi in notes:
        if dur <= 0:
            continue
        seg = synth_note(midi_to_hz(midi), dur, sr)
        i0 = int(start * sr)
        i1 = min(i0 + len(seg), len(buf))
        buf[i0:i1] += seg[: i1 - i0]
    return buf


def main(spec_path, out_path):
    with open(spec_path) as fh:
        spec = json.load(fh)

    sr = int(spec.get("sampleRate", 44100))
    target = float(spec.get("targetDuration", 0) or 0)
    notes = spec.get("notes", [])

    phrase = render_phrase(notes, sr)
    if phrase.size == 0:
        # No usable melody: emit silence so the pipeline can still proceed.
        sf.write(out_path, np.zeros(int(max(target, 1.0) * sr), dtype=np.float32), sr)
        return

    # Loop the phrase (with a short rest) to roughly fill the song length.
    total = int(max(target, len(phrase) / sr) * sr)
    rest = np.zeros(int(0.45 * sr), dtype=np.float32)
    out = np.zeros(0, dtype=np.float32)
    while len(out) < total:
        out = np.concatenate([out, phrase, rest])
    out = out[:total]

    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0:
        out = out / peak * 0.7

    sf.write(out_path, out.astype(np.float32), sr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: render_melody.py <spec.json> <out.wav>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])

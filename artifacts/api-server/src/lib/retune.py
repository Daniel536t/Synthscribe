import json
import sys
import warnings

warnings.filterwarnings("ignore")

# Option 2 "note-for-note" lead-vocal renderer.
#
# Input: a clean spoken-lyrics WAV (from ElevenLabs TTS) plus a list of segments.
# Each segment names a slice of the spoken audio (srcStart..srcEnd) and the
# hummed note it should become: the target pitch (targetMidi), where it sits in
# the song (outStart) and how long it should last (outDur).
#
# For every segment we estimate the spoken slice's own pitch, shift it onto the
# hummed note's pitch, time-stretch it to the note's duration, and drop it at the
# note's start time. The result is the TTS voice singing the words on the EXACT
# pitches and timing the user hummed.

FADE_SECONDS = 0.006
MIN_SLICE_SECONDS = 0.02
MAX_SHIFT_SEMITONES = 24.0


def main(tts_path, seg_path, out_path):
    import librosa
    import numpy as np
    import soundfile as sf

    spec = json.load(open(seg_path))
    sr = int(spec.get("sampleRate", 44100))
    segments = spec.get("segments", [])
    if not segments:
        raise ValueError("no segments")

    y, _ = librosa.load(tts_path, sr=sr, mono=True)
    if y.size == 0:
        raise ValueError("empty tts audio")

    # One pitch pass over the whole spoken take; per-segment source pitch is the
    # median voiced f0 inside that slice's time window.
    f0, _, _ = librosa.pyin(y, fmin=80.0, fmax=500.0, sr=sr)
    times = librosa.times_like(f0, sr=sr)

    def source_midi(s, e):
        mask = (times >= s) & (times < e)
        vals = f0[mask]
        vals = vals[~np.isnan(vals)]
        if vals.size == 0:
            return None
        return float(librosa.hz_to_midi(float(np.median(vals))))

    total = max(seg["outStart"] + seg["outDur"] for seg in segments) + 0.3
    out = np.zeros(int(total * sr) + 1, dtype=np.float32)

    rendered = 0
    for seg in segments:
        a = int(seg["srcStart"] * sr)
        b = int(seg["srcEnd"] * sr)
        chunk = y[max(0, a):max(0, b)]
        if chunk.size < int(MIN_SLICE_SECONDS * sr):
            # Slice too short to pitch-track cleanly — pad with a little silence
            # so the note still lands (keeps timing intact even if quiet).
            pad = int(0.05 * sr) - chunk.size
            if pad > 0:
                chunk = np.pad(chunk, (0, pad))
        if chunk.size == 0:
            continue

        sm = source_midi(seg["srcStart"], seg["srcEnd"])
        n_steps = (float(seg["targetMidi"]) - sm) if sm is not None else 0.0
        n_steps = max(-MAX_SHIFT_SEMITONES, min(MAX_SHIFT_SEMITONES, n_steps))
        try:
            shifted = librosa.effects.pitch_shift(chunk, sr=sr, n_steps=n_steps)
        except Exception:
            shifted = chunk

        out_dur = max(0.05, float(seg["outDur"]))
        cur = len(shifted) / sr
        rate = cur / out_dur
        rate = max(0.25, min(4.0, rate))
        try:
            stretched = librosa.effects.time_stretch(shifted, rate=rate)
        except Exception:
            stretched = shifted

        n = len(stretched)
        if n == 0:
            continue
        fade = min(int(FADE_SECONDS * sr), n // 2)
        if fade > 0:
            env = np.ones(n, dtype=np.float32)
            env[:fade] = np.linspace(0.0, 1.0, fade)
            env[-fade:] = np.linspace(1.0, 0.0, fade)
            stretched = stretched * env

        start = int(seg["outStart"] * sr)
        end = start + n
        if end > out.size:
            out = np.pad(out, (0, end - out.size))
        out[start:end] += stretched.astype(np.float32)
        rendered += 1

    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0:
        out = (out / peak) * 0.89

    sf.write(out_path, out, sr, subtype="PCM_16")
    print(
        json.dumps(
            {"ok": True, "segments": rendered, "duration": round(out.size / sr, 3)}
        )
    )


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: retune.py <tts.wav> <segments.json> <out.wav>"}))
        sys.exit(1)
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

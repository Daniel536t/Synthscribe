import json
import sys
import warnings

warnings.filterwarnings("ignore")

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

# Scale degree semitone offsets from the tonic.
MAJOR_SCALE = {0, 2, 4, 5, 7, 9, 11}
MINOR_SCALE = {0, 2, 3, 5, 7, 8, 10}

# pyin search range — comfortable human humming register (C2..C6).
FMIN = 65.0
FMAX = 1050.0
MIN_NOTE_SECONDS = 0.09  # drop blips shorter than this


def correlate(chroma, profile, shift):
    rotated = profile[-shift:] + profile[:-shift] if shift else profile
    n = len(chroma)
    mc = sum(chroma) / n
    mp = sum(rotated) / n
    num = sum((chroma[i] - mc) * (rotated[i] - mp) for i in range(n))
    den_c = sum((chroma[i] - mc) ** 2 for i in range(n)) ** 0.5
    den_p = sum((rotated[i] - mp) ** 2 for i in range(n)) ** 0.5
    if den_c == 0 or den_p == 0:
        return 0.0
    return num / (den_c * den_p)


def detect_key(chroma_mean):
    best = (-2.0, 0, "major")
    for shift in range(12):
        cmaj = correlate(chroma_mean, MAJOR_PROFILE, shift)
        cmin = correlate(chroma_mean, MINOR_PROFILE, shift)
        if cmaj > best[0]:
            best = (cmaj, shift, "major")
        if cmin > best[0]:
            best = (cmin, shift, "minor")
    return best[1], best[2]  # (root_pitch_class, mode)


def snap_to_key(midi, root_pc, mode):
    """Nudge a clearly off-key note onto the nearest scale tone (max 1 semitone)."""
    scale = MAJOR_SCALE if mode == "major" else MINOR_SCALE
    degree = (int(midi) - root_pc) % 12
    if degree in scale:
        return int(midi)
    for delta in (-1, 1):
        if ((degree + delta) % 12) in scale:
            return int(midi) + delta
    return int(midi)


def extract_notes(y, sr, root_pc, mode, tempo):
    import librosa
    import numpy as np

    f0, voiced_flag, _ = librosa.pyin(
        y, fmin=FMIN, fmax=FMAX, sr=sr, frame_length=2048
    )
    times = librosa.times_like(f0, sr=sr)

    # Frame -> quantized MIDI (or None when unvoiced/uncertain).
    frame_midi = []
    for i, f in enumerate(f0):
        if voiced_flag[i] and f is not None and not np.isnan(f) and f > 0:
            m = int(round(float(librosa.hz_to_midi(f))))
            m = snap_to_key(m, root_pc, mode)
            frame_midi.append(m)
        else:
            frame_midi.append(None)

    hop = times[1] - times[0] if len(times) > 1 else 0.0

    # Group consecutive equal-pitch frames into notes.
    raw = []
    cur_midi = None
    start_t = 0.0
    for i, m in enumerate(frame_midi):
        if m != cur_midi:
            if cur_midi is not None:
                raw.append([start_t, times[i] - start_t, cur_midi])
            cur_midi = m
            start_t = times[i]
    if cur_midi is not None:
        raw.append([start_t, times[-1] + hop - start_t, cur_midi])

    # Keep only voiced notes long enough to matter.
    notes = [n for n in raw if n[2] is not None and n[1] >= MIN_NOTE_SECONDS]
    if not notes:
        return []

    # Trim leading silence so the melody starts at t=0.
    offset = notes[0][0]
    for n in notes:
        n[0] = round(n[0] - offset, 4)

    # Merge adjacent same-pitch notes separated by a tiny gap.
    merged = [notes[0]]
    for n in notes[1:]:
        prev = merged[-1]
        gap = n[0] - (prev[0] + prev[1])
        if n[2] == prev[2] and gap <= 0.06:
            prev[1] = round(n[0] + n[1] - prev[0], 4)
        else:
            merged.append(n)

    # Gentle timing quantization to a sixteenth-note grid (only if tempo is sane).
    if tempo and 40 <= tempo <= 220:
        grid = (60.0 / tempo) / 4.0
        for n in merged:
            n[0] = round(round(n[0] / grid) * grid, 4)
            steps = max(1, round(n[1] / grid))
            n[1] = round(steps * grid, 4)

    return [[float(s), float(d), int(m)] for s, d, m in merged]


def main(path):
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    tempo = 0.0
    try:
        t, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(t)[0])
    except Exception:
        tempo = 0.0

    root_pc, mode, key = 0, "major", None
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1).tolist()
        root_pc, mode = detect_key(chroma_mean)
        key = f"{PITCH_CLASSES[root_pc]} {mode}"
    except Exception:
        key = None

    notes = []
    try:
        notes = extract_notes(y, sr, root_pc, mode, tempo)
    except Exception:
        notes = []

    print(
        json.dumps(
            {
                "key": key,
                "tempo": round(tempo, 1),
                "durationSeconds": round(duration, 2),
                "notes": notes,
            }
        )
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no path"}))
        sys.exit(1)
    try:
        main(sys.argv[1])
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

import json
import sys
import warnings

warnings.filterwarnings("ignore")

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


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

    key = None
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1).tolist()
        best = (-2.0, 0, "major")
        for shift in range(12):
            cmaj = correlate(chroma_mean, MAJOR_PROFILE, shift)
            cmin = correlate(chroma_mean, MINOR_PROFILE, shift)
            if cmaj > best[0]:
                best = (cmaj, shift, "major")
            if cmin > best[0]:
                best = (cmin, shift, "minor")
        key = f"{PITCH_CLASSES[best[1]]} {best[2]}"
    except Exception:
        key = None

    print(json.dumps({"key": key, "tempo": round(tempo, 1), "durationSeconds": round(duration, 2)}))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no path"}))
        sys.exit(1)
    try:
        main(sys.argv[1])
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)

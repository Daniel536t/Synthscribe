---
name: SynthScribe melody faithfulness vs. the loved "hum calls out" sound
description: The product decision on how the user's tune appears in the final song — raw hum mixed over the bed, NOT a resynth lead.
---

# How the hummed melody appears in the final song

There were two competing approaches. The user explicitly chose the first and
called the second "trash":

1. **(SHIPPED, loved) Raw hum mixed over the AI bed.** The user's normalized hum
   (with a touch of reverb, gain ~0.85) is layered on top of the AI backing
   (gain ~0.9) in `pipeline.ts` step 4. Because the hum is short and the song is
   ~3x longer, the hum **"calls out" at the start and then melts into the band**.
   This is the original, loved SynthScribe sound. The ElevenLabs bed ignores the
   hum (text-prompt only, from the detected vibe/key/tempo), but the raw hum on
   top still carries the user's idea. (Note: the app is now ElevenLabs-only — the
   MusicGen hum-conditioning path was removed; see synthscribe-engine-coupling.md.)

2. **(REJECTED) Clean resynth lead.** Transcribe the hum (pyin) → render a clean
   additive-synth lead WAV → use that lead both to condition MusicGen and as the
   dominant melodic line, with the raw hum never used as audio. This is
   *note-faithful* but the user hated how the synth lead sounded ("trash"). Do
   NOT bring back `melody.ts` / `render_melody.py` / the clean-lead mix.

**Why mood-faithful beats note-faithful here:** AI conditioning is loose anyway
(MusicGen-melody drifts with `do_sample=True`; ElevenLabs is prompt-only), so a
"faithful" pipeline still won't reproduce exact notes. The user prefers hearing
their *actual recorded hum* over a clean-but-fake synth line. Garbage-in fears
about the breathy raw hum were overruled by the user's ear.

**How to apply:** keep `transcribe.py`/`transcribe.ts` — it's still used for
key/tempo detection and the ElevenLabs prompt, NOT for rendering a lead. Mix the
raw normalized hum into the final master; never resynthesize a lead.

## pyin extraction lessons (still relevant for key/tempo)
`transcribe.py` uses hardened librosa pyin (FMIN 70 / FMAX 1000, voiced_prob +
RMS gate, octave-fold to ±6 of the median, median filter, key-snap). Chosen over
Spotify Basic Pitch because Basic Pitch pulls TensorFlow/onnxruntime that
conflicts with api-server's numpy 2.x. Verify on REAL hums (`.local/fixtures/real_hum.wav`),
not synthetic sines, which hide octave/breath problems.

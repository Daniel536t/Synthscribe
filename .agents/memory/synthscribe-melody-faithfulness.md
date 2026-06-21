---
name: SynthScribe — how the hum is used and how songs get their words
description: Product decisions on the hum's role (seed only now) and where lyrics come from (user-written, "Option B").
---

# CURRENT direction (supersedes the older "raw hum mixed over the bed")

The product pivoted to **real singing**. As of the "Sung songs with AI lyrics" work:

1. **Hum = SEED ONLY.** The recorded hum is transcribed for key/tempo/mood and
   those feed the ElevenLabs prompt. The hum is **NOT layered into the final
   track** anymore. The normalized hum is still kept and shown as an "Original
   Hum" stem/keepsake, but `mixAndMaster`/hum-layering was removed from
   `pipeline.ts`. backing/vocals stem paths are now null; the single ElevenLabs
   call is the full final track.
2. **Lyrics = user-written ("Option B").** The user types lyrics in a textarea on
   Home; ElevenLabs sings those exact words via `generateSong()` in
   `elevenlabs.ts`. If lyrics are blank, it falls back to an instrumental
   (`generateBacking`).
   **Why Option B and not AI-drafted lyrics:** AI drafting (OpenAI via Replit AI
   Integrations) was blocked by Replit **phone verification** the user couldn't
   complete; user chose to write lyrics themselves rather than verify or supply an
   OpenAI key. If revisiting AI lyric drafting, the blocker is account-level phone
   verification, not code.
3. Song length is sized to the lyrics (~2 words/sec, clamped to ElevenLabs'
   10–60s window), not to hum length, when lyrics are present.

**How to apply:** keep `transcribe.py`/`transcribe.ts` for key/tempo only. Do not
re-add hum-into-final mixing or a resynth lead (see history below). `lyrics` is a
nullable column on `projects` and a field on CreateProjectRequest/Project in
`openapi.yaml`.

# HISTORY (older approaches, do not revert to these)

Before the singing pivot there were two competing approaches for making the hum
audible. The user chose #1 ("raw hum calls out then melts into the bed") and
called #2 "trash". Both are now moot because the hum is a seed only — but the
rejection of #2 still stands:

1. (old, shipped) Raw normalized hum (reverb, gain ~0.85) layered over the AI bed.
2. (REJECTED, "trash") Clean resynth lead: transcribe → additive-synth lead WAV →
   use as dominant melody. Do NOT bring back `melody.ts` / `render_melody.py` /
   the clean-lead mix.

# pyin extraction lessons (still relevant for key/tempo)
`transcribe.py` uses hardened librosa pyin (FMIN 70 / FMAX 1000, voiced_prob +
RMS gate, octave-fold to ±6 of the median, median filter, key-snap). Chosen over
Spotify Basic Pitch because Basic Pitch pulls TensorFlow/onnxruntime that
conflicts with api-server's numpy 2.x. Verify on REAL hums
(`.local/fixtures/real_hum.wav`), not synthetic sines, which hide octave/breath
problems.

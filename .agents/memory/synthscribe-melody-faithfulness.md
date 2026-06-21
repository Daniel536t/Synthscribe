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
2. **Lyrics = user-written OR AI-drafted from the hum.** The user can type lyrics
   in a textarea on Home; ElevenLabs sings those exact words via `generateSong()`
   in `elevenlabs.ts`. If lyrics are blank, it falls back to an instrumental
   (`generateBacking`).
   **AI lyric drafting is now implemented (supersedes "Option B only"):** the hum's
   extracted melody notes build a per-line syllable scaffold (`lib/lyrics.ts`),
   then a **user-supplied NVIDIA-hosted Mistral** model drafts theme-based lyrics
   shaped to that scaffold (`lib/nvidia.ts`, OpenAI-compatible at
   integrate.api.nvidia.com/v1; env NVIDIA_API_KEY, override NVIDIA_BASE_URL /
   NVIDIA_MODEL). A `theme` column on `projects` + a `What's it about?` field drive
   it. UI: standalone `POST /api/lyrics/draft` (re-uploads hum) behind the "Write
   from my hum" button; `pipeline.ts` also auto-drafts when theme && !lyrics.
   **Why NVIDIA and not OpenAI:** OpenAI via Replit AI Integrations was blocked by
   Replit phone verification the user couldn't complete; they supplied an NVIDIA
   key instead. Drafting is OFF (503) when NVIDIA_API_KEY is unset.
3. Song length is sized to the lyrics (~2 words/sec, clamped to ElevenLabs'
   10–60s window), not to hum length, when lyrics are present.

**How to apply:** keep `transcribe.py`/`transcribe.ts` for key/tempo only. `lyrics`
is a nullable column on `projects` and a field on CreateProjectRequest/Project in
`openapi.yaml`. For the default (`structural`) mode, do not re-add hum-into-final
mixing or a synth resynth lead (see history below).

# Option 2 "Note-for-Note" — opt-in, additive (does NOT replace the above)

A second render mode (`renderMode`: `structural` default | `note_for_note`) makes
the lead vocal sing the user's words on the EXACT hummed pitches/timing over the
backing. It is purely additive — Option 1 stays the default and the whole Option 2
path is guarded + falls back to Option 1 on ANY failure.

Durable decisions/lessons (the *why*, not the diff):
- **Real voice, conformed — not resynth.** The voice is ElevenLabs
  TTS-with-timestamps, pitch/time-CONFORMED to the hum. This is distinct from the
  REJECTED synth resynth lead below; do not conflate them.
- **Conform runs LOCALLY (librosa), not on Modal/GPU.** Pitch/time conform is
  CPU-only DSP; running it on Modal would add deploy fragility and risk
  silent-fallback masking of worker failures. Keep it local.
- **Verify exactness on the ISOLATED worker, never the final mix.** Backing bass
  dominates full-mix pitch detection and hides the lead, so a muddy mix contour is
  NOT evidence of failure. Feed a synthetic tone -> target notes and measure back.
- **Never fabricate pitches.** When lyrics have more syllables than hummed notes,
  CYCLE the real hummed melody; never repeat a flat last-pitch tail (a code review
  caught the flat-tail version as violating "exact hummed pitches").
- **Persist the ACTUAL produced mode, not the requested one.** On fallback the
  pipeline must overwrite the project's `renderMode` to `structural`, or the UI
  badge mislabels a fallback track as note-for-note (also caught in review).
- No public UI toggle yet — only a "Note-for-Note" badge keyed off the persisted
  (actual) `renderMode`.

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

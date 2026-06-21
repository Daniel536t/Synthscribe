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

There is now a SECOND render mode selectable via `renderMode`
(`structural` default | `note_for_note`) — column on `projects`, `RenderMode` enum
in `openapi.yaml`, validated by a `RENDER_MODES` set in `routes/projects.ts`. When
`note_for_note` AND lyrics AND notes>0, `pipeline.ts` renders a lead vocal that
sings the user's words on the EXACT hummed pitches/timing, mixed over the
ElevenLabs backing. ANY failure logs + falls back to Option 1 (`generateSong`).
- This is NOT the rejected synth resynth lead: the voice is real (ElevenLabs
  TTS-with-timestamps), only pitch/time-CONFORMED to the hum, not synthesized.
- Rendering is a **LOCAL librosa worker** `retune.py` (per-segment pyin → pitch_shift
  to target MIDI → time_stretch to note dur → place at note start), NOT Modal/GPU —
  pitch/time conform needs no GPU and local avoids Modal deploy fragility +
  silent-fallback masking. Verify exactness on the ISOLATED worker (synthetic tone →
  targets, measure back with pyin), NOT the final mix — backing bass dominates
  full-mix pitch detection and hides the lead.
- `buildSegments` (`singing.ts`): 1 syllable→1 hummed note in order; if syllables >
  notes the melody CYCLES (reuses real hummed pitches/durations) — never fabricate a
  flat last-pitch tail; if syllables < notes, trailing notes go unsung.
- No public UI toggle yet — only a "Note-for-Note" badge on Project/Library when set.

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

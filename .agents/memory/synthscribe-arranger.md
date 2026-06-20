---
name: SynthScribe arranger engine
description: How the default CPU "studio band" backing works and its determinism constraint
---

# SynthScribe arranger ("Studio Band") engine

The default backing engine is a procedural numpy arranger (`arrange.py`, spawned
via `arranger.ts`) that builds drums + bass + chords around the transcribed
melody lead, locked to the detected key/tempo and styled per vibe. ElevenLabs is
the optional premium engine; legacy `gpu` (Modal) is kept dormant for old rows
only and is not in the UI.

**Why procedural (not fluidsynth/soundfont):** avoids a fragile heavy system
dependency and large asset downloads; pure CPU always succeeds. Same reliability
reasoning as the earlier Basic-Pitch→pyin choice.

**Determinism constraint:** the arranger must render byte-identical output for the
same spec. The only randomness is drum noise synthesis — it must draw from a
seeded `np.random.default_rng(seed)`, where `seed = zlib.crc32(...)` over a stable
string of inputs. Do NOT use Python's built-in `hash()` of strings for the seed:
it is salted per process (PYTHONHASHSEED) and breaks cross-run determinism.

**How to apply:** when adding any randomness to the arranger, thread the seeded
`rng` through rather than calling `np.random.*` globally, or determinism regresses.

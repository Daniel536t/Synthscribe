---
name: SynthScribe melody faithfulness
description: Why the song must reproduce the hummed notes via explicit transcription, not AI conditioning.
---

# Making SynthScribe actually reproduce the hummed melody

Neither AI path reproduces the user's tune: MusicGen-melody conditions on a loose
*chroma* contour and improvises away from it (with `do_sample=True` it drifts hard),
and the ElevenLabs Music path ignores the hum entirely (text-prompt only). So a song
built only from those will never contain the user's actual notes — users notice
immediately ("it's not even my melody").

**The fix that works:** explicit transcription + resynthesis as a faithful lead.
- `transcribe.py` uses `librosa.pyin` to get f0 → semitone-quantized notes, snapped
  into the detected key, lightly timing-quantized to a 16th grid, min-duration filtered,
  leading silence trimmed. Output: `notes = [[startSec, durSec, midi], ...]`.
- `render_melody.py` synthesizes those notes (additive tone + ADSR + light vibrato) and
  loops the phrase to fill the song (the hum is ~1/3 the song length).
- The pipeline mixes this lead prominently (gain ~0.95) OVER the AI backing, dropping
  the bed to ~0.5 when a lead exists.

**Why:** this is the only reliable way to guarantee the user hears THEIR tune; AI
melody conditioning is mood-faithful, not note-faithful.

**Constraint:** the lead is quantized but the AI bed's tempo cannot be forced, so tight
beat-lock between lead and bed is not guaranteed — prefer melody faithfulness over
bed rhythmic sync. All stages degrade gracefully (no notes → bed at full gain).

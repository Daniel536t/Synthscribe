import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger";
import { withTempDir, toWav } from "./audio";
import {
  synthesizeSpeechWithTimestamps,
  type SpeechAlignment,
} from "./elevenlabs";
import { countWordSyllables } from "./lyrics";
import type { Note } from "./transcribe";

// Option 2 "note-for-note" lead vocal. We speak the lyrics with ElevenLabs (so we
// get clean diction plus per-character timing), slice the spoken take at
// word/syllable boundaries, and conform each slice onto a hummed note (exact
// pitch + duration + position) via a local librosa worker. The lead vocal then
// follows the user's actual melody — the same tune they hummed, with the words.

/** One spoken slice mapped onto one hummed note. */
export interface RetuneSegment {
  /** Start of the spoken slice in the TTS take (seconds). */
  srcStart: number;
  /** End of the spoken slice in the TTS take (seconds). */
  srcEnd: number;
  /** MIDI pitch of the hummed note this slice should be sung on. */
  targetMidi: number;
  /** Where the note sits in the finished vocal (seconds). */
  outStart: number;
  /** How long the note should last (seconds). */
  outDur: number;
}

interface WordSpan {
  start: number;
  end: number;
  syllables: number;
}

function workspaceRoot(): string {
  return process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
}

const PYTHON_TIMEOUT_MS = 180_000;

function runRetune(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`retune.py timed out after ${PYTHON_TIMEOUT_MS}ms`));
    }, PYTHON_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`retune.py exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/** Derive per-word time spans (and syllable counts) from char-level TTS timing. */
function wordSpans(a: SpeechAlignment): WordSpan[] {
  const isWs = (c: string) => /\s/.test(c);
  const spans: WordSpan[] = [];
  let i = 0;
  while (i < a.chars.length) {
    if (isWs(a.chars[i])) {
      i++;
      continue;
    }
    let j = i;
    let text = "";
    while (j < a.chars.length && !isWs(a.chars[j])) {
      text += a.chars[j];
      j++;
    }
    const start = a.starts[i];
    const end = a.ends[j - 1] ?? a.starts[j - 1] ?? start;
    const syllables = Math.max(1, countWordSyllables(text));
    if (Number.isFinite(start) && end > start) {
      spans.push({ start, end, syllables });
    }
    i = j;
  }
  return spans;
}

/**
 * Map spoken words onto hummed notes. Each word's spoken span is split evenly by
 * its syllable count, and each syllable claims the next hummed note (exact pitch
 * + duration). Every sung note is therefore an ACTUAL hummed note — we never
 * invent pitches.
 *
 * - syllables <= notes: one syllable per note, in order; any trailing hummed
 *   notes simply go unsung (the lyrics are fully covered).
 * - syllables  > notes: the hummed melody CYCLES — overflow syllables reuse the
 *   real hummed pitches/durations from the top, laid out sequentially after the
 *   melody. This keeps "exact hummed pitches" (no fabricated flat tail) while
 *   still singing every word.
 */
export function buildSegments(words: WordSpan[], notes: Note[]): RetuneSegment[] {
  const sorted = [...notes].sort((x, y) => x[0] - y[0]);
  const n = sorted.length;
  if (n === 0 || words.length === 0) return [];

  const lastNote = sorted[n - 1];
  // Where looped notes begin (end of the hummed melody on the timeline).
  let cursor = lastNote[0] + lastNote[1];

  const segments: RetuneSegment[] = [];
  let si = 0; // global syllable index across all words
  for (const w of words) {
    const nSyll = w.syllables;
    const span = Math.max(0.04, w.end - w.start);
    for (let k = 0; k < nSyll; k++) {
      const note = sorted[si % n];
      const targetMidi = note[2];
      const outDur = note[1];
      let outStart: number;
      if (si < n) {
        // First pass: use the note's real hummed position.
        outStart = note[0];
        cursor = Math.max(cursor, note[0] + note[1]);
      } else {
        // Overflow: cycle the melody, placing notes back-to-back.
        outStart = cursor;
        cursor += outDur;
      }
      segments.push({
        srcStart: w.start + (span * k) / nSyll,
        srcEnd: w.start + (span * (k + 1)) / nSyll,
        targetMidi,
        outStart,
        outDur,
      });
      si++;
    }
  }
  segments.sort((p, q) => p.outStart - q.outStart);
  return segments;
}

/**
 * Render a note-for-note lead vocal: ElevenLabs speaks the lyrics, then a local
 * librosa worker conforms each word/syllable onto the hummed notes. Returns a
 * mono 44.1kHz WAV of the lead vocal. Throws so the caller can fall back to
 * Option 1 if anything is unavailable.
 */
export async function renderNoteForNoteVocal(opts: {
  lyrics: string;
  notes: Note[];
}): Promise<Buffer> {
  const text = opts.lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("No lyrics to sing");
  if (opts.notes.length === 0) throw new Error("No hummed notes to sing");

  const speech = await synthesizeSpeechWithTimestamps(text);
  const ttsWav = await toWav(speech.wav);
  const words = wordSpans(speech);
  if (words.length === 0) throw new Error("TTS alignment produced no words");

  const segments = buildSegments(words, opts.notes);
  if (segments.length === 0) throw new Error("No singable segments");

  const script = path.resolve(
    workspaceRoot(),
    "artifacts/api-server/src/lib/retune.py",
  );
  return withTempDir(async (dir) => {
    const ttsPath = path.join(dir, "tts.wav");
    const segPath = path.join(dir, "segments.json");
    const outPath = path.join(dir, "lead.wav");
    await fs.writeFile(ttsPath, ttsWav);
    await fs.writeFile(
      segPath,
      JSON.stringify({ sampleRate: 44100, segments }),
    );
    const out = await runRetune(script, [ttsPath, segPath, outPath]);
    let parsed: { ok?: boolean; error?: string; segments?: number } = {};
    try {
      parsed = JSON.parse(out.trim().split(/\r?\n/).pop() || "{}");
    } catch {
      // ignore — presence of the output file is the real success signal
    }
    if (parsed.error) throw new Error(`retune failed: ${parsed.error}`);
    logger.info(
      { segments: parsed.segments ?? segments.length },
      "Note-for-note lead vocal rendered",
    );
    return fs.readFile(outPath);
  });
}

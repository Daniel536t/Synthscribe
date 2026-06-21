import { logger } from "./logger";
import { chatComplete, nvidiaConfigured } from "./nvidia";
import type { Note } from "./transcribe";

// One hummed note carries (roughly) one sung syllable. We turn the transcribed
// melody into a per-line "syllable skeleton" — how many syllables each line
// wants and which positions are stressed — then ask the NVIDIA model to fill
// that skeleton with words and verify/repair the syllable counts so the lyrics
// actually fit the tune.

export interface LineTarget {
  /** Target number of syllables for this line (= notes in the phrase). */
  syllables: number;
  /** 1-indexed syllable positions that fall on long/high notes. */
  stresses: number[];
  /** Overall melodic shape of the phrase. */
  contour: "rising" | "falling" | "steady";
}

export interface Scaffold {
  lines: LineTarget[];
  mood: string;
}

export interface DraftResult {
  lyrics: string;
  lineCount: number;
}

// A gap larger than this (seconds) between consecutive notes marks a breath /
// phrase boundary — i.e. a new sung line.
const PHRASE_GAP_SECONDS = 0.32;
const MIN_LINES = 2;
const MAX_LINES = 12;
const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 14;
// Lines within this many syllables of their target are considered a good fit.
const SYLLABLE_TOLERANCE = 1;
const MAX_REPAIR_PASSES = 2;

function moodFromMusic(
  key: string | null,
  tempo: number | null,
  vibe: string,
): string {
  const parts: string[] = [];
  if (key) {
    const minor = /min/i.test(key);
    parts.push(
      minor
        ? "an emotional, introspective, slightly melancholic feel"
        : "a bright, warm, uplifting feel",
    );
  }
  if (tempo) {
    if (tempo < 80) parts.push("a slow, tender pace");
    else if (tempo > 125) parts.push("an energetic, driving pace");
    else parts.push("a steady, mid-tempo groove");
  }
  parts.push(`a ${vibe} musical style`);
  return parts.join(", ");
}

/**
 * Convert a transcribed melody into a per-line syllable skeleton. When no notes
 * were detected we fall back to a generic singable structure so drafting still
 * works.
 */
export function buildScaffold(
  notes: Note[],
  key: string | null,
  tempo: number | null,
  vibe: string,
): Scaffold {
  const mood = moodFromMusic(key, tempo, vibe);
  const sorted = [...notes].sort((a, b) => a[0] - b[0]);

  // Group notes into phrases separated by silence gaps.
  const phrases: Note[][] = [];
  let current: Note[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const note = sorted[i];
    if (current.length === 0) {
      current.push(note);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = note[0] - (prev[0] + prev[1]);
    if (gap > PHRASE_GAP_SECONDS) {
      phrases.push(current);
      current = [note];
    } else {
      current.push(note);
    }
  }
  if (current.length) phrases.push(current);

  // Merge adjacent phrases until we are within the line cap so long hums still
  // produce a singable number of lines.
  while (phrases.length > MAX_LINES) {
    let minIdx = 0;
    let minLen = Infinity;
    for (let i = 0; i < phrases.length - 1; i++) {
      const combined = phrases[i].length + phrases[i + 1].length;
      if (combined < minLen) {
        minLen = combined;
        minIdx = i;
      }
    }
    phrases[minIdx] = [...phrases[minIdx], ...phrases[minIdx + 1]];
    phrases.splice(minIdx + 1, 1);
  }

  const lines: LineTarget[] = phrases.map((phrase) => {
    const syllables = Math.max(
      MIN_SYLLABLES,
      Math.min(MAX_SYLLABLES, phrase.length),
    );
    const meanDur =
      phrase.reduce((s, n) => s + n[1], 0) / Math.max(1, phrase.length);
    const maxPitch = Math.max(...phrase.map((n) => n[2]));
    const stresses: number[] = [];
    phrase.forEach((n, idx) => {
      if (idx >= syllables) return;
      const isLong = n[1] >= meanDur * 1.3;
      const isHigh = n[2] >= maxPitch;
      if (isLong || isHigh) stresses.push(idx + 1);
    });
    const firstPitch = phrase[0][2];
    const lastPitch = phrase[phrase.length - 1][2];
    const contour: LineTarget["contour"] =
      lastPitch - firstPitch >= 2
        ? "rising"
        : firstPitch - lastPitch >= 2
          ? "falling"
          : "steady";
    return { syllables, stresses, contour };
  });

  // No usable melody — give a gentle default structure.
  if (lines.length < MIN_LINES) {
    const fallback: LineTarget[] = Array.from({ length: 4 }, () => ({
      syllables: 7,
      stresses: [2, 5],
      contour: "steady" as const,
    }));
    return { lines: fallback, mood };
  }

  return { lines, mood };
}

/** Estimate the syllables in a single English word using vowel-group heuristics. */
function countWordSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // Drop common silent endings before counting vowel groups.
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Count syllables in a single lyric line. */
export function countLineSyllables(line: string): number {
  const words = line.replace(/[^a-zA-Z' ]+/g, " ").trim().split(/\s+/);
  let total = 0;
  for (const word of words) {
    if (word) total += countWordSyllables(word);
  }
  return total;
}

function describeLine(target: LineTarget, idx: number): string {
  const stress = target.stresses.length
    ? `, emphasis on syllable${target.stresses.length > 1 ? "s" : ""} ${target.stresses.join(", ")}`
    : "";
  return `Line ${idx + 1}: exactly ${target.syllables} syllables${stress} (${target.contour} melodic line)`;
}

function parseLines(raw: string, expected: number): string[] {
  const cleaned = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    // Drop section headers ([Verse], (Chorus)) and list/numbering prefixes.
    .filter((l) => l.length > 0 && !/^[[(].*[\])]$/.test(l))
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 0);
  // Prefer the first `expected` lyric lines.
  return cleaned.slice(0, expected);
}

async function repairLines(
  lines: string[],
  scaffold: Scaffold,
  theme: string,
): Promise<string[]> {
  let working = [...lines];
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const offenders: number[] = [];
    working.forEach((line, idx) => {
      const target = scaffold.lines[idx];
      if (!target) return;
      const got = countLineSyllables(line);
      if (Math.abs(got - target.syllables) > SYLLABLE_TOLERANCE) {
        offenders.push(idx);
      }
    });
    if (offenders.length === 0) break;

    const fixList = offenders
      .map((idx) => {
        const target = scaffold.lines[idx];
        const got = countLineSyllables(working[idx]);
        return `Line ${idx + 1} (currently ${got} syllables, needs exactly ${target.syllables}): "${working[idx]}"`;
      })
      .join("\n");

    try {
      const content = await chatComplete(
        [
          {
            role: "system",
            content:
              "You are a precise lyric editor. Rewrite only the requested lines so each has the EXACT requested syllable count, keeping the same meaning, rhyme, and theme. Reply with one rewritten line per requested line, in the same order, and nothing else.",
          },
          {
            role: "user",
            content: `Theme: ${theme}\n\nRewrite these lines to their exact syllable counts:\n${fixList}`,
          },
        ],
        { temperature: 0.6, maxTokens: 400 },
      );
      const fixes = parseLines(content, offenders.length);
      offenders.forEach((idx, i) => {
        if (fixes[i]) working[idx] = fixes[i];
      });
    } catch (err) {
      logger.warn({ err }, "Syllable repair pass failed; keeping current lines");
      break;
    }
  }
  return working;
}

/**
 * Draft original lyrics that match the hum's melodic structure. Throws if the
 * NVIDIA model is unavailable so callers can fall back.
 */
export async function draftLyrics(opts: {
  notes: Note[];
  key: string | null;
  tempo: number | null;
  vibe: string;
  theme: string;
}): Promise<DraftResult> {
  if (!nvidiaConfigured()) {
    throw new Error("NVIDIA_API_KEY is not set");
  }
  const scaffold = buildScaffold(opts.notes, opts.key, opts.tempo, opts.vibe);
  const lineSpecs = scaffold.lines
    .map((t, i) => describeLine(t, i))
    .join("\n");

  const content = await chatComplete(
    [
      {
        role: "system",
        content:
          "You are a professional songwriter. Write original, singable song lyrics that fit a given melody EXACTLY. Each line must hit its requested syllable count and land stressed words on the marked positions. Output ONLY the lyric lines — exactly one line of lyrics per requested line, in order, with no titles, no section labels, no numbering, and no commentary.",
      },
      {
        role: "user",
        content:
          `Write lyrics about: ${opts.theme}\n\n` +
          `Musical mood: ${scaffold.mood}.\n\n` +
          `Produce exactly ${scaffold.lines.length} lines that match this melody:\n${lineSpecs}\n\n` +
          `Make the lines flow as a coherent song and rhyme naturally where it fits.`,
      },
    ],
    { temperature: 0.85, maxTokens: 700 },
  );

  let lines = parseLines(content, scaffold.lines.length);
  if (lines.length === 0) {
    throw new Error("Model returned no usable lyric lines");
  }
  lines = await repairLines(lines, scaffold, opts.theme);

  return { lyrics: lines.join("\n"), lineCount: lines.length };
}

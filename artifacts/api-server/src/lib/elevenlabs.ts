import { logger } from "./logger";

const BASE = "https://api.elevenlabs.io";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

const VIBE_DESC: Record<string, string> = {
  lofi: "warm lo-fi hip-hop, dusty vinyl crackle, mellow Rhodes piano, soft boom-bap drums",
  cinematic: "epic cinematic score, lush strings, swelling brass, wide film-trailer atmosphere",
  pop: "bright modern pop production, catchy synths, punchy drums, radio-ready polish",
  rnb: "smooth contemporary R&B, silky electric piano, deep bass, laid-back groove",
  electronic: "polished electronic dance production, analog synths, driving beat, club energy",
  acoustic: "intimate acoustic arrangement, fingerpicked guitar, soft percussion, organic warmth",
  ambient: "spacious ambient soundscape, evolving pads, gentle textures, weightless and dreamy",
  serenity: "serene world-fusion in the spirit of A.R. Rahman, gentle tabla, sitar and bansuri flute, lush warm strings, ethereal wordless female vocal, peaceful and transcendent",
  soul: "vintage soul and Motown, warm horn section, electric piano, gospel-tinged chords, analog tape warmth, deep groove",
  jazz: "smooth late-night jazz, brushed drums, walking upright bass, expressive piano, soft tenor saxophone",
  folk: "intimate acoustic folk, fingerpicked and strummed guitar, warm strings, organic and heartfelt",
  afrobeat: "modern afrobeats groove, log drums, layered percussion, warm rolling bass, bright and sunny",
  synthwave: "retro 1980s synthwave, neon analog arpeggios, gated reverb drums, nostalgic cinematic drive",
};

function tempoWord(tempo: number | null): string {
  if (!tempo) return "a natural, flowing tempo";
  return `around ${Math.round(tempo)} BPM`;
}

async function postMusic(prompt: string, lengthMs: number): Promise<Buffer> {
  const res = await fetch(`${BASE}/v1/music`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt,
      // ElevenLabs Music supports 10s–5min per generation. We size the request
      // upstream (vibe/lyrics/length choice) and just enforce the hard bounds here.
      music_length_ms: Math.max(10000, Math.min(lengthMs, 300000)),
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ElevenLabs music ${res.status}: ${text.slice(0, 300)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/** Generate a fully produced instrumental backing track for the given vibe. */
export async function generateBacking(opts: {
  vibe: string;
  key: string | null;
  tempo: number | null;
  lengthMs: number;
}): Promise<Buffer> {
  const desc = VIBE_DESC[opts.vibe] ?? VIBE_DESC.pop;
  const keyPart = opts.key ? `in the key of ${opts.key}, ` : "";
  const prompt =
    `An instrumental backing track: ${desc}. ${keyPart}${tempoWord(opts.tempo)}. ` +
    `Leave melodic space for a lead vocal on top. No spoken word, no lyrics, fully instrumental, ` +
    `clean studio mix, seamless and emotive.`;
  logger.info({ vibe: opts.vibe }, "Requesting ElevenLabs backing track");
  return postMusic(prompt, opts.lengthMs);
}

/** Generate a full sung song: lead vocals singing the user's lyrics over a vibe-matched backing. */
export async function generateSong(opts: {
  vibe: string;
  key: string | null;
  tempo: number | null;
  lyrics: string;
  lengthMs: number;
}): Promise<Buffer> {
  const desc = VIBE_DESC[opts.vibe] ?? VIBE_DESC.pop;
  const keyPart = opts.key ? `in the key of ${opts.key}, ` : "";
  const prompt =
    `A complete song with clear, expressive lead vocals singing words. ` +
    `Musical style: ${desc}. ${keyPart}${tempoWord(opts.tempo)}. ` +
    `The lead vocalist sings these exact lyrics, front and center in the mix, with clear diction and emotion:\n\n` +
    `${opts.lyrics}\n\n` +
    `Studio-quality production, the vocal carrying the melody over the instrumental.`;
  logger.info({ vibe: opts.vibe }, "Requesting ElevenLabs sung song");
  return postMusic(prompt, opts.lengthMs);
}

/** Generate a wordless vocal melody (vocalise) layer to sit on top of the song. */
export async function generateVocals(opts: {
  vibe: string;
  key: string | null;
  tempo: number | null;
  lengthMs: number;
}): Promise<Buffer> {
  const keyPart = opts.key ? `in ${opts.key}, ` : "";
  const prompt =
    `A solo wordless vocal melody (vocalise) — expressive "ooh" and "ah" singing with no words, ` +
    `${keyPart}${tempoWord(opts.tempo)}, ${opts.vibe} mood. Just the lead voice, minimal backing, ` +
    `emotional and human.`;
  logger.info({ vibe: opts.vibe }, "Requesting ElevenLabs vocal layer");
  return postMusic(prompt, opts.lengthMs);
}

import { logger } from "./logger";

/**
 * Optional Modal MusicGen worker. When MODAL_BACKING_URL is configured, the
 * pipeline conditions a backing track on the user's actual hum melody (A10G GPU).
 * If the URL is unset or the request fails, the caller falls back to ElevenLabs.
 */
export function modalConfigured(): boolean {
  return Boolean(process.env.MODAL_BACKING_URL);
}

export async function generateBackingFromHum(opts: {
  hum: Buffer;
  vibe: string;
  durationSeconds: number;
}): Promise<Buffer> {
  const url = process.env.MODAL_BACKING_URL;
  if (!url) throw new Error("MODAL_BACKING_URL is not set");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.hum)], { type: "audio/wav" }), "hum.wav");
  form.append("vibe", opts.vibe);
  form.append("duration", String(Math.round(opts.durationSeconds)));

  logger.info({ vibe: opts.vibe }, "Requesting Modal MusicGen backing track");
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers: process.env.MODAL_BACKING_TOKEN
      ? { Authorization: `Bearer ${process.env.MODAL_BACKING_TOKEN}` }
      : undefined,
    signal: AbortSignal.timeout(250_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal worker ${res.status}: ${text.slice(0, 300)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

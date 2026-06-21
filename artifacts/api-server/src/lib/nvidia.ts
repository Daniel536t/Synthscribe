import { logger } from "./logger";

// SynthScribe drafts lyrics with the user's own NVIDIA-hosted model through the
// OpenAI-compatible endpoint at integrate.api.nvidia.com. The model name is
// swappable via NVIDIA_MODEL so we can move between hosted models without code
// changes.
const BASE = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.NVIDIA_MODEL || "mistralai/mistral-medium-3.5-128b";

const TIMEOUT_MS = 60_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function apiKey(): string {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set");
  return key;
}

/** Returns true when the NVIDIA model is configured and usable. */
export function nvidiaConfigured(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY);
}

/**
 * Call the NVIDIA OpenAI-compatible chat completions endpoint and return the
 * assistant's message text. Throws on transport or API errors so callers can
 * fall back gracefully.
 */
export async function chatComplete(
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts?.temperature ?? 0.8,
      max_tokens: opts?.maxTokens ?? 900,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NVIDIA chat ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    logger.warn({ model: MODEL }, "NVIDIA returned empty content");
    throw new Error("NVIDIA returned an empty response");
  }
  return content;
}

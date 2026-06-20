import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";
import type { Note } from "./transcribe";

function workspaceRoot(): string {
  return process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
}

const RENDER_TIMEOUT_MS = 60_000;

function runRenderer(specPath: string, outPath: string): Promise<void> {
  const script = path.resolve(
    workspaceRoot(),
    "artifacts/api-server/src/lib/render_melody.py",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script, specPath, outPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`render_melody timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);
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
      if (code === 0) resolve();
      else reject(new Error(`render_melody exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Render the transcribed hum melody into a clean lead-instrument WAV that lasts
 * roughly `targetDurationSeconds` (the phrase is looped to fill the song). This
 * is what guarantees the user actually hears THEIR tune in the final mix.
 *
 * Returns null when there are no usable notes so the caller can skip the lead.
 */
export async function renderMelodyLead(opts: {
  notes: Note[];
  targetDurationSeconds: number;
}): Promise<Buffer | null> {
  if (!opts.notes || opts.notes.length === 0) return null;
  const tmpSpec = path.join(os.tmpdir(), `melody-${randomUUID()}.json`);
  const tmpOut = path.join(os.tmpdir(), `lead-${randomUUID()}.wav`);
  try {
    await fs.writeFile(
      tmpSpec,
      JSON.stringify({
        notes: opts.notes,
        targetDuration: opts.targetDurationSeconds,
        sampleRate: 44100,
      }),
    );
    await runRenderer(tmpSpec, tmpOut);
    const buf = await fs.readFile(tmpOut);
    if (buf.length === 0) return null;
    return buf;
  } catch (err) {
    logger.warn({ err }, "Melody lead render failed, continuing without lead");
    return null;
  } finally {
    await fs.rm(tmpSpec, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
}

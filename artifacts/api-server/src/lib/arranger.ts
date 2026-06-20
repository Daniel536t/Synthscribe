import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

function workspaceRoot(): string {
  return process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
}

const ARRANGE_TIMEOUT_MS = 60_000;

function runArranger(specPath: string, outPath: string): Promise<void> {
  const script = path.resolve(
    workspaceRoot(),
    "artifacts/api-server/src/lib/arrange.py",
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
      reject(new Error(`arrange timed out after ${ARRANGE_TIMEOUT_MS}ms`));
    }, ARRANGE_TIMEOUT_MS);
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
      else reject(new Error(`arrange exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Build a deterministic, GPU-free "studio band" backing track: drums + bass +
 * chords/keys, locked to the detected key and tempo and styled by the chosen
 * vibe. The user's faithfully-transcribed melody lead is mixed on top by the
 * pipeline, so this bed is the supporting accompaniment around their tune.
 *
 * Pure procedural synthesis (numpy) — no soundfonts, samples, or GPU — so it
 * always succeeds. Returns a WAV Buffer.
 */
export async function arrangeBacking(opts: {
  vibe: string;
  key: string | null;
  tempo: number | null;
  durationSeconds: number;
}): Promise<Buffer> {
  const tmpSpec = path.join(os.tmpdir(), `arrange-${randomUUID()}.json`);
  const tmpOut = path.join(os.tmpdir(), `backing-${randomUUID()}.wav`);
  try {
    await fs.writeFile(
      tmpSpec,
      JSON.stringify({
        vibe: opts.vibe,
        key: opts.key,
        tempo: opts.tempo,
        targetDuration: opts.durationSeconds,
        sampleRate: 44100,
      }),
    );
    logger.info({ vibe: opts.vibe }, "Arranging studio backing track");
    await runArranger(tmpSpec, tmpOut);
    const buf = await fs.readFile(tmpOut);
    if (buf.length === 0) throw new Error("arrange produced empty output");
    return buf;
  } finally {
    await fs.rm(tmpSpec, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
}

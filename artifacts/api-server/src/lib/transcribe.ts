import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

export interface Transcription {
  key: string | null;
  tempo: number | null;
  durationSeconds: number | null;
}

function workspaceRoot(): string {
  return process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
}

const PYTHON_TIMEOUT_MS = 60_000;

function runPython(scriptPath: string, wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, wavPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`python3 timed out after ${PYTHON_TIMEOUT_MS}ms`));
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
      else reject(new Error(`python3 exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Estimate musical key, tempo and duration of a hum WAV using librosa.
 * Returns nulls gracefully if Python/librosa is unavailable so the pipeline
 * can continue with sensible defaults.
 */
export async function transcribeHum(wav: Buffer): Promise<Transcription> {
  const script = path.resolve(workspaceRoot(), "artifacts/api-server/src/lib/transcribe.py");
  const tmp = path.join(os.tmpdir(), `hum-${randomUUID()}.wav`);
  try {
    await fs.writeFile(tmp, wav);
    const out = await runPython(script, tmp);
    const parsed = JSON.parse(out.trim());
    if (parsed.error) throw new Error(parsed.error);
    return {
      key: typeof parsed.key === "string" ? parsed.key : null,
      tempo: typeof parsed.tempo === "number" && parsed.tempo > 0 ? parsed.tempo : null,
      durationSeconds:
        typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : null,
    };
  } catch (err) {
    logger.warn({ err }, "Transcription unavailable, using defaults");
    return { key: null, tempo: null, durationSeconds: null };
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const SAMPLE_RATE = 44100;

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synthscribe-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const PROCESS_TIMEOUT_MS = 120_000;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${PROCESS_TIMEOUT_MS}ms`));
    }, PROCESS_TIMEOUT_MS);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
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
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${PROCESS_TIMEOUT_MS}ms`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
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
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Normalize an arbitrary recording into a clean 44.1kHz stereo WAV.
 * Applies a high-pass to remove rumble and a gentle dynamic normalization.
 */
export async function normalizeHum(input: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = path.join(dir, "in");
    const outPath = path.join(dir, "out.wav");
    await fs.writeFile(inPath, input);
    await run("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ac",
      "2",
      "-ar",
      String(SAMPLE_RATE),
      "-af",
      "highpass=f=70,afftdn=nr=12,dynaudnorm=f=200:g=5",
      "-c:a",
      "pcm_s16le",
      outPath,
    ]);
    return fs.readFile(outPath);
  });
}

/** Re-encode any audio buffer to a standard 44.1kHz stereo WAV. */
export async function toWav(input: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = path.join(dir, "in");
    const outPath = path.join(dir, "out.wav");
    await fs.writeFile(inPath, input);
    await run("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ac",
      "2",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      outPath,
    ]);
    return fs.readFile(outPath);
  });
}

export async function getDurationSeconds(input: Buffer): Promise<number> {
  return withTempDir(async (dir) => {
    const inPath = path.join(dir, "in.wav");
    await fs.writeFile(inPath, input);
    const out = await runCapture("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inPath,
    ]);
    const n = parseFloat(out.trim());
    return Number.isFinite(n) ? n : 0;
  });
}

export interface MixInput {
  buffer: Buffer;
  /** linear gain multiplier */
  gain: number;
  /** add a touch of reverb (used for the hum lead) */
  reverb?: boolean;
  /** fade the stem in over this many seconds to avoid an abrupt onset */
  fadeInSeconds?: number;
}

/**
 * Mix one or more stems together and master to -14 LUFS at 44.1kHz.
 * The longest stem defines the output length; shorter stems are padded.
 */
export async function mixAndMaster(inputs: MixInput[]): Promise<Buffer> {
  if (inputs.length === 0) throw new Error("mixAndMaster: no inputs");
  return withTempDir(async (dir) => {
    const args: string[] = ["-y"];
    inputs.forEach((inp, i) => {
      const p = path.join(dir, `in${i}.wav`);
      args.push("-i", p);
    });
    await Promise.all(
      inputs.map((inp, i) => fs.writeFile(path.join(dir, `in${i}.wav`), inp.buffer)),
    );

    const filters: string[] = [];
    const labels: string[] = [];
    inputs.forEach((inp, i) => {
      let chain = `[${i}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo`;
      if (inp.fadeInSeconds && inp.fadeInSeconds > 0) {
        chain += `,afade=t=in:st=0:d=${inp.fadeInSeconds}`;
      }
      chain += `,volume=${inp.gain}`;
      if (inp.reverb) {
        chain += ",aecho=0.8:0.85:60:0.25";
      }
      const label = `s${i}`;
      filters.push(`${chain}[${label}]`);
      labels.push(`[${label}]`);
    });
    const mixLabel = "mix";
    filters.push(
      `${labels.join("")}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0[${mixLabel}]`,
    );
    filters.push(
      `[${mixLabel}]loudnorm=I=-14:TP=-1.5:LRA=11[out]`,
    );

    const outPath = path.join(dir, "out.wav");
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      outPath,
    );
    await run("ffmpeg", args);
    return fs.readFile(outPath);
  });
}

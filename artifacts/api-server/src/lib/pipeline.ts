import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { logger } from "./logger";
import { uploadBuffer, downloadToBuffer } from "./storage";
import {
  normalizeHum,
  toWav,
  mixAndMaster,
  getDurationSeconds,
  type MixInput,
} from "./audio";
import { transcribeHum } from "./transcribe";
import { renderMelodyLead } from "./melody";
import { generateBacking, generateVocals } from "./elevenlabs";
import { modalConfigured, generateBackingFromMelody } from "./musicgen";
import { arrangeBacking } from "./arranger";

type Stage =
  | "draft"
  | "transcribing"
  | "generating_backing"
  | "singing"
  | "mixing"
  | "complete"
  | "error";

interface PatchFields {
  stage?: Stage;
  progress?: number;
  message?: string | null;
  key?: string | null;
  tempo?: number | null;
  durationSeconds?: number | null;
  error?: string | null;
  humPath?: string | null;
  backingPath?: string | null;
  vocalsPath?: string | null;
  finalPath?: string | null;
}

async function patch(projectId: string, fields: PatchFields): Promise<void> {
  await db.update(projectsTable).set(fields).where(eq(projectsTable.id, projectId));
}

const DEFAULT_DURATION = 24; // seconds for generated stems

// The wordless ElevenLabs vocal layer is a second paid Music call. It is off by
// default to roughly halve per-request credit cost; set SYNTHSCRIBE_ENABLE_VOCALS=1
// (or "true") to re-enable it.
function vocalsEnabled(): boolean {
  const v = (process.env.SYNTHSCRIBE_ENABLE_VOCALS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function runPipeline(projectId: string): Promise<void> {
  const log = logger.child({ projectId });
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (!project) throw new Error("Project not found");
    if (!project.humPath) throw new Error("No hum uploaded");

    // 1. Transcribe -------------------------------------------------------
    await patch(projectId, {
      stage: "transcribing",
      progress: 15,
      message: "Listening to your melody",
      error: null,
    });
    const humRaw = await downloadToBuffer(project.humPath);
    const hum = await normalizeHum(humRaw);
    const humNormPath = await uploadBuffer(
      `synthscribe/${projectId}/hum.wav`,
      hum,
      "audio/wav",
    );
    const transcription = await transcribeHum(hum);
    const key = transcription.key ?? "C major";
    const tempo = transcription.tempo ?? 90;
    const humDuration = transcription.durationSeconds ?? (await getDurationSeconds(hum));
    const targetDuration = Math.max(24, Math.min(Math.round(humDuration * 3) || DEFAULT_DURATION, 30));
    log.info(
      { key, tempo, noteCount: transcription.notes.length },
      "Hum transcribed",
    );
    await patch(projectId, {
      humPath: humNormPath,
      key,
      tempo,
      progress: 30,
      message: `Detected ${key} at ${Math.round(tempo)} BPM`,
    });

    // 2. Faithful melody lead --------------------------------------------
    // Synthesize the transcribed notes into a CLEAN lead-instrument WAV. This
    // is the user's actual tune, octave-corrected and de-noised. It serves two
    // purposes: (a) it conditions the GPU backing below so the bed follows the
    // real melody, and (b) it is the prominent melodic line in the final mix.
    // The raw hum is intentionally NEVER used as audio in either place.
    let lead: Buffer | null = null;
    if (transcription.notes.length > 0) {
      lead = await renderMelodyLead({
        notes: transcription.notes,
        targetDurationSeconds: targetDuration,
      });
      if (lead) {
        await uploadBuffer(`synthscribe/${projectId}/lead.wav`, lead, "audio/wav");
        log.info({ noteCount: transcription.notes.length }, "Rendered melody lead");
      } else {
        log.warn("Lead render returned empty despite transcribed notes");
      }
    } else {
      log.warn("No transcribed notes; backing will be vibe-only (no melody lead)");
    }

    // 3. Backing track ----------------------------------------------------
    // The user picks the backing engine per generation:
    //   - "arranger" (default): a deterministic, GPU-free studio band (drums +
    //     bass + chords) rendered on CPU, locked to the detected key/tempo and
    //     styled by the vibe. Always available, no credits, no GPU.
    //   - "elevenlabs": the premium ElevenLabs Music model.
    // The legacy "gpu" (Modal MusicGen-melody) path is kept dormant for old rows
    // only: it runs solely when explicitly selected AND configured AND we have a
    // lead to condition on; it is no longer offered in the UI.
    const useGpu = project.engine === "gpu" && modalConfigured() && lead !== null;
    const useArranger = project.engine !== "elevenlabs" && !useGpu;
    await patch(projectId, {
      stage: "generating_backing",
      progress: 50,
      message: useArranger
        ? "Building your studio band"
        : useGpu
          ? "Composing music around your melody"
          : "Producing your backing track",
    });
    const elevenlabsBacking = async (): Promise<Buffer> => {
      const raw = await generateBacking({
        vibe: project.vibe,
        key,
        tempo,
        lengthMs: targetDuration * 1000,
      });
      return toWav(raw);
    };
    let backing: Buffer;
    if (useGpu && lead) {
      try {
        const raw = await generateBackingFromMelody({
          melody: lead,
          vibe: project.vibe,
          durationSeconds: targetDuration,
        });
        backing = await toWav(raw);
      } catch (err) {
        log.warn({ err }, "Modal backing failed, falling back to ElevenLabs");
        backing = await elevenlabsBacking();
      }
    } else if (useArranger) {
      try {
        backing = await arrangeBacking({
          vibe: project.vibe,
          key,
          tempo,
          durationSeconds: targetDuration,
        });
      } catch (err) {
        log.warn({ err }, "Arranger failed, falling back to ElevenLabs");
        backing = await elevenlabsBacking();
      }
    } else {
      backing = await elevenlabsBacking();
    }
    const backingPath = await uploadBuffer(
      `synthscribe/${projectId}/backing.wav`,
      backing,
      "audio/wav",
    );
    await patch(projectId, { backingPath, progress: 65 });

    // 3. Vocals (optional, off by default) -------------------------------
    let vocals: Buffer | null = null;
    let vocalsPath: string | null = null;
    if (vocalsEnabled()) {
      await patch(projectId, {
        stage: "singing",
        progress: 72,
        message: "Adding a vocal layer",
      });
      try {
        const raw = await generateVocals({
          vibe: project.vibe,
          key,
          tempo,
          lengthMs: targetDuration * 1000,
        });
        vocals = await toWav(raw);
        vocalsPath = await uploadBuffer(
          `synthscribe/${projectId}/vocals.wav`,
          vocals,
          "audio/wav",
        );
        await patch(projectId, { vocalsPath, progress: 82 });
      } catch (err) {
        log.warn({ err }, "Vocal layer failed, continuing without it");
        await patch(projectId, { progress: 82 });
      }
    } else {
      await patch(projectId, { progress: 82 });
    }

    // 4. Mix & master -----------------------------------------------------
    await patch(projectId, {
      stage: "mixing",
      progress: 90,
      message: "Mixing and mastering",
    });
    // The clean melody lead is the star: it plays loud and on top so the user
    // clearly hears THEIR tune, with the AI backing as a supporting bed beneath.
    // The raw hum is never mixed in — when there is no usable melody we ship the
    // vibe-only backing rather than a noisy hum.
    const inputs: MixInput[] = [];
    if (lead) {
      inputs.push({ buffer: backing, gain: 0.4 });
      inputs.push({ buffer: lead, gain: 1.0, fadeInSeconds: 0.15 });
    } else {
      log.warn("No melody lead; shipping vibe-only backing (no raw hum)");
      inputs.push({ buffer: backing, gain: 1.0 });
    }
    if (vocals) inputs.push({ buffer: vocals, gain: 0.6 });
    const master = await mixAndMaster(inputs);
    const finalPath = await uploadBuffer(
      `synthscribe/${projectId}/final.wav`,
      master,
      "audio/wav",
    );
    const finalDuration = await getDurationSeconds(master);

    await patch(projectId, {
      stage: "complete",
      progress: 100,
      message: "Your song is ready",
      finalPath,
      durationSeconds: finalDuration,
      error: null,
    });
    log.info("Pipeline complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    logger.error({ err, projectId }, "Pipeline failed");
    await patch(projectId, {
      stage: "error",
      message: "Something went wrong while making your song",
      error: message,
    });
  }
}

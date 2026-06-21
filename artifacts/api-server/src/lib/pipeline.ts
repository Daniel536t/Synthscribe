import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { logger } from "./logger";
import { uploadBuffer, downloadToBuffer } from "./storage";
import {
  normalizeHum,
  toWav,
  getDurationSeconds,
  mixAndMaster,
} from "./audio";
import { transcribeHum } from "./transcribe";
import { generateBacking, generateSong } from "./elevenlabs";
import { renderNoteForNoteVocal } from "./singing";
import { draftLyrics } from "./lyrics";
import { nvidiaConfigured } from "./nvidia";

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
  renderMode?: string;
  lyrics?: string | null;
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

// Target song length (seconds) per user choice. ElevenLabs supports up to 5min.
const LENGTH_SECONDS: Record<string, number> = {
  short: 30,
  standard: 90,
  long: 180,
};

function computeTargetDuration({
  length,
  hasLyrics,
  wordCount,
}: {
  length: string;
  hasLyrics: boolean;
  wordCount: number;
}): number {
  const base = LENGTH_SECONDS[length] ?? LENGTH_SECONDS.standard;
  if (hasLyrics) {
    // Make sure there is room to sing every word (~2 words/sec) plus an intro,
    // but never shorter than the chosen length. Cap at the ElevenLabs max.
    const wordsNeed = Math.round(wordCount / 2) + 8;
    return Math.min(300, Math.max(base, wordsNeed));
  }
  // Instrumental: simply honour the chosen length.
  return Math.min(300, base);
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
    // We normalize the raw recording and detect its key/tempo. The hum is a
    // SEED ONLY: its key/tempo/mood steer the ElevenLabs prompt, and the cleaned
    // recording is kept as the "Original Hum" keepsake stem. It is not mixed into
    // the final track.
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
    let lyrics = project.lyrics?.trim() || "";
    // If the user supplied a theme but no lyrics, draft melody-matched lyrics
    // now from the transcribed notes. Failures fall back to an instrumental.
    if (!lyrics && project.theme?.trim() && nvidiaConfigured()) {
      try {
        await patch(projectId, {
          progress: 45,
          message: "Writing lyrics for your melody",
        });
        const drafted = await draftLyrics({
          notes: transcription.notes,
          key: transcription.key,
          tempo: transcription.tempo,
          vibe: project.vibe,
          theme: project.theme.trim(),
        });
        lyrics = drafted.lyrics.trim();
        await patch(projectId, { lyrics });
      } catch (err) {
        log.warn({ err }, "Auto lyric drafting failed; producing instrumental");
        await patch(projectId, {
          message:
            "Couldn't write lyrics for your melody — producing an instrumental instead",
        });
      }
    }
    const hasLyrics = lyrics.length > 0;
    // The user picks a target length (Short/Standard/Long); we honour it while
    // making sure a sung track still has room for every word (~2 words/sec) so
    // lyrics are never cut off. Everything is clamped to the ElevenLabs window.
    const targetDuration = computeTargetDuration({
      length: project.length,
      hasLyrics,
      wordCount: hasLyrics ? lyrics.split(/\s+/).filter(Boolean).length : 0,
    });
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

    // 2. Generate the song (ElevenLabs Music) -----------------------------
    // The hum is a seed only — it set the key/tempo above and is kept as the
    // "Original Hum" stem, but it is NOT layered into the final track. When the
    // user supplied lyrics we ask ElevenLabs for a full song that sings those
    // words; otherwise we fall back to a wordless instrumental in the vibe.
    let song: Buffer | null = null;
    // Track which render path actually produced the final track so the project
    // record (and its UI badge) never mislabels a fallback as note-for-note.
    let producedRenderMode = "structural";

    // Option 2 — note-for-note. When this project asked for it (and we have both
    // lyrics and a transcribed melody) we render a lead vocal that sings the
    // words on the EXACT hummed pitches/timing, then mix it over a key/tempo/vibe
    // backing. Any failure falls through to the Option 1 path below so the user
    // still gets a finished song.
    if (
      project.renderMode === "note_for_note" &&
      hasLyrics &&
      transcription.notes.length > 0
    ) {
      try {
        await patch(projectId, {
          stage: "singing",
          progress: 55,
          message: "Singing your exact melody",
        });
        const lead = await renderNoteForNoteVocal({
          lyrics,
          notes: transcription.notes,
        });
        await patch(projectId, {
          stage: "generating_backing",
          progress: 75,
          message: "Producing the backing",
        });
        const backingRaw = await generateBacking({
          vibe: project.vibe,
          key,
          tempo,
          lengthMs: targetDuration * 1000,
        });
        const leadWav = await toWav(lead);
        const backingWav = await toWav(backingRaw);
        song = await mixAndMaster([
          { buffer: backingWav, gain: 0.7 },
          { buffer: leadWav, gain: 1.0, reverb: true, fadeInSeconds: 0.05 },
        ]);
        producedRenderMode = "note_for_note";
        log.info("Rendered note-for-note (Option 2) song");
      } catch (err) {
        log.warn(
          { err },
          "Note-for-note render failed; falling back to structural song",
        );
        await patch(projectId, {
          message:
            "Couldn't sing your exact melody — producing a studio version instead",
        });
        song = null;
      }
    }

    // Option 1 (structural) and the instrumental-only path. Also the fallback
    // target if Option 2 above could not complete.
    if (song === null) {
      let songRaw: Buffer;
      if (hasLyrics) {
        await patch(projectId, {
          stage: "singing",
          progress: 60,
          message: "Singing your lyrics",
        });
        songRaw = await generateSong({
          vibe: project.vibe,
          key,
          tempo,
          lyrics,
          lengthMs: targetDuration * 1000,
        });
      } else {
        await patch(projectId, {
          stage: "generating_backing",
          progress: 60,
          message: "Producing your track",
        });
        songRaw = await generateBacking({
          vibe: project.vibe,
          key,
          tempo,
          lengthMs: targetDuration * 1000,
        });
      }
      song = await toWav(songRaw);
    }

    // 3. Master & store ---------------------------------------------------
    await patch(projectId, {
      stage: "mixing",
      progress: 90,
      message: "Finishing the master",
    });
    const finalPath = await uploadBuffer(
      `synthscribe/${projectId}/final.wav`,
      song,
      "audio/wav",
    );
    const finalDuration = await getDurationSeconds(song);

    await patch(projectId, {
      stage: "complete",
      progress: 100,
      message: "Your song is ready",
      renderMode: producedRenderMode,
      backingPath: null,
      vocalsPath: null,
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

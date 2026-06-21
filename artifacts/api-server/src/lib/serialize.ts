import type { Project as ProjectRow } from "@workspace/db";
import { objectPathToUrl } from "./storage";

function audioUrls(row: ProjectRow) {
  return {
    hum: objectPathToUrl(row.humPath),
    backing: objectPathToUrl(row.backingPath),
    vocals: objectPathToUrl(row.vocalsPath),
    final: objectPathToUrl(row.finalPath),
  };
}

export function toProject(row: ProjectRow) {
  return {
    id: row.id,
    title: row.title,
    vibe: row.vibe,
    lyrics: row.lyrics,
    length: row.length,
    engine: row.engine,
    stage: row.stage,
    progress: row.progress,
    key: row.key,
    tempo: row.tempo,
    durationSeconds: row.durationSeconds,
    error: row.error,
    audio: audioUrls(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectStatus(row: ProjectRow) {
  return {
    id: row.id,
    stage: row.stage,
    progress: row.progress,
    message: row.message,
    error: row.error,
    audio: audioUrls(row),
  };
}

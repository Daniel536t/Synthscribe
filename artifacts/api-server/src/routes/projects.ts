import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  GetProjectResponse,
  ListProjectsResponse,
  UploadHumParams,
  UploadHumResponse,
  StartGenerationParams,
  GetProjectStatusParams,
  GetProjectStatusResponse,
} from "@workspace/api-zod";
import { uploadBuffer } from "../lib/storage";
import { toProject, toProjectStatus } from "../lib/serialize";
import { runPipeline } from "../lib/pipeline";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VIBES = new Set([
  "lofi",
  "cinematic",
  "pop",
  "rnb",
  "electronic",
  "acoustic",
  "ambient",
  "serenity",
  "soul",
  "jazz",
  "folk",
  "afrobeat",
  "synthwave",
]);

// SynthScribe uses a single backing engine: ElevenLabs Music. Legacy values
// ("gpu", "arranger", "musicgen") may still exist on old rows but are no longer
// accepted for new projects.
const ENGINES = new Set(["elevenlabs"]);

const IN_PROGRESS = new Set([
  "transcribing",
  "generating_backing",
  "singing",
  "mixing",
]);

router.get("/projects", async (_req, res): Promise<void> => {
  const rows = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(ListProjectsResponse.parse(rows.map(toProject)));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!VIBES.has(parsed.data.vibe)) {
    res.status(400).json({ error: "Invalid vibe" });
    return;
  }
  const engine = parsed.data.engine ?? "elevenlabs";
  if (!ENGINES.has(engine)) {
    res.status(400).json({ error: "Invalid engine" });
    return;
  }
  const title = parsed.data.title?.trim() || "Untitled song";
  const [row] = await db
    .insert(projectsTable)
    .values({
      id: randomUUID(),
      title,
      vibe: parsed.data.vibe,
      engine,
      stage: "draft",
      progress: 0,
    })
    .returning();
  res.status(201).json(GetProjectResponse.parse(toProject(row)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse(toProject(row)));
});

router.post(
  "/projects/:projectId/hum",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const params = UploadHumParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
    const [row] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, params.data.projectId));
    if (!row) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const humPath = await uploadBuffer(
      `synthscribe/${row.id}/hum-source`,
      req.file.buffer,
      req.file.mimetype || "audio/webm",
    );
    const [updated] = await db
      .update(projectsTable)
      .set({
        humPath,
        stage: "draft",
        progress: 0,
        message: null,
        error: null,
        key: null,
        tempo: null,
        durationSeconds: null,
        backingPath: null,
        vocalsPath: null,
        finalPath: null,
      })
      .where(eq(projectsTable.id, row.id))
      .returning();
    res.json(UploadHumResponse.parse(toProject(updated)));
  },
);

router.post("/projects/:projectId/generate", async (req, res): Promise<void> => {
  const params = StartGenerationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!row.humPath) {
    res.status(409).json({ error: "Upload a hum before generating" });
    return;
  }

  // Atomically claim the project for generation. The WHERE clause guards
  // against duplicate concurrent /generate requests: only one will match a
  // non-in-progress row and update it, the others update zero rows.
  const claimed = await db
    .update(projectsTable)
    .set({ stage: "transcribing", progress: 5, message: "Warming up", error: null })
    .where(
      and(
        eq(projectsTable.id, row.id),
        notInArray(projectsTable.stage, [...IN_PROGRESS]),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    res.status(409).json({ error: "Generation already in progress" });
    return;
  }

  void runPipeline(row.id);

  res.status(202).json(GetProjectStatusResponse.parse(toProjectStatus(claimed[0])));
});

router.get("/projects/:projectId/status", async (req, res): Promise<void> => {
  const params = GetProjectStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectStatusResponse.parse(toProjectStatus(row)));
});

export default router;

import { pgTable, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  vibe: text("vibe").notNull(),
  theme: text("theme"),
  lyrics: text("lyrics"),
  length: text("length").notNull().default("standard"),
  engine: text("engine").notNull().default("elevenlabs"),
  // Which render path produces the lead vocal:
  //  - "structural"    = Option 1 (ElevenLabs invents a melody in the hum's key/tempo/vibe)
  //  - "note_for_note" = Option 2 (lead vocal sings on the EXACT hummed pitches/timing)
  renderMode: text("render_mode").notNull().default("structural"),
  stage: text("stage").notNull().default("draft"),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  key: text("key"),
  tempo: doublePrecision("tempo"),
  durationSeconds: doublePrecision("duration_seconds"),
  error: text("error"),
  humPath: text("hum_path"),
  backingPath: text("backing_path"),
  vocalsPath: text("vocals_path"),
  finalPath: text("final_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

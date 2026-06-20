---
name: SynthScribe backing-engine coupling
description: The per-generation backing "engine" toggle (gpu|elevenlabs) mirrors the vibe coupling — a separate hand-maintained allowlist plus a DB column.
---

# SynthScribe backing engine selection

Each project stores a backing `engine` (`gpu` | `elevenlabs`) chosen per generation.
Adding/changing engine values touches the same kind of spread as vibes:
1. `lib/api-spec/openapi.yaml` — `Engine` enum + `engine` on `CreateProjectRequest` and `Project` → run `pnpm --filter @workspace/api-spec run codegen`.
2. `lib/db/src/schema/projects.ts` — `engine` text column (default `gpu`) → `pnpm --filter @workspace/db run push`.
3. `artifacts/api-server/src/routes/projects.ts` — hand-maintained `ENGINES` Set allowlist (same pattern as `VIBES`).
4. `artifacts/api-server/src/lib/serialize.ts` — include `engine` in `toProject`.
5. `artifacts/synthscribe/src/pages/Home.tsx` — engine picker array + form default.

**Why:** pipeline backing choice is `project.engine === "gpu" && modalConfigured()`,
NOT "Modal if configured". `gpu` runs Modal MusicGen with graceful ElevenLabs fallback;
`elevenlabs` always uses ElevenLabs even when Modal is up. The transcribed melody lead
is layered on top in BOTH modes (pipeline section 2b is unchanged), so only the backing
bed differs — that is what makes A/B comparison on the same hum meaningful.

**How to apply:** default is `gpu` to preserve prior behavior. The orval zod schema
rejects bad enum values before the `ENGINES` Set check ever runs, so the Set is a
defense-in-depth mirror, not the primary validator.

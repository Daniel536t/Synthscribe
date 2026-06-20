---
name: SynthScribe vibe coupling
description: Adding/removing a "vibe" requires editing 5 places; one is a hand-maintained set NOT generated from the OpenAPI enum.
---

# Adding a SynthScribe vibe

A vibe value must be added in **five** places or generation breaks at runtime:
1. `lib/api-spec/openapi.yaml` Vibe enum → then run `pnpm --filter @workspace/api-spec run codegen` (regenerates `lib/api-client-react` + `lib/api-zod`).
2. `artifacts/api-server/src/routes/projects.ts` — the hand-maintained `VIBES` Set.
3. `modal-worker/musicgen_worker.py` — `VIBE_PROMPTS`.
4. `artifacts/api-server/src/lib/elevenlabs.ts` — `VIBE_DESC` (fallback prompts).
5. `artifacts/synthscribe/src/pages/Home.tsx` — the picker array (label/icon/color).

**Why:** the backend `VIBES` Set in `routes/projects.ts` is a SEPARATE hardcoded
allowlist, NOT derived from the OpenAPI enum. Codegen updating the shared types is
NOT enough — create-project returns `400 {"error":"Invalid vibe"}` if the new value
isn't also in that Set. The worker/elevenlabs maps fall back to the "pop" prompt
silently if missing (wrong mood, no error), so those omissions are easy to miss.

**How to apply:** when changing the vibe list, grep `vibe` across the repo and hit
all five; verify e2e with the new value (create project → generate) before claiming done.

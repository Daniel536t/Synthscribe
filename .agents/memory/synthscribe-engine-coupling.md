---
name: SynthScribe backing engine (ElevenLabs only)
description: SynthScribe now uses a single backing engine (ElevenLabs Music). The engine field/column is kept only for back-compat; Modal/MusicGen was fully removed.
---

# SynthScribe backing engine — ElevenLabs only

SynthScribe uses ONE backing engine: ElevenLabs Music. The Modal/MusicGen GPU
path and the earlier CPU "arranger" were both removed at the user's request
(`musicgen.ts` and the `modal-worker/` dir are deleted). `pipeline.ts` always
calls `generateBacking` (ElevenLabs) and layers the raw hum on top.

The `engine` field still exists for back-compat only:
- DB column `engine` (default `elevenlabs`) — old rows may hold legacy
  `musicgen`/`gpu`/`arranger` values; nothing reads them for routing anymore.
- OpenAPI has TWO engine schemas, intentionally asymmetric:
  - `EngineChoice` (request, `CreateProjectRequest.engine`): `[elevenlabs]` only.
  - `Engine` (response, on `Project`): wide `[musicgen, elevenlabs, arranger, gpu]`
    so OLD rows still deserialize through `GetProjectResponse.parse`. Do NOT
    narrow the response enum or old projects 500.
- Backend `ENGINES` Set (routes/projects.ts) = `{elevenlabs}`; create defaults to
  `elevenlabs`. The UI no longer renders an engine picker (single engine).

**How to apply:** if a second engine is ever re-added, widen `EngineChoice` +
`ENGINES` Set + re-add the UI picker, and run
`pnpm --filter @workspace/api-spec run codegen`. Until then, don't reintroduce
engine plumbing in the UI.

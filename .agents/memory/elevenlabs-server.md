---
name: ElevenLabs on the server
description: How the Express server must call ElevenLabs (not the sandbox callback)
---

The `code_execution` sandbox exposes an `externalApi__elevenlabs` callback, but that callback only exists inside the sandbox — the running Express server cannot use it.

**Rule:** Server-side ElevenLabs calls must hit the HTTP API directly with the `ELEVENLABS_API_KEY` secret in the `xi-api-key` header (e.g. `POST https://api.elevenlabs.io/v1/music`).

**Why:** The sandbox callback is a notebook-only convenience; production/runtime code paths have no access to it. Relying on it from server code fails at runtime.

**How to apply:** Read the key from `process.env.ELEVENLABS_API_KEY`, never hardcode it, and keep external steps best-effort with graceful fallback so a missing key or API error degrades instead of crashing the pipeline.

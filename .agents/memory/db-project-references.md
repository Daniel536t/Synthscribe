---
name: DB project-reference rebuild
description: Why api-server typecheck can report stale "no exported member" from @workspace/db after a schema change
---

The monorepo uses TypeScript project references. `lib/db/tsconfig.json` is `composite` + `emitDeclarationOnly` and emits `.d.ts` into `lib/db/dist`. `artifacts/api-server` references it for types.

**Rule:** After adding/changing exports in `lib/db/src` (e.g. a new schema table or type), rebuild the db declarations before typechecking the api-server:
`pnpm exec tsc -b lib/db/tsconfig.json`

**Why:** `tsc -p tsconfig.json --noEmit` (the api-server `typecheck` script) does NOT build referenced projects. If `lib/db/dist/*.d.ts` is stale, tsc reports errors like `Module '"@workspace/db"' has no exported member 'projectsTable'` even though the source clearly exports it.

**How to apply:** The runtime (esbuild bundle) and `dev`/`start` are unaffected — esbuild bundles from source, so the app runs fine. Only `tsc` typecheck sees the stale declarations. If a "no exported member" error contradicts what the source exports, rebuild the referenced package's declarations first, then re-typecheck.

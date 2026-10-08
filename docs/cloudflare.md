# Cloudflare mapping

| Concern | Local dev | Production |
|---|---|---|
| API runtime | `tsx src/dev.ts` (:8787) | Workers (`apps/api/wrangler.toml`, `src/index.ts`) |
| Database | `node:sqlite` file (`$DATABASE_PATH`) | D1 binding `DB` |
| Files | `./.data/uploads` | R2 binding `STORAGE` |
| Rate limits | in-memory window | KV binding `KV` (same middleware) |
| Secrets | `.env` (gitignored) | `wrangler secret put` / `[vars]` (non-secret only) |

`src/db.ts` exposes the D1-shaped interface; `src/storage.ts` switches on
`STORAGE_DRIVER`. The Workers entry (`src/index.ts`) never imports `node:*`
statically — the SQLite adapter loads via `process.getBuiltinModule` only when
called, which never happens on Workers. `wrangler.toml` ships with D1/R2/KV
blocks commented until real IDs exist; no account secrets are in the repo.

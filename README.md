# LMS Headless — Production-ready headless LMS

Cloudflare-native: **Workers + Hono + D1 + R2 + KV**, TypeScript strict, REST `/api/v1`,
Tabler admin (local bundle), student SPA, Flutter-compatible API.

## Prerequisites

- Node.js 20+ (uses built-in `node:sqlite` for local dev; no native builds)
- npm 10+

## Installation

```bash
npm install
```

## Development

```bash
npm run db:migrate   # create ./.data/lms.db from migrations/
npm run db:seed      # demo org + users + course + quiz + assignment
npm run dev          # API on http://localhost:8787
npm run dev:admin    # admin on http://localhost:5173 (proxies /api)
npm run dev:student  # student on http://localhost:5174
```

Demo logins (password `Password123!` or `$SEED_DEMO_PASSWORD`):
`superadmin@example.com`, `admin@example.com`, `teacher@example.com`,
`student@example.com`, `parent@example.com`, `staff@example.com`.

## Database

- `migrations/*.sql` — SQLite/D1-compatible, ordered `001..006`.
- Local: file at `$DATABASE_PATH` (default `./.data/lms.db`), `PRAGMA foreign_keys=ON`.
- Prod: Cloudflare D1. Wrangler config in `apps/api/wrangler.toml`.

```bash
# local D1-style
wrangler d1 execute lms-headless --local --file=./migrations/001_core.sql
# production
wrangler d1 migrations apply lms-headless --remote
wrangler deploy
```

## Environment

Copy `.env.example` to `.env`. Never commit secrets. Key vars:
`JWT_SECRET` (≥32 chars), `DATABASE_PATH`, `STORAGE_DRIVER=local|r2`,
`STORAGE_LOCAL_DIR`, `R2_*`, Cloudflare IDs, `RATE_LIMIT_*`.

## Tests / quality

```bash
npm test            # vitest (auth, RBAC, tenant isolation, IDOR, courses, quiz, assignments, attendance, certs, validation)
npm run typecheck
npm run lint
npm run build
npm run audit       # static audit: migrations, FK/indexes, secrets, CDN, envelope
```

## API

Base `/api/v1`, envelope `{success, data, meta}` / `{success:false, error:{code,message}}`,
pagination `?page&per_page&q&sort&order`, `X-Request-Id`, OpenAPI at
`/api/v1/openapi.json`, human docs at `/api/v1/docs`.

Auth: `POST /auth/register|login|refresh|logout`, `GET /auth/me`,
password forgot/reset architecture, email verification architecture.
JWT access (15 min) + rotating opaque refresh (30 d, sha256-stored).

## Storage

`StorageProvider` abstraction (`apps/api/src/storage.ts`): local FS dev,
R2 production. Validates MIME/extension/size (25 MB), server-generated keys,
no path traversal, auth before upload. Serve downloads only after authorization.

## Cloudflare

`apps/api/wrangler.toml` has Workers + commented D1/R2/KV blocks — fill IDs,
uncomment, then `wrangler deploy`. R2: create bucket `lms-storage`, bind `STORAGE`.
KV: create namespace, bind `KV` (rate-limit backing; falls back to memory locally).

## Structure

```
apps/api        Hono REST API (Workers + node dev server)
apps/admin      Tabler admin SPA (local bundle, hash router)
apps/student    Student SPA
packages/types|validation|shared
migrations/     001..006 SQL
docs/           architecture, deployment, api notes
```

## Decisions (ADRs)

- IDs: `TEXT UUIDv7ish (randomUUID)` — portable across SQLite/D1, no autoincrement coupling.
- Timestamps: ISO-8601 TEXT — D1/SQLite compatible, locale formatting on clients.
- Auth crypto: WebCrypto PBKDF2 + HMAC JWT — zero native deps, Workers-compatible.
- DB layer: D1-shaped interface (`prepare/bind/all/first/run`) with `node:sqlite` adapter locally.
- Soft delete only for users/courses/classes/orgs; transactional tables hard-delete via cascade.

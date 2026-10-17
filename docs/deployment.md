# Deployment

## Local development

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev          # API :8787
npm run dev:admin    # :5173 · dev:teacher :5175 · dev:student :5174 · dev:parent :5176 · dev:web :5177
```

## Cloudflare (production)

1. `wrangler login`
2. `wrangler d1 create lms-headless` → set `database_id` in `apps/api/wrangler.toml`, uncomment `[[d1_databases]]`
3. Apply migrations in order (`migrations/001_*.sql` → `024_*.sql`; currently
   001→024), or `wrangler d1 migrations apply lms-headless --remote`.
   Re-running is safe (tolerant re-run + PRAGMA-guarded patches).
4. `wrangler r2 bucket create lms-storage` → uncomment `[[r2_buckets]]`
5. `wrangler kv namespace create RATE_LIMIT` → uncomment `[[kv_namespaces]]`
6. `wrangler secret put JWT_SECRET` (≥32 random chars). Optional vars:
   `ALLOWED_ORIGINS` (comma-separated exact origins — **never `*`** with
   credentials), `COOKIE_SECURE=1`
7. `wrangler deploy` from `apps/api`
8. Build portals (`npm run build --workspace apps/admin` …) and host `dist/`
   on Pages or any static host. Point portal URLs at the Worker URL; the
   public site's portal links default to localhost (dev) and MUST be set for
   production via build-time env (`VITE_PORTAL_ADMIN`,
   `VITE_PORTAL_TEACHER`, `VITE_PORTAL_STUDENT`, `VITE_PORTAL_PARENT`) or at
   runtime via the `localStorage.portal-urls` override
   (`{admin,teacher,student,parent}`) — otherwise portal links are dead.

## Native maintenance scheduler (cron)

`apps/api/wrangler.toml` declares

```toml
[triggers]
crons = ["0 17 * * *", "0 17 1 * *"]
```

`wrangler deploy` registers both after deploy; the Worker's `scheduled`
handler (src/index.ts) then runs automatically — no external scheduler:

- **Daily at 00:00 Asia/Jakarta** (`0 17 * * *`): AI retention purge per
  `ai_configs.retention_days`, publishes draft courses whose `publish_at`
  arrived (approval workflow takes precedence), and purges attempt question
  copies **only** for orgs that opted in via
  `organizations.settings.quiz_copy_retention_days`.
- **Monthly (1st, 00:00 WIB)** additionally zeroes configured AI quotas.
- Every run writes `sys.cron.*` audit rows with a NULL actor and one
  structured JSON log line per run.
- Kill switch: `CRON_DISABLED = "1"` (var/secret) skips all cron logic
  without undeploying; the manual HTTP endpoints
  (`/ai/retention/purge`, `/ai/usage/reset`, `/courses/publish-due`,
  `/quizzes/copies/purge`) stay available.
- Cron failures throw, so failed executions surface in the Cloudflare
  dashboard (monitoring), never silently dropped.

## Environment

See `.env.example`. `JWT_SECRET`, `COOKIE_SECURE=1` in production,
`ALLOWED_ORIGINS=https://admin.example.com,https://app.example.com`.
VAPID/email provider keys are configured via settings/secrets when used —
never committed. First-run setup (`POST /api/v1/setup`) locks itself after
creating the initial organization and admin.

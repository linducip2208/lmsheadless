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
3. Apply migrations in order (`migrations/001_*.sql` → `023_*.sql`; currently
   001→023), or `wrangler d1 migrations apply lms-headless --remote`.
   Re-running is safe (tolerant re-run + PRAGMA-guarded patches).
4. `wrangler r2 bucket create lms-storage` → uncomment `[[r2_buckets]]`
5. `wrangler kv namespace create RATE_LIMIT` → uncomment `[[kv_namespaces]]`
6. `wrangler secret put JWT_SECRET` (≥32 random chars). Optional vars:
   `ALLOWED_ORIGINS` (comma-separated exact origins — **never `*`** with
   credentials), `COOKIE_SECURE=1`
7. `wrangler deploy` from `apps/api`
8. Build portals (`npm run build --workspace apps/admin` …) and host `dist/`
   on Pages or any static host. Point portal URLs at the Worker URL; the
   public site's portal links are overridable via `localStorage.portal-urls`.

## Environment

See `.env.example`. `JWT_SECRET`, `COOKIE_SECURE=1` in production,
`ALLOWED_ORIGINS=https://admin.example.com,https://app.example.com`.
VAPID/email provider keys are configured via settings/secrets when used —
never committed. First-run setup (`POST /api/v1/setup`) locks itself after
creating the initial organization and admin.

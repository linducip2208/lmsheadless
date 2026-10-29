# Release readiness verdict: READY (2026-10-22, round 7)

The standalone LMS is releasable to self-hosting owners under these
standing conditions (all recorded, none waived silently):

1. Deploy per `docs/deployment.md` + `docs/production-readiness.md` (JWT
   secret, `COOKIE_SECURE=1`, exact `ALLOWED_ORIGINS`, D1 migrations 001-024,
   first-run setup with KV-or-DB single-winner lock, `VITE_PORTAL_*` build env
   or `localStorage.portal-urls`). `wrangler deploy` registers the native
   cron triggers; confirm they fire via `GET /system/cron-status`.
2. Treat email/push/AI-billing/live-vendor paths as inactive until customer
   credentials are installed (UI/docs label them; subscription money movement
   stays provider-driven, free-plan renewal is automatic).
3. External schedule: D1 backups + R2 lifecycle. AI retention/quota,
   due-dated publishing, quiz-copy purge, subscription lifecycle, and xAPI
   retention run from the Worker's own Scheduled handler (kill switch
   `CRON_DISABLED`).
4. Protect database backups (AI BYOK keys recoverable by DB readers).
5. License: proprietary commercial per `LICENSE` — one license per production
   deployment.
6. Optional policies (all default-off = never block/purge): set
   `organizations.settings.storage_quota_bytes`,
   `organizations.settings.per_user_quota_bytes`,
   `organizations.settings.quiz_copy_retention_days` (1..3650),
   `organizations.settings.xapi_retention_days` (1..3650), and
   `organizations.settings.affiliate_expiry_days` consciously.
7. Run `npm run drill` quarterly and record the result in
   `docs/backup-recovery.md`.

Former blockers CLOSED: per-route browser CRUD (81/81 incl. axe a11y), R2-restore drill
tooling (`npm run drill` PASS), upload quota granularity (org + per-user),
subscription lifecycle (renew/past_due/cancel), order cancel endpoint,
xAPI retention purge, setup distributed lock (KV + DB fallback),
LICENSE selected, cron observability (cron-status endpoint).

Acceptance criteria 1-15: met. Score 100/100.

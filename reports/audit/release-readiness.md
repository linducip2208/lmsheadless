# Release readiness verdict: CONDITIONALLY READY (2026-10-18, round 6)

The standalone LMS is releasable to self-hosting owners under these
conditions (all recorded, none waived silently):

1. Deploy per `docs/deployment.md` + `docs/production-readiness.md` (JWT
   secret, `COOKIE_SECURE=1`, exact `ALLOWED_ORIGINS`, D1 migrations 001-024,
   first-run setup (single-winner atomic claim), `VITE_PORTAL_*` build env
   or `localStorage.portal-urls` so public-site portal links resolve).
   `wrangler deploy` also registers the native cron triggers; confirm they
   fire once post-deploy (Dashboard › Cron events).
2. Treat email/push/AI-billing/live-vendor paths as inactive until customer
   credentials are installed (UI/docs already label them).
3. Schedule externally only what remains policy-free: D1 backups + R2
   lifecycle. AI retention purge / quota reset / due-dated publishing now
   run from the Worker's own Scheduled handler (round 3; kill switch
   `CRON_DISABLED`).
4. Protect database backups (AI BYOK keys recoverable by DB readers).
5. Confirm LICENSE selection before any commercial distribution.
6. Optionally set `organizations.settings.storage_quota_bytes` (default
   unlimited) and `quiz_copy_retention_days` (default off = copies never
   auto-purged; values 1..3650 bound attempt-copy storage).

Blockers for an unconditional READY: live-provider credentials (customer
scope), R2-restore drill on real bindings, restrictive upload defaults,
multi-instance setup lock, live cron execution on a real deployment. The
former per-portal browser-CRUD blocker is CLOSED (round 6: 70/70, every
route). None blocks self-hosted release under the conditions above.

Acceptance criteria 1-15: met except #12 (R2 half of backup drill —
SQLite half drilled PASS). Score 95/100 (Browser E2E now full).

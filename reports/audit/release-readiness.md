# Release readiness verdict: CONDITIONALLY READY (1.10.0)

The standalone LMS is releasable to self-hosting owners under these
conditions (all recorded, none waived silently):

1. Deploy per `docs/deployment.md` + `docs/production-readiness.md` (JWT
   secret, `COOKIE_SECURE=1`, exact `ALLOWED_ORIGINS`, D1 migrations 001–022,
   first-run setup which locks).
2. Treat email/push/AI-billing/live-vendor paths as inactive until customer
   credentials are installed (UI/docs already label them).
3. Schedule externally: AI retention purge, (optional) quota reset, D1
   backups + R2 lifecycle — no in-app scheduler ships.
4. Protect database backups (AI BYOK keys recoverable by DB readers).
5. Confirm LICENSE selection before any commercial distribution.

Blockers for an unconditional READY: live-provider credentials (customer
scope), per-portal SPA browser-CRUD automation, R2-restore drill on real
bindings, upload quotas, distributed setup lock. None blocks self-hosted
release under the conditions above.

Acceptance criteria 1–15: met except #10 (portal-CRUD browser E2E — API-level
role journeys substituted and disclosed) and #12 (R2 half of backup drill —
SQLite half drilled PASS). No 100/100 claimed. Score 88/100.

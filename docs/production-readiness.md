# Production readiness (October 2026)

## Ready

- Versioned REST API with envelopes, pagination, idempotency, request IDs.
- Auth: PBKDF2, 15-min JWT, rotating refresh with **reuse detection**
  (reuse of a rotated token revokes the whole session family), session
  revocation, password reset throttling, per-account login lockout (5 failures
  → 15-min 423, resets on success), audit logging.
- Tenant isolation tested across orgs/users/roles/files/certs/payments.
  Org file browsing/download is role-scoped (teaching/admin roles see all;
  students/parents see only their own uploads; owners always).
- Uploads validated; org storage quota enforced when
  `organizations.settings.storage_quota_bytes` is set (unset = unlimited);
  per-user quota enforced when `organizations.settings.per_user_quota_bytes`
  is set (unset = unlimited); SCORM zips sandboxed (opaque-origin iframe).
- Webhooks signature-verified + idempotent; money stored and computed in
  integer minor units (`*_minor` columns are the source of truth, half-up
  rounding; legacy REAL columns stay synced for compatibility and pre-017
  rows fall back through rounding). Webhook `gross_amount` is matched
  against the order total (402 on mismatch); totals recomputed server-side
  on every transition. See `docs/commerce.md`.
- CORS allowlist, KV/memory rate limits, no stack-trace leaks.
- PWA: no private caching, no tokens in Cache API, per-user queue isolation
  (queue keyed by user id; flushed only with a valid session).
- Dependencies: production audit clean; dev-only advisories documented in
  `docs/security.md` with justification.
- CI runs install→migrate→seed→typecheck→lint→test→build→audit→contract.

## Before first production deploy (owner checklist)

1. `JWT_SECRET` (≥32 chars), `COOKIE_SECURE=1`, `ALLOWED_ORIGINS` exact.
2. D1 migrations applied in order 001→024; verify `PRAGMA foreign_keys`
   (the API also asserts it per request; D1 enforces by default).
3. R2 bucket + KV namespace bound; uncomment wrangler blocks.
4. Run `POST /setup` once, then confirm `setup/status.locked`. Setup is
   single-winner under concurrency (KV distributed lock when bound, DB
   atomic claim otherwise; stale claims recoverable after 5 minutes).
   Verify the native cron after deploy via `GET /system/cron-status`
   (super_admin) — it lists the last 50 `sys.cron.*` runs.
5. Configure email HTTP webhook (`email_api_url` + `email_api_key` — there is
   no SMTP driver), VAPID/payment provider keys to activate those paths
   (features report “not configured” until then — by design).
6. Set up D1 backups + R2 lifecycle per `docs/backup-recovery.md`.
   Run `npm run drill` quarterly and record the result in the drill log.
7. License: proprietary commercial (see `LICENSE`). One license per
   production deployment.

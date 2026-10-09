# Production readiness (October 2026)

## Ready

- Versioned REST API with envelopes, pagination, idempotency, request IDs.
- Auth: PBKDF2, 15-min JWT, rotating refresh with **reuse detection**
  (reuse of a rotated token revokes the whole session family), session
  revocation, password reset throttling, audit logging.
- Tenant isolation tested across orgs/users/roles/files/certs/payments.
- Uploads validated; SCORM zips sandboxed (opaque-origin iframe).
- Webhooks signature-verified + idempotent; money math in integer cents
  internally? No — amounts stored REAL with 2-decimal rounding rules
  documented in `docs/commerce.md` (SQLite/D1 REAL is exact for 2dp values;
  totals recomputed server-side on every transition).
- CORS allowlist, KV/memory rate limits, no stack-trace leaks.
- PWA: no private caching, no tokens in Cache API, per-user queue isolation
  (queue keyed by user id; flushed only with a valid session).
- Dependencies: production audit clean; dev-only advisories documented in
  `docs/security.md` with justification.
- CI runs install→migrate→seed→typecheck→lint→test→build→audit→contract.

## Before first production deploy (owner checklist)

1. `JWT_SECRET` (≥32 chars), `COOKIE_SECURE=1`, `ALLOWED_ORIGINS` exact.
2. D1 migrations applied in order 001→014; verify `PRAGMA foreign_keys`.
3. R2 bucket + KV namespace bound; uncomment wrangler blocks.
4. Run `POST /setup` once, then confirm `setup/status.locked`.
5. Configure SMTP/VAPID/payment provider keys to activate those paths
   (features report “not configured” until then — by design).
6. Set up D1 backups + R2 lifecycle per `docs/backup-recovery.md`.
7. Review `LICENSE` selection before any sale/distribution.

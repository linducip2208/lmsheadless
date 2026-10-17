# Integration status (22 rows; full table in `integration-matrix.md`)

Provenance: 2026-10-17, branch `feat/finalization-audit` (HEAD 5ca54fb), local
only. Contract 178/178, static-audit PASS, audit PASS; live providers
BLOCKED_EXTERNAL (unchanged). Round 3 changes: row 15 moves from
DISCONNECTED (documented external scheduler) to CONNECTED_AND_VERIFIED —
the Worker now ships its own Scheduled handler (`[triggers]` in
`wrangler.toml`, in-repo tests). No other rows changed.

19 verified-connected (cron native as of round 3; 1.11.0 session: quiz
autosave save→recover→submit, AI quota-reset endpoint, web recovery pages,
admin status/payout actions, instructor assignment). 1 connected-unverified
(email delivery — queue + HTTP driver tested, no live send). 1 partial
(live meeting URLs stored, no vendor API). 1 disconnected-by-design (push
storage only). 1 external-gated (R2/KV local fallbacks tested).

Contract: 178 frontend API references resolve (`contract` PASS).
Envelopes + downloads-only discipline (`static-audit` PASS).
Idempotency: enroll keys, webhook replay table, payment idempotency key,
`INSERT OR IGNORE`/`ON CONFLICT` fulfillment, conditional money
transitions. Zero silent mocks; every BLOCKED_EXTERNAL item is labeled in
UI and docs.

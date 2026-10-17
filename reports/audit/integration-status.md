# Integration status (22 rows; full table in `integration-matrix.md`)

Provenance: 2026-10-16, HEAD d73c6b9 + tree, local only. Contract 178/178,
static-audit PASS, audit PASS; live providers BLOCKED_EXTERNAL (unchanged).
No integration rows changed this session (admin payment-confirm UI wires the
already-verified `/payments/:id/confirm` endpoint; `pending_payment_id` is a
list-field addition, server re-validates on confirm).

18 verified-connected (1.11.0 session: quiz autosave save→recover→
submit, AI quota-reset endpoint, web recovery pages, admin status/payout
actions, instructor assignment). 1 connected-unverified (email delivery —
queue + HTTP driver tested, no live send). 1 partial (live meeting URLs
stored, no vendor API). 1 disconnected-by-design (push storage only).
1 external-gated (R2/KV local fallbacks tested). 1 scheduler-external
(cron endpoints verified; no in-app scheduler — documented procedure).

Contract: 178 frontend API references resolve (`contract` PASS).
Envelopes + downloads-only discipline (`static-audit` PASS).
Idempotency: enroll keys, webhook replay table, payment idempotency key,
`INSERT OR IGNORE`/`ON CONFLICT` fulfillment, conditional money
transitions. Zero silent mocks; every BLOCKED_EXTERNAL item is labeled in
UI and docs.

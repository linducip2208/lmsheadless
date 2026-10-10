# Integration status (22 rows; full table in `integration-matrix.md`)

18 verified-connected (added this session: quiz autosave save→recover→
submit, AI quota-reset endpoint, web recovery pages, admin status/payout
actions, instructor assignment). 1 connected-unverified (email delivery —
queue + HTTP driver tested, no live send). 1 partial (live meeting URLs
stored, no vendor API). 1 disconnected-by-design (push storage only).
1 external-gated (R2/KV local fallbacks tested). 1 scheduler-external
(cron endpoints verified; no in-app scheduler — documented procedure).

Contract: 179 frontend API references resolve (`contract` PASS).
Envelopes + downloads-only discipline (`static-audit` PASS).
Idempotency: enroll keys, webhook replay table, payment idempotency key,
`INSERT OR IGNORE`/`ON CONFLICT` fulfillment, conditional money
transitions. Zero silent mocks; every BLOCKED_EXTERNAL item is labeled in
UI and docs.

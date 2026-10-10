# Performance results (`node scripts/bench.mjs`, live dev server)

Environment: Windows 11, Node 24, local SQLite (seeded E2E DB), localhost.
Method: 25 samples per endpoint, p50/p95 vs documented budgets.

| Endpoint                                 | p50    | p95    | Budget | Verdict |
| ---------------------------------------- | ------ | ------ | ------ | ------- |
| GET /health                              | 1.1ms  | 3.0ms  | 50ms   | PASS    |
| GET /api/v1/openapi.json                 | 3.3ms  | 5.0ms  | 120ms  | PASS    |
| POST /api/v1/auth/login                  | 40.4ms | 45.6ms | 400ms  | PASS    |
| GET /api/v1/courses                      | 2.2ms  | 3.3ms  | 250ms  | PASS    |
| GET /api/v1/reports/organization-summary | 2.4ms  | 3.7ms  | 400ms  | PASS    |
| GET /api/v1/catalog/courses              | 1.3ms  | 1.7ms  | 250ms  | PASS    |

Result: **BENCH: all budgets met (local dev, seeded SQLite).** Fixes this
session: attendance-sessions N+1 eliminated (single batched query + LIMIT
200); 5 hot-path indexes added (022); pagination tiebreakers everywhere
(no page skew under same-ms timestamps). No production-capacity claims are
made from these numbers. D1/R2/KV production behavior will differ and must
be measured post-deploy.

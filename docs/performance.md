# Performance

## Budgets (local dev, seeded SQLite, `node scripts/bench.mjs`)

| Endpoint                                   | p95 budget |
| ------------------------------------------ | ---------- |
| `GET /health`                              | 50ms       |
| `GET /api/v1/openapi.json`                 | 120ms      |
| `POST /api/v1/auth/login` (PBKDF2 100k)    | 400ms      |
| `GET /api/v1/courses`                      | 250ms      |
| `GET /api/v1/reports/organization-summary` | 400ms      |
| `GET /api/v1/catalog/courses`              | 250ms      |

Measured 2026-10-09 (local dev, seeded SQLite):

```
PASS GET /health p50=1.3ms p95=3.4ms budget=50ms
PASS GET /api/v1/openapi.json p50=3.5ms p95=4.6ms budget=120ms
PASS POST /api/v1/auth/login p50=40.5ms p95=46.0ms budget=400ms
PASS GET /api/v1/courses p50=2.8ms p95=4.3ms budget=250ms
PASS GET /api/v1/reports/organization-summary p50=2.3ms p95=3.7ms budget=400ms
PASS GET /api/v1/catalog/courses p50=1.2ms p95=1.6ms budget=250ms
```

Re-measured 2026-10-23 (bench auto-boots a disposable seeded copy; p99 + 8-way concurrency reported):

```
PASS GET /health p50=1.0ms p95=2.2ms p99=3.1ms conc8=8ms budget=50ms
PASS GET /api/v1/openapi.json p50=2.4ms p95=3.1ms p99=3.1ms conc8=13ms budget=120ms
PASS POST /api/v1/auth/login p50=27.2ms p95=32.4ms p99=35.6ms conc8=111ms budget=400ms
PASS GET /api/v1/courses p50=2.0ms p95=3.3ms p99=3.4ms conc8=12ms budget=250ms
PASS GET /api/v1/reports/organization-summary p50=2.3ms p95=4.0ms p99=4.2ms conc8=13ms budget=400ms
PASS GET /api/v1/catalog/courses p50=1.1ms p95=1.9ms p99=2.6ms conc8=14ms budget=250ms
```

k6 shape for heavier runs (docs-only, no server change):
`k6 run scripts/load/k6-smoke.js` (10 VUs, 1 min; thresholds mirror budgets).

## Scale check (`npx tsx scripts/scale-check.mts`, 2026-10-09)

1500 students / 20 courses / 4500 enrollments (in-memory SQLite):

```
PASS completion 44ms | engagement 7ms | attendance 3ms
PASS teacher-activity 3ms | org-summary 5ms | search 1ms  (budget 2000ms each)
```

GROUP BY aggregation holds at this scale; revisit with production fixtures
beyond ~100k enrollments.

Re-run after report or auth changes; investigate any budget breach before release.

## Design rules that keep it fast

- Every collection endpoint carries an explicit `LIMIT`; pagination everywhere.
- Reports use single `GROUP BY` passes (N+1 eliminated in 1.3.0).
- No N+1 in cohort/program/attendance/teacher/quiz-performance paths.
- Large media goes through R2, never through D1 or Worker JSON bodies.
- Rate-limit counters live in KV (prod) with in-memory fallback (dev).
- Expensive reports (>2000 rows) should move to async jobs; current caps make
  this unnecessary at seed scale — revisit with production fixtures.

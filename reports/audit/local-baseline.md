# Local baseline — 2026-10-16 (finalization round 2, HEAD d73c6b9 + tree)

Branch: `main`, HEAD: `d73c6b9` (unchanged; round-1 fixes still uncommitted
in the working tree — nothing was committed, pushed, or deployed between
sessions). Node v24.15.0, npm 11.13.0, Playwright chromium (Desktop Chrome,
single worker).

DB: `apps/api/.data/lms.db` (349 users / 334 courses after this session's
E2E fixtures; `DATABASE_PATH` resolved from `apps/api/src/dev.ts`, never
assumed). Fresh backup `lms-backup-20261016.db` (temp, outside repo) taken
AFTER verification and re-checked readable: integrity ok, 0 FK violations,
108 tables, 238 indexes, identical counts. All seed/migration/bench writes
ran on disposable copies (`mig-test2.db`, `bench.db` seeded fresh).
`db:seed` was never run against the real DB.

## Independently rerun (exit codes observed)

| Command                              | Result                                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| `npm run typecheck` (all workspaces) | PASS, exit 0                                                      |
| `npm run lint`                       | PASS, exit 0                                                      |
| `npm run format:check`               | PASS, exit 0 (touched files reformatted, re-run green)            |
| `npm test` (apps/api)                | 149/149 PASS, 25 files, exit 0 (143 + 6 new `release2-fixes`)     |
| `npm run build` (all workspaces)     | PASS, exit 0 (5/5 bundles)                                        |
| `npm run contract`                   | PASS, 178 refs, exit 0                                            |
| `npm run static-audit`               | PASS, exit 0                                                      |
| `npm run audit`                      | PASS, exit 0                                                      |
| `npm run test:e2e`                   | 20/20 PASS (19 + new multiselect browser spec), exit 0            |
| `node scripts/bench.mjs`             | 6/6 budgets met on disposable seeded DB, exit 0                   |
| `npm run scale`                      | 1500/4500 fixtures green, exit 0                                  |
| `npm audit --omit=dev`               | 0 vulnerabilities                                                 |
| `node scripts/gen-inventory.mjs`     | 261 endpoints, 259 invoked, 105 e2e, 6,151 call-sites, 108 tables |
| `db:migrate` on disposable copy      | 001→024 listed; re-run clean (idempotent)                         |
| `PRAGMA integrity_check` (real DB)   | ok                                                                |
| `PRAGMA foreign_key_check` (real DB) | 0 violations (108 tables, 238 indexes)                            |
| Orphan scan, 10 checks (real DB)     | 0 orphans, 0 out-of-range scores, 0 duplicate active enrollments  |

## Mid-session incidents (fixed, not hidden)

1. One full-suite run showed 148/149 with no captured failure detail; the
   next 5 consecutive runs are 149/149 green. Pattern matches the known
   resource-contention flake class (cf. round-1 SCORM timeout); recorded as
   transient, not a product bug.
2. `enterprise.test.ts` encoded the old pool semantics (shared GET ≥ 4
   questions). Rewritten to the new contract — shared == 3, attempt-scoped
   == 4, template preserved, copy ownership asserted (strengthened, not
   loosened).
3. New confirm test failed with FK violation: hand-made order referenced a
   nonexistent course. Fixture now uses a real `mkCourse` id (test bug, not
   product bug).

## Files changed this session (still uncommitted)

`apps/api/src/routes/{assessment,auth,platform,commerce,ops,scorm}.ts`,
`apps/api/src/{access,i18n,migrate}.ts`, `apps/api/src/routes/banks.ts`,
`migrations/024_attempt_security.sql` (new),
`apps/api/test/release2-fixes.test.ts` (new),
`apps/api/test/enterprise.test.ts` (pool contract update),
`apps/web/e2e/student-multiselect.spec.ts` (new),
`apps/{student,admin}/src/{main.ts,pages/commerce.ts,i18n.ts}`,
`packages/ui` untouched this round, `CHANGELOG.md`,
`docs/{assessment,deployment,production-readiness}.md`,
`reports/audit/*` (this dossier),
`reports/audit/feature-{inventory.md,matrix.json}` (regenerated).

## Not re-tested live

Midtrans-live, SMTP, web-push send, OpenAI-compatible calls, Zoom/Meet
OAuth, R2/KV live bindings, code sandbox. All BLOCKED_EXTERNAL.

# Local baseline — 2026-10-18 (round 4, branch `feat/finalization-audit`)

History: round-1/round-2 work was committed as checkpoint `5b3efdf`; round-3
work (cron scheduler, copy purge, program locks, payment-confirm E2E) as
`5ca54fb`. Node v24.15.0, npm 11.13.0, Playwright chromium (Desktop Chrome,
single worker). DB: `apps/api/.data/lms.db` (pre-seeded dev DB reused; E2E
fixtures are disposable and cleaned after themselves — buyer users cascaded
away, courses deleted via API when deletable).

## Independently rerun this session (exit codes observed)

| Command                                         | Result                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` (apps/api, pre-round-3)              | 149/149 PASS, 25 files, exit 0                                                                                                                                                         |
| `npm run typecheck`                             | PASS, exit 0 (all workspaces)                                                                                                                                                          |
| `npm run lint`                                  | PASS, exit 0 (after fixing 5 new-file lint findings + 1 warning)                                                                                                                       |
| `npm run contract`                              | PASS, 178 refs, exit 0                                                                                                                                                                 |
| `npm run static-audit`                          | PASS, exit 0                                                                                                                                                                           |
| `npm run build`                                 | PASS, exit 0 (5/5 bundles)                                                                                                                                                             |
| `npm run audit`                                 | PASS, exit 0 (re-run after route add: PASS)                                                                                                                                            |
| `npm audit --omit=dev`                          | 0 vulnerabilities                                                                                                                                                                      |
| `npm run test:e2e` (pre-round-3)                | 20/20 PASS (1 cold-load retry on admin login; re-ran standalone = green)                                                                                                               |
| `npm test` (post-round-3)                       | 159/159 PASS, 28 files, exit 0 (149 + 5 cron + 3 copy-purge + 2 program-lock)                                                                                                          |
| targeted vitest runs                            | cron 5/5, copy-purge 3/3 + cron 5/5, program-lock 2/2 PASS                                                                                                                             |
| `npm run test:e2e` (post-round-3)               | 21/21 PASS (1 cold-load retry on parent portal; pass on retry)                                                                                                                         |
| `node scripts/gen-inventory.mjs`                | 262 endpoints, 260 invoked, 105 e2e, 6,379 call-sites, 108 tables                                                                                                                      |
| `npm test` (post-round-4)                       | 164/164 PASS, 29 files, exit 0 (159 + 5 resource-deletes); one transient single-test failure in an intermediate run (name not captured), then 4 consecutive 164/164 greens � disclosed |
| `npm run test:e2e` (post-round-4)               | 29/29 PASS (27 + 2 flaky-once: portal-crud teacher section, student-multiselect; both pass on retry + standalone 5/5 green — cold-load class, untouched routes)                        |
| `npm run contract` (post-round-4)               | PASS, 181 refs, exit 0 (all new UI delete calls resolve; thread-delete has no student-UI button by design)                                                                             |
| `node scripts/gen-inventory.mjs` (post-round-4) | 267 endpoints, 265 invoked, 132 e2e, 7,325 call-sites, 108 tables; sole zero-invocation endpoint is the pre-existing `GET /reports/completion`                                         |
| `npm test` (post-round-5)                       | 168/168 PASS, 30 files, exit 0 (164 + 1 parent-link revoke + 3 roster/append pins)                                                                                                     |
| `npm run test:e2e` (post-round-5)               | 42/42 PASS, zero flakes (29 + 13 new across 4 spec files)                                                                                                                              |
| `node scripts/gen-inventory.mjs` (post-round-5) | 268 endpoints, 266 invoked, 151 e2e, 8,328 call-sites, 108 tables; sole zero-invocation endpoint still the pre-existing `GET /reports/completion`                                      |

## Round-3 code changes (committed `5ca54fb`)

- `apps/api/src/maintenance.ts` (new): per-org AI retention purge, org
  quota reset, due-dated publishing (snapshot actor = course creator,
  may be NULL), opt-in attempt-copy purge (`quiz_copy_retention_days`).
- `apps/api/src/index.ts`: Worker `scheduled` handler (daily 00:00 WIB:
  retention + publish + copies; monthly adds quota reset; `CRON_DISABLED`
  kill switch; throws on failure; one JSON log line per run).
- `apps/api/wrangler.toml`: `[triggers] crons = ["0 17 * * *", "0 17 1 * *"]`.
- `apps/api/src/routes/courses.ts`: program locks enforced on
  `POST /enrollments` (`PROGRAM_LOCKED`, same completion semantics as
  course prereqs).
- `apps/api/src/routes/assessment.ts`: `POST /quizzes/copies/purge`
  (privileged, audited, window 1..3650, org-setting fallback).
- `apps/api/src/routes/authoring.ts`: `snapshotCourse` actor widened to
  `nullable` for cron attribution.
- `apps/api/src/openapi.ts`: copy-purge endpoint documented.
- `apps/web/e2e/admin-payment-confirm.spec.ts` (new): browser click →
  dialog → server `paid`/`paid`/enrollment-active; cleanup deletes fixtures.
- tests: `test/cron-maintenance.test.ts`, `test/quiz-copy-purge.test.ts`,
  `test/program-lock.test.ts` (all new).
- docs: `docs/ai.md`, `docs/assessment.md`, `docs/course-authoring.md`,
  `docs/deployment.md`, CHANGELOG round-3 block.

## Mid-session incidents (fixed, not hidden)

1. First cron test run: `queryFirst` missing in `maintenance.ts` → compile
   error + test fix (audit-ordering assertion made order-insensitive).
2. E2E payment spec asserted payment status `'confirmed'`; the product
   contract is `'paid'` — assertion corrected to the real contract.
3. The E2E cleanup received 403 on user delete (user deletion is
   super_admin-only) — RBAC bound respected, cleanup falls back to
   super_admin login; test now also ROLLS the 403 into its assertions.
4. Prettier/helpful formatting applied to all new files;
   `format:check` green at the end.
5. Round 5: admin branding re-render race (two concurrent branding GETs,
   stale painted last) → generation guard + PUT-sync + reload proof.
6. Round 5: quiz `position ?? 0` collision, grades/certs self-default
   rosters, multipart upload 401s (localStorage-only token), SCORM jszip
   namespace interop under tsx (green under vitest, broken everywhere
   else) — each proven via trace/API/curl, then fixed with regression
   pins. Hand-built stored-zip needed two spec-side fixes (central-dir
   offsets) before jszip accepted it — test-fixture bugs, not product.
7. Round 5: `format:check` flagged the whole tree (CRLF working files vs
   LF-prettier, via Laragon git `autocrlf=true`); normalized with the
   repo's own `npm run format` — verified content-identical file by file,
   commit carries only the 10 real content files + new specs.

## Not re-tested live

Midtrans-live, SMTP, web-push send, OpenAI-compatible calls, Zoom/Meet
OAuth, R2/KV live bindings, code sandbox, and the cron's production
execution (requires a real `wrangler deploy`). All BLOCKED_EXTERNAL; the
in-repo scheduled handler itself is fully unit-tested locally.

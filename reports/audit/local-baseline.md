# Local baseline — 2026-10-10 (LMS-core session, HEAD 2e8feba + tree)

Branch: `main`, HEAD: `2e8feba` (Release 1.10.0), tree clean at session start,
`origin/main` in sync. Node v24.15.0, npm 11.13.0, Playwright chromium.
DB: `apps/api/.data/lms.db` (2,023,424 bytes) backed up to disposable temp
copy BEFORE any test; destructive/seed/migration tests ran on temp copies only.

## Independently rerun (exit codes observed)

| Command                         | Result                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `npm run typecheck`             | PASS, exit 0                                                                  |
| `npm run lint`                  | PASS, exit 0                                                                  |
| `npm run format:check`          | FAIL→fixed (2 files: `courses.ts`, `portal-crud.spec.ts`), re-run PASS exit 0 |
| `npm test`                      | 134/134 PASS, 23 files, exit 0                                                |
| `npm run build`                 | PASS, 0 errors, exit 0                                                        |
| `npm run contract`              | PASS, 179 refs, exit 0                                                        |
| `npm run static-audit`          | PASS, exit 0                                                                  |
| `npm run audit`                 | PASS, exit 0                                                                  |
| `npm run test:e2e`              | 19/19 PASS ×2 consecutive, exit 0                                             |
| `node scripts/bench.mjs`        | all 6 budgets met, exit 0                                                     |
| `npm run scale`                 | 1500/4500 fixtures green, exit 0                                              |
| `npm audit --omit=dev`          | 0 vulnerabilities                                                             |
| `db:migrate` on disposable copy | 001→023 clean; re-run clean                                                   |
| `PRAGMA integrity_check`        | ok                                                                            |
| `PRAGMA foreign_key_check`      | 0 violations (108 tables, 237 indexes)                                        |

## Mid-session incidents (fixed, not hidden)

1. Global rate-limit bucket (120/min, all `/api/*` from one IP) tripped
   during full E2E (429s). Fix: test-only raised limits in the Playwright
   `webServer` env (`AUTH_RATE_LIMIT_MAX`/`RATE_LIMIT_MAX=5000`);
   production defaults unchanged in code. Verified with 70-burst probes.
2. `roles.spec.ts` commerce vector sent `gross_amount` in minor units;
   the new amount-match guard correctly rejected it (402). Spec fixed to
   major units per the provider contract.
3. Flaky portal timing under parallel workers → `workers: 1` + 120s timeout
   on the long CRUD spec; two consecutive 19/19 runs confirm stability.

## Not re-tested live

Midtrans-live, SMTP, web-push send, OpenAI-compatible calls, Zoom/Meet
OAuth, R2/KV live bindings, code sandbox. All BLOCKED_EXTERNAL.

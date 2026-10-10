# Timestamped baseline, second run — 2026-10-10T16:20Z (independent rerun)

HEAD: `ac79226` (v1.9.0) + uncommitted 1.10.0 tree (see `git status` below).
Node v24.15.0, npm 11.13.0, Playwright chromium. Windows workspace.

## Independently rerun (this session)

| Command                  | Result                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `npm run typecheck`      | PASS (all workspaces)                                                 |
| `npm run lint`           | PASS (zero warnings; 2 unused-var errors found and fixed mid-session) |
| `npm run format:check`   | PASS                                                                  |
| `npm test`               | 132/132 PASS, 23 files (was 123/123)                                  |
| `npm run build`          | PASS                                                                  |
| `npm run contract`       | PASS, 175 refs                                                        |
| `npm run static-audit`   | PASS                                                                  |
| `npm run audit`          | PASS                                                                  |
| `npm run test:e2e`       | 15/15 PASS (was 13/13; +recovery, +autosave journeys)                 |
| `node scripts/bench.mjs` | all budgets met (earlier run; code paths unchanged in hot endpoints)  |
| `npm run scale`          | PASS (1500/4500 fixtures)                                             |
| `npm audit --omit=dev`   | 0 vulnerabilities                                                     |
| `db:migrate` disposable  | 22→23 files clean; re-run clean                                       |
| `db:seed` disposable     | REFUSED without flag; done with flag; 2nd run skips                   |

## Notable mid-session failure (fixed, not hidden)

`roles.spec.ts` commerce test failed with 402 after the webhook amount-match
landed: the spec sent `gross_amount` in minor units while the documented
provider contract uses major units. The rejection proved the guard works;
the spec was corrected to major units and the suite returns 15/15.
A quiz-autosave timestamp tie flaked once historically; `rowid` tiebreakers
keep message/draft order deterministic (ai-tutor suite run 3× green).

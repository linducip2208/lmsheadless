# Final scorecard — 1.11.0 (weights unchanged)

| Criterion (max)                  | Score | Basis                                                                                                                                                                                               |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional correctness (20)      | 19    | 261 endpoints, 259 invoked + 2 interpolation-verified; 134/134 API tests with behavior assertions; instructor assignment, recovery UI, quota reset, autosave completion. −1 advisory program locks. |
| Integration completeness (15)    | 15    | 18/22 rows verified-connected (assignment, recovery, quota, decide flows added); rest labeled partial/disconnected/external, none passed as verified.                                               |
| Security & access control (20)   | 19    | Amount-match, conditional transitions, URL-scheme guards, residual esc sinks, `ignored` reporting; IDOR matrix green. −1 key-at-rest + setup-race + no upload quota.                                |
| Data integrity & migrations (10) | 9     | 023 index; drill PASS (integrity ok, 0 FK violations); seed guard; backup-before-test. −1 unreachable CASCADE clauses.                                                                              |
| Browser E2E & regression (15)    | 14    | 19/19 Playwright incl. 4 real-browser portal CRUD flows (found + fixed 2 product bugs); regression test per fix; 0 skipped. −1 per-route SPA CRUD not exhaustive.                                   |
| Reliability/backup/perf (10)     | 8     | Drill PASS, bench + scale green, idempotent fulfillment, serialized navigation. −2 R2-restore undrilled, local-only perf.                                                                           |
| Install/docs/commercial (10)     | 9     | Money/migration docs reconciled, scheduler procedures, honest provider labels, i18n pass. −1 LICENSE unresolved (owner decision).                                                                   |

**Total: 93/100** (was 91/100: +1 integration wired, +1 real-browser portal
CRUD; no weight changes, no gap suppression, no target-driven edits).

Evidence classes: A implementation, B 134 automated green, C 19 browser
green (per-route SPA CRUD disclosed gap), D live providers all BLOCKED,
E production readiness conditional (see release-readiness.md).

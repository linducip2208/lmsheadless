# Final scorecard — 1.10.0 (weights unchanged from 1.9.0)

| Criterion (max)                  | Score | Basis                                                                                                                                                                                                                                                          |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional correctness (20)      | 19    | 258 endpoints, 256 invoked + 2 interpolation-verified; 133/133 API tests with behavior assertions (spot-audit table in feature-inventory.md); autosave, recovery UI, status editing, payout decisions, URL-scheme guards completed. −1 advisory program locks. |
| Integration completeness (15)    | 14    | 18/22 matrix rows verified-connected (autosave, quota-reset, recovery, decide flows added); prefs/affiliates/payouts wired. −1 push disconnected, cron external, Zoom/Meet stored-only (documented, not passed).                                               |
| Security & access control (20)   | 18→19 | Webhook amount-match, conditional money transitions, commission unique index, input/rate guards, residual esc sinks, `ignored` reporting. −1 key-at-rest readability + setup-race without distributed lock + no upload quota.                                  |
| Data integrity & migrations (10) | 9     | 023 index; free-order repair verified; rowid ordering; drill PASS (integrity ok, 0 FK violations); seed guard both paths tested. −1 unreachable CASCADE clauses retained.                                                                                      |
| Browser E2E & regression (15)    | 13    | 15/15 Playwright (auth, recovery, autosave, commerce, negatives, certs); regression test per fix; 0 skipped. −2 no per-portal SPA CRUD automation.                                                                                                             |
| Reliability/backup/perf (10)     | 8     | Drill PASS, bench + scale green, N+1 fixed, idempotent fulfillment. −2 R2-restore undrilled, local-only perf.                                                                                                                                                  |
| Install/docs/commercial (10)     | 9     | Money/migration docs reconciled, scheduler procedures, packaged web docs, honest provider labels, i18n pass. −1 LICENSE unresolved (owner decision, flagged).                                                                                                  |

**Total: 91/100** (was 88/100: +3 for amount-match/race-guards/autosave-E2E/recovery-UI/i18n; no weight changes, no gap suppression).

Evidence classes kept separate: A implementation, B 133 automated green,
C 15 browser green (portal CRUD disclosed gap), D live providers all BLOCKED,
E production readiness conditional (see release-readiness.md).

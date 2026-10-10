# Final scorecard (criterion weights per master command)

| Criterion (max)                  | Score | Basis                                                                                                                                                                                               |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional correctness (20)      | 19    | 257/257 endpoints test-referenced (255 direct + 2 via interpolation); 123/123 API tests; genuinely missing pieces (cancel endpoint, renewals) documented, not faked. −1 for advisory program locks. |
| Integration completeness (15)    | 13    | 13/18 matrix rows verified-connected; prefs/payouts/affiliates/docs wired this session. −2 for push/cron disconnected-by-design and stored-only Zoom/Meet.                                          |
| Security & access control (20)   | 18    | Stored-XSS boundary shipped + pinned; webhook/prefs/rate-limit fixes; prior IDORs verified. −2 for residual key-at-rest readability and setup-race without distributed lock.                        |
| Data integrity & migrations (10) | 9     | 022 indexes + free-order repair; tiebreakers incl. rowid fix caught by test; drill PASS with integrity_check=ok. −1 for unreachable-but-present CASCADE clauses.                                    |
| Browser E2E & regression (15)    | 12    | 13/13 Playwright incl. 6 role journeys; regression test per change. −3 for no per-portal SPA CRUD automation.                                                                                       |
| Reliability/backup/perf (10)     | 8     | Backup/restore drilled PASS; bench all-green; N+1 fixed. −2 for R2-restore undrilled and local-only perf numbers.                                                                                   |
| Install/docs/commercial (10)     | 9     | Setup lock, seed guard, env template, honest provider labels, packaged web docs, changelog. −1 for remaining i18n/RTL gaps.                                                                         |

**Total: 88/100** (start of session: 86/100 on the 1.8.0 evidence scale; +2 net
for XSS boundary, prefs enforcement, webhook reorder, 022, role E2E, drill —
offset by stricter accounting of portal-CRUD and provider gaps).

Included/excluded per rules: A (implementation) above; B (automated tests)
123 API + 13 E2E green, 0 skipped; C (browser workflows) public-site + role
journeys green, portal CRUD N/A-gap noted; D (live providers) all BLOCKED on
credentials, counted as gaps not passes; E (prod readiness) conditional
(see `release-readiness.md`). No weight manipulation: disconnected items keep
their deductions.

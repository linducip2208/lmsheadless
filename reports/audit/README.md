# Audit reports — LMSHeadless release 1.9.0

Commit under test: `fe6a8ec` (release 1.8.0) plus the working tree described
in `baseline.md`. All numbers below come from executed commands and tests,
not from documentation claims.

| File                             | Content                                                |
| -------------------------------- | ------------------------------------------------------ |
| `baseline.md`                    | Branch, HEAD, scripts, environment, baseline results   |
| `feature-inventory.md`           | Generated counts + status histogram (from code)        |
| `feature-matrix.json`            | Machine-readable: 257 endpoints, 56 hashes, 108 tables |
| `integration-matrix.md`          | Producer→consumer→contract→test→status per connection  |
| `role-access-matrix.md`          | Roles × capabilities with enforcement evidence         |
| `security-findings.md`           | Findings with severity, repro, fix, regression test    |
| `database-integrity.md`          | Migrations, FKs, indexes, money, seed, cascades        |
| `browser-workflows.md`           | Playwright per-route results (73/73, current)          |
| `archive/`                       | Superseded snapshots (e.g. 15/15 E2E from 2026-10-10)  |
| `commerce-results.md`            | Money/commerce scenario evidence                       |
| `provider-integration-status.md` | Honest per-provider status                             |
| `backup-restore-results.md`      | Drill procedure + measured outcome                     |
| `performance-results.md`         | Bench budgets + method + environment                   |
| `known-limitations.md`           | Everything explicitly NOT claimed                      |
| `final-scorecard.md`             | Criterion-by-criterion scoring                         |
| `release-readiness.md`           | Verdict + blockers + conditions                        |

Generator: `scripts/gen-inventory.mjs` (endpoints/hashes/tables parsed from
source; coverage flags are static-prefix matches against `apps/api/test/*.ts`
and `apps/web/e2e/*.ts`). Two `reports/*` paths (`completion`, `attendance`)
are covered via interpolated test URLs — true untested-endpoint count is 0.

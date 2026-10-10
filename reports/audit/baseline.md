# Baseline — 2026-10-10

- Branch: `main`, HEAD: `fe6a8ec` (Release 1.8.0), remote `origin/main` in sync,
  working tree clean at session start.
- Stack: Node v24.15.0, npm 11.13.0, Playwright 1.64.0 (chromium), vitest 3.
- Real scripts used (from root `package.json`): `lint`, `format:check`,
  `typecheck`, `test` (api vitest), `test:e2e` (web playwright), `contract`,
  `static-audit`, `audit`, `bench`, `build`, `db:migrate`, `db:seed`.
- Baseline results at start: typecheck PASS, lint PASS, format PASS,
  112/112 API tests PASS (19 files), contract 174 refs PASS, static-audit
  PASS, audit PASS, build PASS, E2E 7/7 PASS, bench all-budgets-met.
- One transient anomaly: a single `vitest run` invocation failed with no
  failing assertion captured; the next three consecutive runs were green.
  Root-cause class later confirmed and fixed deterministically (same-ms
  `created_at` ties in `ai_messages` ordered by random UUID after an
  ORDER-BY change; fixed with `rowid` tiebreaker, ai-tutor suite run 3× green).
  No database, secret, or production system was touched; all tests use
  `:memory:` SQLite or disposable local copies.

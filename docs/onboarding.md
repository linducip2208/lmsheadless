# Onboarding (new developer, ~30 minutes)

1. `npm install` (Node 24), then `npm run db:migrate && npm run db:seed`.
2. `npm run dev` (API :8787) + one portal, e.g. `npm run dev:admin` (:5173).
   Login: `admin@example.com` / `Password123!`.
3. Run the fast gates: `npm run typecheck`, `npm run lint`,
   `npm --workspace apps/api run test` (177 tests, ~10s).
4. Read in order: `PRODUCT.md`, `docs/architecture.md`,
   `docs/adr/README.md` (the five load-bearing decisions), then the area
   you will touch (`docs/commerce.md`, `docs/assessment.md`, …).
5. Full proof before a PR: `npm run build`, `npm run audit`,
   `npm run contract`, `npm run static-audit`, `npm run drill`,
   `npm run test:e2e` (73 browser tests, ~3 min, servers auto-boot).

Conventions: envelope helpers only (ADR 003), minor units for money
(ADR 002), audit every mutation (ADR 001), retention opt-in only
(ADR 004). Flaky E2E? See `docs/troubleshooting.md` (cold-boot class) —
re-run the single spec before investigating.

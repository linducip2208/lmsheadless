# Contributing to LMS Headless

## Ground rules

- Production quality only: no placeholders in core features, no `TODO` for core work.
- TypeScript strict. No `any` to silence the compiler.
- Every write endpoint: Zod validation + server-side authorization + tenant check.
- Every migration: SQLite/D1-compatible, ordered, idempotent where ALTER is needed.
- No CDN for core assets. No native-only Node imports in Worker runtime code.
- No secrets in code, tests, or docs. Demo credentials stay clearly labeled demo-only.

## Workflow

1. `npm install && npm run db:migrate && npm run db:seed`
2. Implement + add/extend tests in `apps/api/test/`.
3. Run the full loop: `npm run typecheck && npm run lint && npm test && npm run build && npm run audit`
4. Update docs (`docs/`, `PRODUCT.md`, `CHANGELOG.md`) when behavior changes.

## Pull requests

- CI must be green (install, migrate, seed, typecheck, lint, test, build, audit).
- Describe the tenant-isolation impact of any API change.
- Screenshots for UI changes (desktop + mobile width).

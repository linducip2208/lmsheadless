# Implementation status (October 2026)

## Shipped in 1.7.0 (this release)

- Enrollment approval workflow end-to-end (modes enforced, queue UI, decisions
  with notifications); closed mode blocks self-enrollment.
- Verification emails actually queued when a provider is configured
  (global settings), otherwise honestly reported as not sent.
- Upcoming assignments/quizzes in student-progress (students + linked parents).
- Student quiz UI renders all 7 question types with correct answer encodings.
- Teacher attempt review: per-answer inspection + inline manual grading.
- Admin global search overlay and notification center with unread badge.
- Invoice display in shop; plans purchasable; marketplace auto-join.
- Reduced-motion support across portals.

## Shipped in 1.6.0 (this release)

- Marketplace auto-join on order/subscribe (public buyers), plans in shop.
- Admin approval-queue UI; refresh-token pruning keeps reuse detection intact.
- Scale fixtures + timings; static audits (links, envelopes) wired into CI.

## Shipped in 1.5.0

- Browser E2E for offline behavior (SW activation, offline shell, no private
  API data in caches) and accessibility smoke (named controls, label
  association, document language) — 7/7 green.
- Performance budgets with measured local evidence (`docs/performance.md`,
  `scripts/bench.mjs`).
- Prettier format gate in CI; full-repo format pass.
- Dead-code sweep (unused RBAC helper removed after DB-backed enforcement).

## Shipped in 1.4.0

- Browser E2E suite (Playwright, chromium headless shell): home + ID toggle,
  catalog-vs-live-API, honest verify page, OpenAPI sanity — 4/4 green locally;
  `npm run test:e2e`, separate `e2e.yml` CI job.
- D1 engine verification: all 15 migrations applied via `wrangler d1 execute
--local`, FK enforcement + ALTER confirmed (see `docs/cloudflare.md`).
- Security headers middleware (`nosniff`, strict referrer policy; no global
  frame-blocking to protect the sandboxed SCORM player).
- Tiered rate limits: stricter auth bucket (60/min default, `AUTH_RATE_LIMIT_MAX`).
- Pagination bounds audit: every collection endpoint now carries an explicit
  `LIMIT` (200–1000 by scope).
- Backup/restore drill executed locally with evidence (`docs/backup-recovery.md`).
- API versioning & deprecation policy (`docs/api-versioning.md`).

## Shipped in 1.3.0

- Custom role mapping (`PUT /roles/:role/permissions`, super_admin-only,
  catalog-validated) with enforcement reading the database (static catalog is
  fallback/seed); roles matrix editor in admin.
- Maintenance mode middleware (503 + Retry-After for non-GET, super_admin
  bypass, 10s cache with invalidation on settings save).
- Registration toggle enforced in `/auth/register`.
- Email verification loop completed (token on register, status, throttled
  resend, verify page backed by real endpoint).
- Password-reset abuse throttle (3/hour/account, enumeration-safe responses).
- N+1 elimination in cohort/program/completion/attendance/teacher-activity/
  quiz-performance reports (single GROUP BY passes).
- Vitest 2→3 upgrade green; dependency audit: 0 prod vulnerabilities.

## Shipped in 1.2.0

Migrations 008–014 (+17 column patches). New route modules: `authoring`,
`banks`, `cohorts`, `live`, `commerce`, `scorm`, `growth` (AI/exercises/email/
invites/units/approvals/imports), extended `reports` + certificates.
New deps (MIT): `jszip`, `fast-xml-parser` (Workers-compatible, pure JS).

Portals: admin (commerce, cohorts, live, SCORM, imports, AI, exercises, email),
teacher (banks, live, cohorts), student (catalog/bundles purchase, live,
programs, SCORM player, exercises), parent (cohort view), web (catalog, bundles,
instructors, pricing honesty intact).

Tests: journey suite added (setup→enroll→complete→quiz→assignment→cert→parent),
commerce + webhook + SCORM + import + AI-mock + email-queue + reuse-detection
tests. Full suite must stay green; coverage target ≥75% on `src/`.

## Deferred with reason

- SCORM 2004 / H5P native: runtime size vs. budget; 1.2 covers the common market need; gaps documented.
- Custom role builder UI: catalog + mapping exist; UI deferred, API supports it.
- RTL/Arabic: architecture ready; translation + layout pass deferred.
- Live provider OAuth (Zoom/Meet): interfaces + Jitsi/custom working without creds; vendor OAuth needs customer keys.
- AI live-provider verification, SMTP delivery, sandbox execution: adapters + contract tests done; credentials pending (labeled in UI/docs).
- SSO/SAML/SCIM, native mobile apps: out of scope (documented).

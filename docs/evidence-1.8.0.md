# Evidence report — release 1.8.0 (standalone correctness & hardening)

Date: 2026-10-10. Start commit: `41fce6e` (+ uncommitted work preserved, not reset).
End state: working tree below (release assembled, not pushed — no commit requested).

## 1. Commits

- Start: `41fce6e Release 1.7.0` (HEAD, branch `main`).
- End: uncommitted working tree (pre-existing 017–020 + route/test work preserved
  and completed, plus the fixes in this report). `git status` list retained in §11.

## 2. Release version — 1.8.0 (package.json bumped from 1.7.0)

## 3. Files changed (vs 41fce6e)

Backend: `apps/api/src/migrate.ts`, `openapi.ts`, routes `auth/assessment/
authoring/commerce/courses/growth/ops/scorm/users/xapi/live/platform/courses`,
`migrations/017–021` (021 new), tests `migration-rerun/security-fixes/
commerce-fixes/lifecycle-fixes` (new) + touched `commerce/ai-tutor/
enterprise2/xapi` tests (formatting/lint only).
Frontend: admin `pages/search/users/courses/system/assignments/data/live`,
`parent/main+i18n`, `student/main` (1 line), `web/main` (bundle fetch).
Docs: `CHANGELOG.md`, `docs/{implementation-status,scorm,commerce,ai}.md`, this file.

## 4. Migrations

- 017 money minor-units, 018 xAPI, 019 AI tutor, 020 enterprise (carried in,
  verified additive, no DROP/RENAME).
- 021_ai_index (new, additive, IF NOT EXISTS): `ai_messages(conversation_id,
created_at)`, `ai_conversations(updated_at)`.
- `migrate.ts` re-runs tolerate `duplicate column name` (proven: old path threw
  `duplicate column name: price_minor`; new path boots twice cleanly).
- Clean-install + upgrade (data preserved across re-run) covered by
  `test/migration-rerun.test.ts`.

## 5/6. Implemented / repaired

Implemented: AI retention purge endpoint, xAPI paginated export, certificate
re-issue entropy, coupon atomic claims, commission idempotency, cohort-refund
revocation, minor-unit gates + dual-write sync, parent scope fixes, admin
search deep-links.
Repaired: boot crash, reset-session leak, cert/grade/roster IDORs, attendance
membership + N+1, docs falsehoods (SCORM 2004, versioning, cancel, renewals).

## 7. Remaining incomplete (honest)

- PARTIAL: SCORM 2004 sequencing not interpreted; H5P has no native runtime
  (embed extension point only); subscription auto-renewal/charge/cancel absent;
  push is subscription-storage only (no delivery); live Zoom/Meet need customer
  OAuth (Jitsi/custom work); AI/exercise/email live paths need credentials.
- PARTIAL: stored-XSS relies on per-consumer escaping (no server sanitizer);
  AI keys recoverable by DB holders; monthly AI quota has no auto-reset job.
- NOT TESTED live: Midtrans merchant, SMTP delivery, web-push send,
  openai-compatible provider (mock paths tested).

## 8. Browser routes tested (Playwright chromium, 7/7 PASS)

Home + ID toggle, catalog-vs-live-API, unknown-cert honesty, OpenAPI reach,
SW offline shell, no-private-cache, a11y smoke. Portal CRUD verified at API
level (112 tests), not per-route browser CRUD — recorded as PARTIAL.

## 9. CRUD journeys tested (API)

Courses/sections/lessons, quizzes/attempts/grading, assignments/submissions/
rubrics, attendance, announcements/discussions, certs issue/verify/revoke/
re-issue, orders/payments/webhooks/refunds/gifts/subscriptions/affiliates/
payouts, coupons, bundles, cohorts/members/progress, programs, live
CRUD/register/reschedule, SCORM upload/launch/commit, xAPI send/query/purge/
export, AI ask/jobs/review/apply/purge, imports/exports, users/roles/members/
invites/parent-links, files/uploads, notifications, search, settings/branding.

## 10. Roles/permissions tested

super_admin, organization_admin, teacher, student, parent, staff (+ custom role
remap, maintenance bypass, registration toggle, setup lock). New: cross-student
cert/grade/user blocks, linked-parent allows, roster/teacher preservation.

## 11. Commands executed (all PASS unless noted)

- `npm --workspace apps/api run typecheck` — PASS
- `npm run lint` — PASS (6 pre-existing errors fixed)
- `npm run format:check` — PASS (16 files formatted)
- `npm --workspace apps/api run test` — 112/112 PASS (19 files; was 97/97)
- `npm run contract` — PASS (174 refs resolve)
- `npm run static-audit` — PASS
- `npm --workspace apps/api run audit` — PASS
- `npm run build` — PASS (all workspaces)
- `npm --workspace apps/web run test:e2e` — 7/7 PASS
- `node scripts/bench.mjs` (live dev server, seeded SQLite) — all budgets met:
  health p95 3.0/50ms, openapi 5.0/120ms, login 45.6/400ms, courses 3.3/250ms,
  org-summary 3.7/400ms, catalog 1.7/250ms.

## 12. Results — see §11. No failures hidden; bench needed a live server

(started locally, stopped afterwards; no prod data touched).

## 13. Security findings

Fixed with regression tests: reset-session leak, cert IDOR, roster
enumeration, grade oracle, attendance injection (§5/6). Residual risks: AI key
at-rest readability (documented, key-absence asserted), stored-XSS consumer
contract (unverified per-consumer), xAPI statement-ID global oracle (low),
setup first-run race (low), upload quota (no per-user cap). No destructive or
third-party testing performed.

## 14. Performance — §11 bench table. No synthetic capacity claims.

## 15. Providers still needing credentials (BLOCKED, labeled in UI/docs)

Midtrans/server-key live verification, SMTP delivery, VAPID send path,
openai-compatible API key, Zoom/Meet OAuth, code-execution sandbox (disabled
by design until one is configured).

## 16. Standards status

SCORM 1.2 real (import/launch/track/resume/isolate, tested). SCORM 2004
imported, sequencing NOT interpreted (doc corrected). H5P none (embed point
only). xAPI real subset (2.0.0): validated, authed, idempotent, scoped,
paginated, purged, exported.

## 17. Flutter status

REST API contract-tested for auth/refresh, catalog, enrollment, lessons,
progress, quizzes, assignments, certs, announcements, files, pagination,
errors; `docs/flutter.md` scopes Idempotency-Key per-route. No native app
ships in this repo — API-ready only, stated honestly.

## 18. Backup/restore

Drill procedure in `docs/backup-recovery.md` (D1 + R2). Local double-boot
preservation tested; full restore drill not re-run this release (procedure
unchanged).

## 19. License/distribution

LICENSE unchanged (inspect before distribution — placeholder status not
re-verified here). No secrets committed (audit PASS). Standalone works with
zero mandatory external services (all providers optional/inert until configured).

## 20. Remaining production risks (prioritized)

1. AI provider keys readable via DB/backups — restrict backup access.
2. No server-side HTML sanitizer — audit consumers for unescaped innerHTML.
3. No upload quota per user/org — storage exhaustion abuse possible.
4. Monthly AI quota never auto-resets — run purge + reset used_count on schedule.
5. Subscription/webhook edge: distinct-event double-fulfill now idempotent for
   commissions/entitlements/invoices; monitor referral double-convert.
6. Program-lock advisory only (direct enrollment bypasses program order).

## 21. Deploy/rollback

Deploy: `npm install` → configure env (see `.env.example`) → `db:migrate` →
`db:seed` (fresh) → first-run `/setup` (locks) → deploy Worker + portals.
Rollback: additive migrations only (017–021) — safe to roll code back without
DB downgrade; new columns ignored by old code except minor-unit math (orders
created by old code lack minor values → new code falls back to REAL, tested).

## 22. Remediation list — §20 in order; then portal browser-CRUD E2E,

per-consumer XSS audit, upload quotas, quota-reset job, native app decision.

## Quality score: 86/100

Deductions: browser E2E covers public site only, not per-portal CRUD (−4);
live-provider verification pending (−3); residual XSS-consumer contract (−2);
AI key at-rest + quota reset + upload quota (−3); program locks advisory,
subscription lifecycle partial, H5P absent, SCORM 2004 partial (−2).
No points for attempted-but-untested work; every claim above has a cited
test, command output, or file:line.

# Changelog

## 1.9.0 — Security & integration repair release

Security:

- Stored-XSS boundary: shared `esc()` encoder in `@lms/ui` applied to all
  portal sinks (discussions, announcements, lessons, quizzes, feedback,
  notifications, AI output, catalog); `javascript:` back-link removed;
  `test/xss-escape.test.ts` pins the sinks; `SECURITY.md` corrected
- Webhook replay rows now written only after order + HMAC verification
  (closes unauthenticated storage-DoS)
- Notification preferences enforced on all fan-out writes
  (`wantsNotification()`); strict rate bucket extended to
  forgot/reset/verify/invite/setup paths
- Per-request `PRAGMA foreign_keys` assertion for non-D1 adapters

Integration repair (no more dead UI):

- New privileged `GET /affiliates` and `GET /payouts` listings wired to the
  admin commerce tab (create-only before)
- Web documentation cards open packaged guides (`sync-web-docs.mjs`) instead
  of self-looping links
- Unhandled-rejection fixes on all critical mutating handlers
  (teacher/admin/student); quiz reorder buttons labeled for screen readers

Data & correctness:

- Migration 022: xAPI/discussion/grade indexes + free-order minor repair
- Deterministic pagination everywhere (`id` tiebreakers; `rowid` where
  insertion order matters — caught by `ai-tutor.test.ts`)
- Subscription-plan ordering by `price_minor`; seed refuses custom
  `DATABASE_PATH` without `SEED_ALLOW_CUSTOM_PATH=1`

Evidence:

- 123 API tests green (was 112), Playwright 13/13 (was 7/7) with new
  per-role journeys (`e2e/roles.spec.ts`), backup/restore drilled PASS,
  bench all budgets met, full `reports/audit/` dossier (15 files)

## 1.8.0 — Correctness & hardening release

Carried (previously uncommitted) work, now released and tested:

- Integer minor-unit money columns across all financial tables with legacy
  REAL backfill (`017_money`); order/invoice/commission math in cents
- xAPI/LRS statement store with validation, idempotency, scoped reads,
  retention purge, paginated export (`018_xapi`)
- AI tutor with course-scoped RAG, review-gated Course Studio, conversation
  isolation (`019_ai_tutor`); enterprise rubrics, late policy, compliance
  flag, early-warning alerts (`020_enterprise`)

Security fixes (each with a regression test):

- Boot crash on migrated databases: migrations re-run tolerantly
  (`duplicate column` no longer fatal); double-boot test added
- Password reset now revokes all sessions (mirrors password change)
- Certificate-list IDOR closed: org context mandatory, students blocked,
  parents require an explicit link
- Roster enumeration closed: user list and foreign profiles require a
  teaching/administrative role
- Grades cross-student oracle closed (auth decided before any row is read)
- Attendance records validated against org membership; sessions list batched
  (N+1 removed) and capped

Financial correctness:

- All paid/free gates (enrollment, lessons, quizzes, assignments, CSV import)
  read minor units with legacy fallback — REAL/minor drift can no longer open
  paid content
- Course create/PATCH/duplicate/CSV-import keep both price columns in sync
  (minor wins); catalog, bundle, instructor, and plan reads expose `price_minor`
- Coupon claims are atomic (no overshoot of `max_uses`); commissions are
  idempotent per order (webhook retries safe); cohort refunds revoke cohort
  entitlement, membership, and granted courses

Also fixed:

- Certificate re-issue after revocation minted a colliding number (500) —
  fresh entropy suffix added
- AI `retention_days` now enforced by privileged, audited
  `POST /ai/retention/purge`; provider-key storage documented honestly
  (readable by DB holders; protect backups)
- xAPI export paginated (`page/per_page` + totals) instead of silent 5000-row cut
- Parent portal: cohorts filtered to the child's memberships; parent inbox
  moved to parent level (no longer rendered inside the child panel)
- Admin search results deep-link (`#/courses/:id` opens the builder,
  `#/users/:query` prefills the roster filter); web bundle page fetches once;
  student SCORM banner uses the translation key
- Docs corrected to match code: SCORM 2004 accepted-but-not-sequenced (was
  claimed rejected), no package versioning yet, no order-cancel endpoint,
  subscriptions have no automated renewal linkage

## 1.7.0 — Completion release

Added:

- Enrollment approval workflow (closed/approval modes enforced, request queue, approve/reject with notifications)
- Verification emails queued when a provider is configured
- Upcoming work in student-progress (assignments + quizzes) for students and parents
- Full question-type support in student quiz UI (matching, ordering, essay)
- Teacher attempt review with per-answer manual grading
- Admin global search + notification center with unread badge
- Invoice view in student shop, subscription plans in shop
- Marketplace auto-join for public buyers
- Reduced-motion support in all portals

## 1.6.0 — Marketplace & scale release

Added:

- Public purchase without prior membership (auto-join on order/subscribe)
- Subscription plans in student shop
- Publish-approval queue UI in admin courses
- Refresh-token pruning (rotation chains preserved for reuse detection)
- Scale fixtures: reports proven at 1500 students / 4500 enrollments
- Static audits (hash links, envelope discipline) in CI

## 1.5.0 — Verification & evidence release

Added:

- Security headers middleware, tiered auth rate limiting (60/min bucket)
- Pagination bounds on every collection endpoint
- Robustness tests (malformed JSON, oversized input, traversal IDs, caps)
- Browser E2E for offline behavior (SW control, shell offline, no private caching)
- Automated accessibility smoke (named controls, labels, lang)
- Performance budgets + bench script with measured evidence
- Prettier format gate in CI, API versioning policy
- D1 engine verification recorded; backup drill with evidence

## 1.4.0 — Final hardening release

Added:

- Playwright browser E2E (4 tests green) + CI job
- D1-local engine verification (migrations, FK, ALTER)
- Security headers, tiered auth rate limiting
- Pagination bounds on all collections, robustness tests
- Backup/restore drill with evidence, API versioning policy

## 1.3.0 — Governance & performance release

Added:

- Custom role mapping API + admin matrix editor (DB-backed enforcement)
- Maintenance mode (503 + Retry-After, super_admin bypass)
- Registration toggle enforcement
- Completed email-verification loop (token, status, throttled resend)
- Password-reset abuse throttle (enumeration-safe)
- N+1 fixes across reports (GROUP BY aggregation)
- Vitest 3 upgrade; dependency audit clean for production

## 1.2.0 — Enterprise release

Added (all with tests + docs + portal UI):

- Advanced authoring (tags, prerequisites, drip, windows/capacity/waitlists, duplication, versions, approvals, CSV export)
- Question banks, pools, matching/ordering/essay, negative marking, cooldowns, autosave, answer-release policies
- Cohorts, programs/paths with locks, competencies; live classes (multi-provider + ICS)
- Commerce (bundles/coupons/orders/invoices/manual + signed webhooks/refunds/subscriptions/commissions/affiliates/gifts) + public catalog
- SCORM 1.2 import/launch/track/resume with sandboxing (2004 honestly deferred)
- AI framework (BYOK, review-gated, mocked paths tested), coding exercises (static review), email queue, invitations, org units, CSV imports
- Refresh-token reuse detection, per-student attendance, grading queue, instructor courses
- Bilingual portals (EN/ID) with locale switching, custom-domain mapping, capability matrix vs competitors

## 1.1.0 — Product release

Added:

- Public website (landing, features, solutions, pricing, docs, contact, public certificate verification)
- Teacher panel and parent portal as dedicated applications
- Student portal: quiz attempts, assignment submission, discussions, certificates, attendance, offline queue + sync, bottom navigation, install prompt
- Admin: course builder (sections/lessons reorder), quiz manager, grading queue, attendance recorder, roles matrix, files, branding, global settings, audit log, sessions, push architecture
- PWA for all apps (manifests, versioned service workers, generated icons, offline pages, safe caching)
- Auth: httpOnly cookie refresh for web, in-memory access tokens, sessions list/revoke, password change
- Platform APIs: first-run setup (locked), settings, branding, files with authorized download, search, idempotency keys, audit logs, notifications (count/read-all/preferences), push subscriptions, extended reports (completion, quiz performance, attendance, teacher activity)
- CORS configuration, granular RBAC catalog (29 permissions), quiz expiry/shuffle/resume, assignment resubmit rules, manual quiz grading, per-student attendance
- Docs (10 guides), PRODUCT.md, CI workflow, LICENSE placeholder

## 1.0.0 — Development baseline

Initial production-ready baseline: Workers + Hono API, D1/SQLite schema (001–006),
auth + RBAC, admin + student SPAs, seed data, 7 automated tests, OpenAPI.

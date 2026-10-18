# Changelog

## Unreleased — finalization audit fixes (HEAD d73c6b9 + tree)

### Round 6 (2026-10-18; regression tests: 12 new Playwright specs, 28 tests)

- Residue E2E closure: every portal route now has real-browser coverage —
  admin live (schedule/reschedule/attendance/cancel + .ics), data imports
  (CSV dry-run + job detail), AI config/mock job/review-approve, invites
  full loop (create → accept → login), orgs manage (create/member/brand),
  roles remap (with guaranteed restore), dashboard vs summary, attendance
  with notes, discussions tab, bundles/coupons/affiliates/plans,
  payouts approve+reject, revenue cards, global search, reports + CSV
  download, alerts run+dismiss, notifications mark-read, system status,
  email queue+log-driver send, exercises tab, teacher cohorts/AI/profile
  (password round-trip on fixture), student live/programs/tutor/SCORM/
  assignment-submit/exercise-submit/bundle-buy/plan-buy/gift-loop.
- Real product bug fixed: protected downloads (CSV exports, file downloads,
  .ics) via bare navigation always 401'd (no token on navigations) — new
  shared `downloadFile()` helper (memory-first token + blob URL) in
  `@lms/ui`, wired into all three spots, proven by download-event tests
  with byte-level assertions.
- Real UX gap closed: teacher profile password change now browser-covered
  (fixture user, new-works/old-dead, seed creds untouched).

Evidence (round 6, re-verified end-to-end):

- 168/168 API tests green (30 files, unchanged count — round 6 is
  E2E + fixes), Playwright **70/70** chromium (42 + 28 new, zero flakes),
  typecheck/lint/format:check/contract (181 refs)/static-audit/audit
  green, build green, `npm audit --omit=dev` 0 vulns
- Source-derived inventory: 268 endpoints (266 invoked), 189 e2e-invoked,
  9,731 call-sites, 108 tables; sole zero-invocation endpoint remains the
  pre-existing `GET /reports/completion` (documented matcher blind spot)

### Round 5 (2026-10-18; regression tests: `test/roster-defaults.test.ts`,

`e2e/portal-admin-assess.spec.ts`, `e2e/teacher-more.spec.ts`,
`e2e/portal-family.spec.ts`, `e2e/portal-admin-ops.spec.ts`)

- New audited teardown endpoint `DELETE /users/:id/parent-links/:studentId`
  (org/organization_admin only; linked parent and teachers get 403; honest
  404 on repeat) — closes the parent revoked-link gap end to end.
- Three real product bugs found by the new browser specs and fixed:
  1. New quiz questions all defaulted to `position: 0` (colliding slots);
     creates now append at MAX(position)+1 when the caller omits it
     (explicit positions still honored).
  2. Admin gradebook list defaulted to the viewer's own grades, so an admin
     saw an empty roster after recording a grade; unfiltered
     `GET /grades?course_id=` now returns the roster for teaching/admin
     actors (student/parent self-or-linked semantics unchanged).
  3. Same self-default in `GET /certificates`: org-filtered roster for
     teaching/admin actors; students/parents unchanged.
- One real auth bug: admin multipart uploads (files, SCORM, imports) read
  only the `lms-token-fallback` localStorage key, which is empty in normal
  sessions → every upload 401'd. All three pages now use the memory-first
  `getAccessToken()` (exported via admin lib).
- One real runtime bug: SCORM upload was 100% broken outside vitest —
  `await import('jszip')` exposes `loadAsync` on `.default` under tsx-style
  loaders (vitest flattens it onto the namespace), so every real upload
  failed as "Unrecognized ZIP archive" while unit tests stayed green.
  `loadZip` is now interop-tolerant; proven by a real hand-built 1.2 package
  import through the browser (plus honest rejection of a non-zip).
- 13 new real-browser specs: admin quizzes/assignments/gradebook/certs,
  teacher students/live/exercises, student grades+certs, parent
  link→revoke→empty-state, admin announcements/files/global-settings/audit,
  SCORM import.

Evidence (round 5, re-verified end-to-end):

- 168/168 API tests green (164 + 1 parent-link revoke + 3 roster/append
  pins), Playwright 42/42 chromium (29 + 13 new, zero flakes this run),
  typecheck/lint/format:check/contract (181 refs)/static-audit/audit green,
  build green, `npm audit --omit=dev` 0 vulns
- Source-derived inventory: 268 endpoints (266 invoked), 151 e2e-invoked,
  8,328 call-sites, 108 tables; sole zero-invocation endpoint remains the
  pre-existing `GET /reports/completion` (documented matcher blind spot)

### Round 4 (2026-10-18; regression tests: `test/resource-deletes.test.ts`,

`e2e/portal-admin-tabs.spec.ts`, `e2e/teacher-workflows.spec.ts`,
`e2e/student-workflows.spec.ts`)

- Resource lifecycle teardown: five new audited DELETE endpoints —
  `DELETE /cohorts/:id` + `DELETE /programs/:id` (org_admin/super_admin;
  members/course links cascade), `DELETE /question-banks/:id` (teaching
  actors; bank questions/options cascade, per-attempt snapshots untouched),
  `DELETE /attendance/sessions/:id` (teaching actors; records cascade),
  `DELETE /discussions/:threadId` (teaching-actor moderation; replies
  cascade; students/parents — even thread authors — get 404/403). All
  registered in OpenAPI; second delete returns honest 404.
- Matching UI affordances (in-app confirm dialogs, no native confirm):
  admin cohorts tab (cohort + program delete), teacher banks (bank delete)
  and attendance (session delete). Student discussion deliberately has no
  delete button (server RBAC proven by the 403 assertion instead).
- Real bug found by the new E2E and fixed: overlapping settings renders
  could let a STALE branding fetch paint last and clobber fresher data
  (trace-proven: PUT 200, fresh GET with footer, DOM still old). Fix:
  generation guard in `renderOrgSettings` (only the latest started render
  may paint) + the spec now syncs on the PUT response and proves
  persistence after reload.
- New real-browser specs (8 tests): admin cohorts/programs/branding-merge,
  teacher banks/grading-queue/attendance, student discussion/shop-buy with
  manual-payment claim (order stays `pending`, no enrollment until admin
  confirm — the paid gate stays honest).

Evidence (round 4, re-verified end-to-end):

- 164/164 API tests green (159 + 5 new), Playwright 29/29 chromium
  (21 + 8 new; 2 pre-existing specs flaky once under full-suite load, pass
  on retry + standalone green — documented cold-load class, not a
  regression), typecheck/lint/format:check/contract (181 refs)/static-audit/
  audit green, build green, `npm audit --omit=dev` 0 vulns
- Source-derived inventory: 267 endpoints (265 invoked), 132 e2e-invoked,
  7,325 call-sites, 108 tables; only zero-invocation endpoint remains the
  pre-existing `GET /reports/completion`

### Round 3 (2026-10-17; regression tests: `test/cron-maintenance.test.ts`,

`test/quiz-copy-purge.test.ts`, `test/program-lock.test.ts`,
`e2e/admin-payment-confirm.spec.ts`)

- Native Workers Cron scheduler ships in the Worker (`scheduled` handler +
  `[triggers]` in `wrangler.toml`): daily 00:00 Asia/Jakarta runs AI retention
  purge (per-org `retention_days`, default 30) and publishes draft courses
  whose `publish_at` arrived (approval workflow takes precedence); the 1st of
  the month additionally resets AI monthly quotas. Every run writes
  `sys.cron.*` audit rows (NULL actor) and one structured log line; failures
  throw so the Dashboard shows failed cron events; `CRON_DISABLED=1` is a
  documented kill switch. External scheduler procedures remain as fallback.
- Attempt question-copy purge closes the storage-accumulation P2: opt-in org
  policy `organizations.settings.quiz_copy_retention_days` (default off),
  enforced daily by the cron and on demand via the new privileged, audited
  `POST /quizzes/copies/purge` (window 1..3650 days). Templates and active
  attempts are never touched; orgs without the setting never purge.
- Program locks are now enforced on `POST /enrollments`: enrolling into a
  program-placed course whose prior program course is unfinished fails with
  `PROGRAM_LOCKED` (previously advisory-only). Privileged direct inserts
  (cohort, commerce fulfillment, imports) stay documented bypasses.
- New real-browser spec: admin trades the manual-payment Confirm button in
  `#/commerce` (dialog, no native confirm) and the server state is
  re-verified (payment → `paid`, order → `paid`, enrollment active). The
  button was previously API-verified only.

Evidence (round 3, re-verified end-to-end):

- 159/159 API tests green (149 + 10 new), Playwright 21/21 chromium,
  typecheck/lint/format:check/contract/static-audit/audit green, build green,
  `npm audit --omit=dev` 0 vulns
- Source-derived inventory: 262 endpoints (260 invoked), 105 e2e-invoked,
  6,379 call-sites, 108 tables

### Round 2 (2026-10-16; each with a regression test in `test/release2-fixes.test.ts`)

- Quiz pool draws are now per-attempt (`attempt_id`-scoped copies): concurrent
  attempts can no longer corrupt each other, the pool template survives
  (migration 024), player fetches `?attempt_id=…`, attempt history immutable,
  per-question analytics cover shared items only
- Org file browsing/download is role-scoped (teaching/admin see all;
  students/parents see only their own uploads; owners always)
- Login has per-account lockout (5 failures → 15-min 423, reset on success;
  unknown emails stay generic 401)
- First-run setup is single-winner under concurrency (atomic claim, stale
  claims recoverable after 5 min); setup passwords capped at 128 chars
- Org storage quota enforced when `organizations.settings.storage_quota_bytes`
  is set (unset/invalid = unlimited; uploads + SCORM return 413 over quota)
- Orders list exposes `pending_payment_id`; admin commerce renders a Confirm
  button for pending manual payments (server re-validates on confirm)
- New real-browser spec: student multi-select quiz submit via UI scores 100
  (server state re-verified)

### Round 1 (2026-10-11; each with a regression test in `test/release-fixes.test.ts`)

- Quiz question reads no longer leak `is_correct` to parents (treated as
  unprivileged readers, same as students; teachers unaffected)
- Password reset + invitation accept reject oversized passwords (>128 chars,
  PBKDF2 burn guard; valid lengths unaffected, invite token not consumed by
  rejected attempts)
- Archived courses refuse new student enrollments (`ENROLLMENT_CLOSED`;
  teacher manual placement bypasses; draft stays enrollable per suite-encoded
  behavior)
- Waitlist promote re-checks capacity (`COURSE_FULL` instead of silent
  overfill); enrollment has a post-insert capacity guard against
  check-then-insert races
- Quiz scoring divides by the whole quiz (skipped questions score zero, no
  inflation) in both auto-submit and manual regrade
- `multiple_choice` accepts `option_ids[]` with exact-set scoring; student
  portal renders checkboxes for multi-select (autosave/restore included)
- ICS export uses stable per-session UIDs (no more calendar duplicates)
- SCORM upload persists the original archive so `file_key`/files rows resolve
- Offline queue is now per-user isolated (owner-tagged actions, scoped flush;
  shared devices can no longer replay one user's writes as another)
- Public-site portal links configurable via `VITE_PORTAL_*` build env
  (localhost remains dev default; `localStorage.portal-urls` override kept)

Evidence (round 2, re-verified end-to-end):

- 149/149 API tests green (143 + 6 new), Playwright 20/20 chromium,
  typecheck/lint/format/contract/static-audit/audit green, build green
- bench 6/6 budgets met (seeded disposable DB), scale 1500/4500 green,
  `npm audit --omit=dev` 0 vulns, migrations 001→024 idempotent on
  disposable copy, `PRAGMA integrity_check` ok / 0 FK violations / 0 orphans
  (10 checks) on the local DB
- Source-derived inventory: 261 endpoints (259 invoked), 105 e2e-invoked,
  6,151 call-sites, 108 tables, 24 migrations

Evidence (round 1):

- 143/143 API tests green (134 existing + 9 new), Playwright 19/19 chromium,
  typecheck/lint/format/contract/static-audit/audit green, build green
- bench 6/6 budgets met (seeded disposable DB), scale 1500/4500 green,
  `npm audit --omit=dev` 0 vulns, migrations 001→023 idempotent on
  disposable copy, `PRAGMA integrity_check` ok / 0 FK violations / 0 orphans
  (10 checks) on the local DB
- Source-derived inventory: 261 endpoints (259 invoked), 105 e2e-invoked,
  5,915 call-sites, 108 tables, 23 migrations

## 1.11.0 — LMS completion release (LMS scope only)

Learning workflows:

- Course instructor assignment API (`GET/POST/DELETE
/courses/:id/instructors`, privileged, member+role validated, audited) —
  teacher portal visibility is assignment-scoped as documented
- Quiz autosave completed end-to-end (API + student debounced save +
  draft restore; legacy single-item shape accepted; shadow duplicates
  removed)
- Public password recovery pages (`#/forgot`, `#/reset/:token`,
  enumeration-safe messaging)
- Admin user status editing (server reports `ignored` fields) and payout
  approve/reject buttons wired to `decide`
- AI quota reset endpoint (`POST /ai/usage/reset`) + external-scheduler
  procedure

Reliability & security:

- Hashchange router races fixed (serialized navigation in all 5 portals —
  found via real-browser CRUD)
- Stored URLs restricted to `http(s)` at validation (lessons, live
  sessions) + `esc()` on remaining sinks incl. admin login errors
- Conditional money transitions, commission unique index (023), rate
  sanitization, webhook amount-match, cohort-gift grants

UX & i18n:

- 60+ teacher/admin/student strings moved to en/id dicts; quiz reorder
  labeled; all blocking `prompt()`/`confirm()`/`alert()` replaced with
  modal/confirm/toast patterns (`#/reports` export, roles editor, shop,
  discussions, SCORM bookmark, DNS verification)

Evidence:

- 134 API tests green, Playwright 19/19 (4 real-browser portal CRUD flows),
  bench + scale green, backup/restore drilled PASS, integrity ok / 0 FK
  violations
- Source-derived inventory: 261 endpoints (259 invoked), 105 e2e-invoked,
  5,690 call-sites, 108 tables, 23 migrations
- Full `reports/audit/` dossier (local-baseline, lms-feature-matrix,
  browser-workflows, security-results, integration-status, remaining-gaps);
  score 93/100, CONDITIONALLY READY

## 1.10.0 — Verified hardening release

Security:

- Remaining `esc()` sinks closed (admin shell/quizzes, teacher live panel,
  student progress attrs, centralized `errorHtml`/`tableHtml` in admin lib);
  `xss-escape.test.ts` extended
- Webhook `gross_amount` matched against the order total (402
  `AMOUNT_MISMATCH` on underpayment; caught a wrong-amount E2E vector)
- Conditional transitions on payment-confirm/refund/payout-decide (409 on
  lost races); commissions structurally idempotent via unique
  `(order_id, instructor_id)` index (023); invoice fulfill races tolerated
- Subscription prices reject negatives; affiliate rates validated 0–100;
  garbage `tax_rate`/`commission_rate` settings sanitized at read (NaN-proof)
- Cohort gift redemption now grants cohort + membership + courses (was burned)

Features completed (were documented gaps):

- Quiz autosave end-to-end: `PUT`/`GET /quiz-attempts/:id/autosave`
  (owner-only, expiry + question-scope guards, both batch and legacy
  single-item shapes), student debounced save + draft restore; shadowed
  duplicates in `banks.ts` removed
- Public password recovery UI (`#/forgot`, `#/reset/:token`, enumeration-safe)
- Admin user status editing (server reports `ignored` fields instead of
  silent drops); payout approve/reject buttons wired to `decide`
- AI quota reset endpoint (`POST /ai/usage/reset`) + external-scheduler
  procedure in `docs/ai.md`
- Teacher/student/admin i18n pass (60+ strings to en/id dicts); all native
  `prompt()`/`confirm()`/`alert()` replaced with modal/confirm/toast patterns

Evidence:

- 132 API tests green, Playwright 15/15 (auth, recovery, autosave journeys
  added), bench + scale green, backup/restore drilled PASS
- Source-derived inventory: 258 endpoints (256 invoked + 2 verified via
  interpolation), 101 e2e-invoked, 4,798 call-sites, 108 tables, 23 migrations
- Full `reports/audit/` dossier refreshed; score 90/100

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

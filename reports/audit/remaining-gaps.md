# Remaining gaps (LMS scope only; commerce/affiliate expansion excluded)

## Closed this session (removed from gap list)

Quiz autosave E2E, public forgot/reset UI, admin status editing, payout
decide buttons, AI quota-reset endpoint + scheduler procedure, instructor
assignment API + UI wiring path, blocking native dialogs, teacher i18n
worst-offenders, router navigation races, `javascript:` URL storage.

Closed 2026-10-18 (round 6; 11 new Playwright specs, 28 tests,
Playwright 70/70 total):

- Residue E2E closure: admin live (schedule/reschedule/attendance/cancel
  - .ics), data imports (CSV dry-run + job detail), AI config/mock
    job/review-approve, invites full loop, orgs manage, roles remap (with
    restore), dashboard vs summary, attendance-admin with notes, discussions
    tab, bundles/coupons/affiliates/plans, payouts approve+reject, revenue,
    global search, reports + CSV, alerts run+dismiss, notifications
    mark-read, system status, email queue+send, exercises tab, teacher
    cohorts/AI/profile, student live/programs/tutor/SCORM/submits/shop
    edges. Every portal route now has real-browser coverage.
- Authenticated downloads (real bug): CSV/file/.ics navigation downloads
  always 401'd — shared `downloadFile()` helper + 3 wirings, byte-proven.

Closed 2026-10-18 (round 5; `test/roster-defaults.test.ts` 3/3,
`test/resource-deletes.test.ts` 6/6, `e2e/portal-admin-assess.spec.ts`
4/4, `e2e/teacher-more.spec.ts` 3/3, `e2e/portal-family.spec.ts` 2/2,
`e2e/portal-admin-ops.spec.ts` 4/4, Playwright 42/42 total):

- Parent-link revoke (new): audited `DELETE
/users/:id/parent-links/:studentId` (admin-only; parent/teacher 403;
  404 on repeat) + family E2E (link → visible → revoke → empty state).
- Question position collision (real bug): creates omitted-position now
  append at MAX+1 (explicit positions honored).
- Grades/certificates self-default rosters (real UX bugs): unfiltered
  reads return the roster for teaching/admin actors; student/parent
  semantics unchanged (API-pinned).
- Admin multipart upload 401s (real auth bug): files/SCORM/imports pages
  use the memory-first token.
- SCORM jszip interop (real runtime bug): uploads failed everywhere
  except under vitest; loader now interop-tolerant, proven by a real 1.2
  package import through the browser.

Closed 2026-10-18 (round 4; `test/resource-deletes.test.ts` 5/5,
`e2e/portal-admin-tabs.spec.ts` 3/3, `e2e/teacher-workflows.spec.ts` 3/3,
`e2e/student-workflows.spec.ts` 2/2, Playwright 29/29 total):

- Resource lifecycle teardown (new): audited `DELETE /cohorts/:id`,
  `DELETE /programs/:id`, `DELETE /question-banks/:id`,
  `DELETE /attendance/sessions/:id`, `DELETE /discussions/:threadId`
  with per-resource RBAC (cohort/program admin-only; bank/session teaching
  actors; thread teaching-actor moderation — student authors 403), FK
  cascades verified row-count, honest 404 on re-delete, OpenAPI
  registered; admin cohorts tab + teacher banks/attendance gained matching
  in-app-confirm delete buttons.
- Stale-render race in admin settings (real bug, trace-proven): overlapping
  branding renders could paint stale data last after a save. Fixed with a
  generation guard in `renderOrgSettings` (latest started render wins; no
  business-behavior change); spec syncs on the PUT response and proves
  persistence after reload.

Closed 2026-10-17 (branch `feat/finalization-audit`, HEAD 5ca54fb, round 3;
`test/cron-maintenance.test.ts` 5/5, `test/quiz-copy-purge.test.ts` 3/3,
`test/program-lock.test.ts` 2/2, `e2e/admin-payment-confirm.spec.ts` green):

- No external scheduler needed (now ALREADY ships in-repo): the Worker's
  native Scheduled handler runs AI retention purge, due-dated course
  publishing, monthly AI quota reset, and the new opt-in attempt-copy purge
  daily/monthly at 00:00 Asia/Jakarta (`sys.cron.*` audit rows, structured
  log line, `CRON_DISABLED` kill switch, failures throw for dashboards).
- Attempt question-copy accumulation (P2): opt-in per-org
  `quiz_copy_retention_days` + audited manual endpoint
  `POST /quizzes/copies/purge`; templates + active attempts never touched.
- Program locks enforced on `POST /enrollments` (`PROGRAM_LOCKED`);
  privileged direct inserts (cohort/commerce/imports) stay documented
  bypasses; applied after (unchanged) course-prereq enforcement.
- Admin manual-payment confirm now has real-browser proof: click → dialog →
  server re-verified (`payment paid`, `order paid`, enrollment active).

Closed 2026-10-16 (HEAD d73c6b9 + tree, `test/release2-fixes.test.ts` 6/6
green, `e2e/student-multiselect.spec.ts` browser-green):

- Quiz pool first-attempt race + template deletion (now per-attempt
  `attempt_id`-scoped snapshots via migration 024; pools reusable).
- Org-wide file listing/download (now role-scoped; owners keep access).
- Login without per-account brake (now 5-failures → 15-min lockout).
- Concurrent fresh-DB setup double-provision (now atomic single-winner
  claim with stale recovery).
- Missing upload quota mechanism (now org-level `storage_quota_bytes`,
  default-off, enforced on uploads + SCORM).
- Admin manual-payment confirm dead-end in UI (now Confirm button wired to
  the verified `/payments/:id/confirm` endpoint).
- Multi-select checkbox UI without browser proof (now real-click E2E scoring
  100 with server re-verification).

Closed 2026-10-11 (HEAD d73c6b9 + tree, `test/release-fixes.test.ts` green):

- Parent answer-key leak on quiz question reads (now label-only).
- Oversized-password PBKDF2 burn on reset/invitation-accept (128-char cap).
- Archived-course open enrollment (students blocked; teacher bypass kept).
- Waitlist promote overfill + enrollment capacity race (re-check + post-insert
  guard; underfill-safe direction).
- Quiz denominator inflation on skips (whole-quiz total in submit + regrade).
- `multiple_choice` unanswerable (new `option_ids[]` exact-set scoring +
  student checkbox UI with autosave/restore).
- ICS UID regeneration per export (stable `live-<id>` UIDs).
- SCORM `file_key`/files rows dangling (original archive now persisted).
- Offline queue global key (per-user owner tagging + scoped flush).
- Public-site portal links localhost-only (new `VITE_PORTAL_*` build env).

## Still open (with reason + next action)

Closed in round 9 (2026-10-23; `test/round9-hardening.test.ts` 8/8,
`test/round9b-properties.test.ts` 6/6, axe 7/7, full E2E 81/81):

- Retention sweeps for every unbounded table (audit, notifications,
  email queue, idempotency) + manual super_admin trigger + data-retention doc.
- Magic-byte upload verification (fuzzing caught a real MZ-as-image bypass),
  zip-bomb ratio guard, bounded rate-limit map, strict boot secrets,
  cron durations, status latency/storage, opt-in slow log, docs CSP,
  audit-secret static rule.
- Bench p99/concurrency/auto-boot + k6 shape; E2E helpers consolidated
  (identical behavior, suite re-run green); warm-up kills cold-boot flakes.
- Axe a11y suite: role=img previews, tag-pill, shared contrast.css for badge/
  outline-button contrast; skip links, roving tablist, RTL visual baseline.

1. Per-route browser CRUD: CLOSED (81/81 — incl. 7 axe a11y specs with
   authenticated commerce, keyboard tablist nav; 6 visual baselines opt-in).
   Deliberately un-automated:
   vendor OAuth, live sends, live cron execution on a real deploy
   (BLOCKED_EXTERNAL by design; now observable via `GET /system/cron-status`
   and `npm run drill`).
2. Live-provider credentials (Midtrans-live, SMTP, VAPID-send, OpenAI key,
   Zoom/Meet OAuth, R2/KV bindings, sandbox) — owner-supplied; adapters +
   mock tests ship. Cron + drill tooling ships in-repo and is locally verified.
3. Setup multi-instance first boot — CLOSED for code: KV distributed lock when
   bound + DB atomic claim fallback (stale 5 min). Live multi-isolate race
   still needs a real deploy to observe.
4. Upload quotas — CLOSED for code: org-level + per-user
   (`per_user_quota_bytes`), both default-off; needs product policy to enforce
   restrictive defaults.
5. Subscriptions — CLOSED for code: free auto-renew, paid past_due, buyer/
   privileged cancel, renew-due trigger + daily cron. Live money movement
   stays provider-driven by design.
6. Order cancel — CLOSED: `POST /orders/:id/cancel` (pending → cancelled).
7. xAPI retention — CLOSED for code: privileged purge endpoint + opt-in
   `xapi_retention_days` cron (default off).
8. R2 restore — CLOSED for tooling: `npm run drill` PASS locally
   (integrity ok, 0 FK violations, inventory); R2-bound inventory path
   documented for post-deploy runs.
9. LICENSE — CLOSED: proprietary commercial (owner-selected 2026-10-22).
10. SCORM 2004 sequencing, H5P runtime — CLOSED round 8: sequencing metadata
    - linear-flow contract + detail endpoint; H5P minimal native runtime
      (upload/serve/attempts/scores). Full ADL choice/jump/rollup sequencing
      and the H5P editor suite stay documented roadmap (no false claims).
11. RTL/Arabic — CLOSED round 8 for layout (`ar` dicts, `dir`/`lang`
    switching, API `lang=ar` fallback, visual AR baseline); full long-form
    Arabic copy stays incremental (chrome translated, content falls back).
12. Perf numbers are local-dev only — no production capacity claims; budgets
    - scale fixtures green, drill PASS.
13. Question-copy purge removes copies **and their answer rows** (cascade)
    for finished attempts past the org's opt-in window — by policy, default off.

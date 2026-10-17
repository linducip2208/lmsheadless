# Remaining gaps (LMS scope only; commerce/affiliate expansion excluded)

## Closed this session (removed from gap list)

Quiz autosave E2E, public forgot/reset UI, admin status editing, payout
decide buttons, AI quota-reset endpoint + scheduler procedure, instructor
assignment API + UI wiring path, blocking native dialogs, teacher i18n
worst-offenders, router navigation races, `javascript:` URL storage.

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

1. Per-route browser CRUD for all admin tabs and teacher/student actions —
   API-covered; needs Playwright expansion (top E2E backlog). The admin
   payment-confirm button is now browser-covered (round 3); other routes
   remain API-verified only.
2. Live-provider credentials (Midtrans-live, SMTP, VAPID-send, OpenAI key,
   Zoom/Meet OAuth, R2/KV bindings, sandbox) — owner-supplied; adapters +
   mock tests ship. The cron's production execution needs a real
   `wrangler deploy` (in-repo handler is fully tested).
3. Setup multi-instance first boot — atomic claim covers single-instance
   concurrency; distributed lock still needs KV/DO or serialized deploy hook.
4. Per-user upload quota granularity and restrictive defaults — org-level
   mechanism ships default-off; needs product policy to enforce.
5. Subscriptions: no auto-renewal/charge/cancel linkage — labeled
   point-in-time records.
6. SCORM 2004 sequencing, H5P runtime — documented gaps, no false claims.
7. R2 restore undrilled on live bindings — local drill PASS only.
8. LICENSE unresolved (owner decision; file is an explicit notice, not a
   license grant) — flagged, never auto-chosen.
9. Remaining hardcoded strings outside dicts + no full RTL pass — tracked.
10. Perf numbers are local-dev only — no production capacity claims.
11. Question-copy purge removes copies **and their answer rows** (cascade)
    for finished attempts past the org's opt-in window — attempt scores and
    totals are unaffected, but per-question review/answer history for
    purged rows is gone BY POLICY; orgs must choose the retention days
    consciously (default off = nothing is ever purged).

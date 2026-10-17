# Remaining gaps (LMS scope only; commerce/affiliate expansion excluded)

## Closed this session (removed from gap list)

Quiz autosave E2E, public forgot/reset UI, admin status editing, payout
decide buttons, AI quota-reset endpoint + scheduler procedure, instructor
assignment API + UI wiring path, blocking native dialogs, teacher i18n
worst-offenders, router navigation races, `javascript:` URL storage.

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
   API-covered; needs Playwright expansion (top E2E backlog; e.g. the new
   admin payment-confirm button is API-verified only).
2. Live-provider credentials (Midtrans-live, SMTP, VAPID-send, OpenAI key,
   Zoom/Meet OAuth, R2/KV bindings, sandbox) — owner-supplied; adapters +
   mock tests ship.
3. AI quota/retention need an external scheduler (cron/Workers Cron Trigger
   calling documented endpoints) — procedure written, no in-app runner.
4. Setup multi-instance first boot — atomic claim covers single-instance
   concurrency; distributed lock still needs KV/DO or serialized deploy hook.
5. Per-user upload quota granularity and restrictive defaults — org-level
   mechanism ships default-off; needs product policy to enforce.
6. Program locks advisory (direct enrollment bypasses order) — enforce or
   keep labeled guidance.
7. Subscriptions: no auto-renewal/charge/cancel linkage — labeled
   point-in-time records.
8. SCORM 2004 sequencing, H5P runtime — documented gaps, no false claims.
9. R2 restore undrilled on live bindings — local drill PASS only.
10. LICENSE unresolved (owner decision; file is an explicit notice, not a
    license grant) — flagged, never auto-chosen.
11. Remaining hardcoded strings outside dicts + no full RTL pass — tracked.
12. Perf numbers are local-dev only — no production capacity claims.
13. Attempt-scoped question copies accumulate per attempt (no purge job;
    cascade on quiz delete; monitor storage on heavily-pooled quizzes) — P2.

# Remaining gaps (LMS scope only; commerce/affiliate expansion excluded)

## Closed this session (removed from gap list)

Quiz autosave E2E, public forgot/reset UI, admin status editing, payout
decide buttons, AI quota-reset endpoint + scheduler procedure, instructor
assignment API + UI wiring path, blocking native dialogs, teacher i18n
worst-offenders, router navigation races, `javascript:` URL storage.

## Still open (with reason + next action)

1. Per-route browser CRUD for all admin tabs and teacher/student actions —
   API-covered; needs Playwright expansion (top E2E backlog).
2. Live-provider credentials (Midtrans-live, SMTP, VAPID-send, OpenAI key,
   Zoom/Meet OAuth, R2/KV bindings, sandbox) — owner-supplied; adapters +
   mock tests ship.
3. AI quota/retention need an external scheduler (cron/Workers Cron Trigger
   calling documented endpoints) — procedure written, no in-app runner.
4. Setup concurrent-run lock — needs KV/DO or serialized deploy hook.
5. Per-user upload quota — needs product policy + counters.
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

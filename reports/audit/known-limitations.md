# Known limitations (explicitly NOT claimed)

Closed in 1.10.0 (removed from this list): quiz autosave, public
forgot/reset UI, admin status editing, payout decide buttons, AI quota-reset
mechanism + procedure, blocking native dialogs (all replaced), teacher i18n
worst-offenders.

1. Per-portal browser CRUD (admin/teacher/student/parent SPAs) is covered at
   API-contract level, not by per-route browser tests.
2. Live provider verification pending: Midtrans merchant, SMTP/HTTP email
   delivery, web-push send, openai-compatible key, Zoom/Meet OAuth, code
   sandbox (refused by design until configured).
3. Subscriptions have no automated renewal/charge/cancel; no order-cancel
   endpoint; program locks are advisory (direct enrollment bypasses order).
4. SCORM 2004 sequencing not interpreted; no H5P runtime; no URL-allowlist
   for external lessons (stored links only).
5. AI monthly quota has no auto-reset job; retention purge is a manual
   privileged endpoint (schedule it externally).
6. No per-user upload quota; no concurrent-setup distributed lock; AI keys
   recoverable by DB holders (protect backups).
7. Cascade-delete clauses exist but are unreachable via the API (soft deletes
   only); changing them needs table rebuilds.
8. R2 object-inventory restore not drilled locally; D1 production backup
   behavior must be verified post-deploy.
9. Remaining hardcoded UI strings outside en/id dicts (teacher most); no
   full RTL pass; `prompt()`/`confirm()` used in shop/discussion flows.
10. Bench numbers are local-dev only; no production capacity claims.

# Known limitations (explicitly NOT claimed)

Closed in 1.10.0 (removed from this list): quiz autosave, public
forgot/reset UI, admin status editing, payout decide buttons, AI quota-reset
mechanism + procedure, blocking native dialogs (all replaced), teacher i18n
worst-offenders.

1. Per-portal browser CRUD: CLOSED in round 6, extended rounds 8–9 — 27 spec
   files / 81 tests + 6 visual baselines cover every portal route, the
   round-7 lifecycle, and WCAG AA (axe incl. authenticated commerce) with
   server re-verification; only vendor OAuth, live sends, and live cron
   execution stay un-automated (BLOCKED_EXTERNAL by design).
2. Live provider verification pending: Midtrans merchant, SMTP/HTTP email
   delivery, web-push send, openai-compatible key, Zoom/Meet OAuth, code
   sandbox (refused by design until configured).
3. Subscriptions have no automated renewal/charge/cancel; no order-cancel
   endpoint. Program locks ARE enforced on `POST /enrollments` (round 3;
   `PROGRAM_LOCKED`), but privileged direct inserts (cohort, commerce
   fulfillment, imports) remain documented bypasses.
4. SCORM 2004 sequencing not interpreted; no H5P runtime; no URL-allowlist
   for external lessons (stored links only).
5. The in-worker cron ships and is in-repo tested (round 3); production
   execution starts at `wrangler deploy` and is UNVERIFIED LIVE (kill switch
   documented). xAPI statements have no automatic retention purge (manual
   privileged endpoint only — no invented policy).
6. No per-user upload quota; no concurrent-setup distributed lock; AI keys
   recoverable by DB holders (protect backups).
7. Cascade-delete clauses exist but are unreachable via the API (soft deletes
   only); changing them needs table rebuilds.
8. R2 object-inventory restore not drilled locally; D1 production backup
   behavior must be verified post-deploy.
9. Remaining hardcoded UI strings outside en/id dicts (teacher most); no
   full RTL pass; `prompt()`/`confirm()` used in shop/discussion flows.
10. Bench numbers are local-dev only; no production capacity claims.

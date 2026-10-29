# ADR 004 — Growth tables are retained by default; purges are opt-in

Status: accepted (2026-10-22, round 7/9).

Context: audit logs, notifications, email queue, and attempt copies grow
forever. Silent auto-deletion destroys evidence and breaks the "default safe"
promise.

Decision: no purge runs without an explicit opt-in setting
(`quiz_copy_retention_days`, `xapi_retention_days`, `audit_log_retention_days`,
`notification_retention_days`, `email_retention_days`; all default off).
Idempotency keys are the single exception: fixed 7-day window, because
replays past a week are re-executions, never silent duplicates. Purges are
audited and prefer preserving user-visible state (unread notifications and
queued emails are never touched).

Consequences: hosts must consciously choose windows; `POST
/system/retention/purge` and the daily cron share the same functions.

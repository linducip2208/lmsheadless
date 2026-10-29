# ADR 005 — Maintenance runs on the Workers cron trigger

Status: accepted (2026-10-17, round 3).

Context: retention purges, quota resets, and due-dated publishing needed a
scheduler; an external cron was a documented install burden.

Decision: the Worker's native `scheduled` handler runs all maintenance
(`CRON_DAILY`/`CRON_MONTHLY`, kill switch `CRON_DISABLED=1`). Failures throw
so the Cloudflare dashboard shows failed cron events. Every job is idempotent
(second runs change nothing) and writes `sys.cron.*` audit rows, observable
via `GET /system/cron-status` without dashboard access.

Consequences: production execution still starts at first `wrangler deploy`;
external-scheduler procedures remain only as fallback documentation.

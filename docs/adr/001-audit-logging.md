# ADR 001 — Every state-changing endpoint writes an audit row

Status: accepted (2026-10-09, re-affirmed round 8).

Context: multi-tenant LMS with money movement, grading, and certificates —
disputes ("who refunded this order?") need answers without DB forensics.

Decision: every privileged mutation calls `audit()` (actor, org, action,
entity, metadata ≤4000 chars, IP, request id). Audit failures never break
the primary action (try/catch). Reads never audit (volume).

Consequences: `audit_logs` grows unbounded → see ADR 004 (opt-in retention,
default off). `system.cron.*` rows give cron observability for free via
`GET /system/cron-status`.

# Changelog

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

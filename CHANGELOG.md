# Changelog

## 1.2.0 — Enterprise release

Added (all with tests + docs + portal UI):

- Advanced authoring (tags, prerequisites, drip, windows/capacity/waitlists, duplication, versions, approvals, CSV export)
- Question banks, pools, matching/ordering/essay, negative marking, cooldowns, autosave, answer-release policies
- Cohorts, programs/paths with locks, competencies; live classes (multi-provider + ICS)
- Commerce (bundles/coupons/orders/invoices/manual + signed webhooks/refunds/subscriptions/commissions/affiliates/gifts) + public catalog
- SCORM 1.2 import/launch/track/resume with sandboxing (2004 honestly deferred)
- AI framework (BYOK, review-gated, mocked paths tested), coding exercises (static review), email queue, invitations, org units, CSV imports
- Refresh-token reuse detection, per-student attendance, grading queue, instructor courses
- Bilingual portals (EN/ID) with locale switching, custom-domain mapping, capability matrix vs competitors

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

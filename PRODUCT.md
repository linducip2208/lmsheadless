# PRODUCT.md — LMS Headless (sellable product sheet)

## Product overview

LMS Headless is an API-first, Cloudflare-native Learning Management System for
schools, academies, training centers, universities and companies. One REST API
serves five purpose-built portals (public site, admin, teacher, student PWA,
parent) and is ready for a Flutter Android/iOS client.

## Feature list (implemented, tested)

- Organizations, users, 6 roles, 29 granular permissions (server-enforced)
- Academic: years, terms, classes, class members, subjects
- Courses: categories, tags, instructors, sections, lessons (text/video/document/image/external), ordering, drafts, visibility, enrollment modes, prerequisites, drip, windows/capacity/waitlists, duplication, versions, publish approvals
- Enrollment + deterministic progress + completion certificates (revoke/bulk/expiry)
- Quizzes: banks, pools, 7 question types, shuffle, time limits, cooldowns, attempt limits, expiry, auto + manual grading, negative marking, answer-release policies, autosave
- Assignments: due dates, resubmission rules, submissions, grading + feedback
- Cohorts/batches, programs/learning paths, competencies; live classes (multi-provider)
- Commerce: bundles, coupons, orders (cancel pending), invoices, manual + signed-provider payments, webhooks, refunds, subscriptions (free auto-renew, paid past_due, cancel), commissions, affiliates, gifts
- SCORM 1.2 (+ 2004 import with sequencing metadata + linear-flow player contract); H5P minimal native runtime (upload/launch/track)
- Grades, attendance (sessions/records/reports), announcements, notifications (preferences, push architecture), discussions
- Certificates with public verification page (+ QR-ready verify URLs)
- Reports: organization summary, completion, quiz performance, attendance, teacher activity, student progress, engagement, CSV exports
- Files: validated uploads, authorized downloads (R2 in production), org + per-user quotas, restore drill (`npm run drill`)
- Search, audit logging, activity log, settings, first-run setup (locked), white-label branding + custom domains
- PWA: installable apps, offline shell, safe sync with idempotency keys; RTL layout (Arabic) in all portals
- OpenAPI + human API docs; CORS, rate limiting, request IDs

## Target customers

K-12 schools · tutoring/academy chains · corporate L&D · course creators ·
vocational training · universities (departmental use).

## Installation / hosting requirements

- Self-hosted/dev: Node.js 20+, SQLite (built-in), any static host for portals.
- Managed: Cloudflare account (Workers + D1 + R2 + KV). No other infrastructure.
- Email/SMTP and push (VAPID/FCM) credentials are the customer's own — the
  product documents exactly where to plug them in.

## Included / customization points

Included: all portals, API, PWA, seed demo, docs, CI.
Customization: branding per organization, roles/permissions mapping, course
content model extensions, report additions, portal URLs, theme defaults.
See `docs/customization.md`.

## White-label / API / PWA / Cloudflare

`docs/white-label.md` · `docs/api.md` · `docs/flutter.md` · `docs/pwa.md` ·
`docs/cloudflare.md` · `docs/deployment.md`.

## Support boundaries

Included: installation guidance per docs, defect fixes in covered behavior.
Excluded until contracted: custom feature development, data migration from other
LMS products, managed hosting operations, app-store publishing of the Flutter
client (API-ready, client not included).

## License

Proprietary commercial — one license per production deployment.
See `LICENSE`.

## Changelog

See `CHANGELOG.md` (current: 1.14.0).

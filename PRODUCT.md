# PRODUCT.md — LMS Headless (sellable product sheet)

## Product overview

LMS Headless is an API-first, Cloudflare-native Learning Management System for
schools, academies, training centers, universities and companies. One REST API
serves five purpose-built portals (public site, admin, teacher, student PWA,
parent) and is ready for a Flutter Android/iOS client.

## Feature list (implemented, tested)

- Organizations, users, 6 roles, 29 granular permissions (server-enforced)
- Academic: years, terms, classes, class members, subjects
- Courses: categories, instructors, sections, lessons (text/video/document/image/external), ordering, drafts, visibility, enrollment modes
- Enrollment + deterministic progress + completion certificates
- Quizzes: multiple choice, true/false, short answer; shuffle, time limits, attempt limits, expiry, auto + manual grading
- Assignments: due dates, resubmission rules, submissions, grading + feedback
- Grades, attendance (sessions/records/reports), announcements, notifications (preferences, push architecture), discussions
- Certificates with public verification page
- Reports: organization summary, completion, quiz performance, attendance, teacher activity, student progress
- Files: validated uploads, authorized downloads (R2 in production)
- Search, audit logging, settings, first-run setup (locked), white-label branding
- PWA: installable apps, offline shell, safe sync with idempotency keys
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

Placeholder — final commercial terms must be selected by the product owner.
See `LICENSE`.

## Changelog

See `CHANGELOG.md` (current: 1.1.0).

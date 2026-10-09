# LMS Headless

**An API-first, Cloudflare-native Learning Management System.**
Web + PWA portals, a Flutter-ready REST API, multi-organization tenants, white-label branding.

## What is LMS Headless

A modern LMS for **schools, academies, training centers, universities and companies**.
Everything important is a REST call under `/api/v1`; the web portals are thin,
purpose-built clients — one per role — so a Flutter Android/iOS app can consume
the exact same API.

- 👩‍💼 **Admin panel** — organizations, users, roles & permissions, course builder, quizzes, assignments & grading, attendance, grades, announcements, certificates, files, reports, settings, audit log
- 👩‍🏫 **Teacher panel** — assigned courses, lesson and quiz authoring, grading queue, attendance, student progress
- 🧑‍🎓 **Student portal (PWA)** — courses, lesson player, quizzes, assignment submission, discussions, grades, certificates, offline queue + sync
- 👪 **Parent portal** — linked children only: progress, grades, attendance, announcements
- 🌐 **Public website** — landing, features, solutions, pricing, docs, contact, public certificate verification
- 🔌 **REST API** — `/api/v1`, OpenAPI at `/api/v1/openapi.json`, human docs at `/api/v1/docs`

No fake metrics. No fake integrations. Email/push delivery needs your own
credentials — the architecture is built in, nothing is pretended.

## Screens (portals)

| Portal         | Dev URL               | Purpose                                   |
| -------------- | --------------------- | ----------------------------------------- |
| Public website | http://localhost:5177 | Landing, pricing, docs, `/verify/:number` |
| Admin          | http://localhost:5173 | Full organization management              |
| Teacher        | http://localhost:5175 | Teaching workflow                         |
| Student        | http://localhost:5174 | Learning workflow (installable PWA)       |
| Parent         | http://localhost:5176 | Child monitoring                          |
| API            | http://localhost:8787 | REST + OpenAPI + docs                     |

## Roles

`super_admin` · `organization_admin` · `teacher` · `student` · `parent` · `staff`
— 29 granular permissions (`users.view`, `courses.publish`, `quiz.grade`,
`certificates.issue`, …), enforced **server-side** on every request.
Frontend menus are convenience only, never security.

## Architecture

```
Web + PWA portals ──→ REST /api/v1 ──→ Hono on Cloudflare Workers
                                            ├── D1 (SQLite locally)
                                            ├── R2 (local disk in dev)
                                            └── KV rate limits (memory fallback)
```

Details: `docs/architecture.md`, `docs/cloudflare.md`.

## Quickstart (local development)

```bash
npm install
npm run db:migrate   # builds ./.data/lms.db from migrations/
npm run db:seed      # demo org + users + course + quiz + assignment
npm run dev          # API on :8787
npm run dev:admin    # Admin on :5173 (also: dev:teacher :5175, dev:student :5174, ...)
```

Demo accounts (password `Password123!`, overridable via `SEED_DEMO_PASSWORD`;
**dev/demo only, never production**):
`superadmin@example.com`, `admin@example.com`, `teacher@example.com`,
`student@example.com`, `parent@example.com`, `staff@example.com`.

First-run setup is also available via `POST /api/v1/setup` (locked afterwards).

## SQLite / D1 / R2 / KV

- `migrations/001–007` — SQLite/D1-compatible, ordered; column patches are idempotent.
- Local: file at `$DATABASE_PATH` (default `./.data/lms.db`), `PRAGMA foreign_keys=ON`.
- Production: Cloudflare D1 (`apps/api/wrangler.toml`).
- Files: local disk in dev, R2 in production (`STORAGE_DRIVER=local|r2`).
- Rate limiting: KV in production, memory fallback locally.

Deployment: `docs/deployment.md`.

## Environment variables

Copy `.env.example` to `.env`. Never commit secrets. Key vars: `JWT_SECRET`
(≥32 chars), `DATABASE_PATH`, `STORAGE_DRIVER`, `ALLOWED_ORIGINS` (comma-separated;
localhost is allowed in dev, nothing else by default), `COOKIE_SECURE=1` in
production, `SEED_DEMO_PASSWORD`.

## API

Uniform envelope `{success, data, meta}` / `{success:false, error:{code,message}}`,
pagination (`page, per_page, q, sort, order`), `X-Request-Id`, `Idempotency-Key`
support on writes (safe offline retries), Zod validation on every write endpoint.

Auth: `POST /auth/register|login?cookie=1|refresh|logout`, `GET /auth/me`,
sessions list/revoke, password change, forgot/reset + email-verification
architecture. Short JWT access (15 min, in-memory on web) + rotating opaque
refresh (httpOnly cookie on web, header flow for Flutter/tests).

Full reference: `docs/api.md` · Flutter guide: `docs/flutter.md`.

## PWA

Admin, teacher, student, parent and web apps ship `manifest.webmanifest`,
versioned service workers, generated icons and offline pages. Only the app shell
and explicitly public endpoints (OpenAPI, branding, certificate verification)
are cached — private data is never cached. Pending student actions queue locally
and sync with idempotency keys when back online. Push architecture is ready
(subscriptions API + VAPID config); delivery needs your keys. See `docs/pwa.md`.

## White-label & multi-organization

Each organization configures name, logo, colors, footer and support info via
`PUT /api/v1/organizations/:id`; public-safe branding at
`GET /api/v1/organizations/:id/branding`. Custom domains map via
`POST /api/v1/organizations/:id/domain` (TXT verification; Cloudflare routing
documented in `docs/white-label.md`). Tenant isolation is tested
(org-vs-org, user-vs-user, parent scoping). See `docs/white-label.md`,
`docs/multi-organization.md`.

## Enterprise capabilities (v1.2)

- **Authoring**: tags, prerequisites, drip scheduling, enrollment windows/capacity/waitlists, duplication, versions, publish approvals, CSV export
- **Assessment**: question banks, pools, matching/ordering/essay, negative marking, cooldowns, autosave, answer-release policies, manual grading queue
- **Cohorts & programs**: batches, learning paths with locks, competencies, milestones
- **Live classes**: Jitsi/Meet/Zoom/custom providers, registration, capacity, attendance, ICS export
- **Commerce**: bundles, coupons, orders, invoices, manual + signed-provider payments, webhooks with replay protection, refunds, subscriptions, commissions, affiliates, gifts
- **SCORM 1.2**: validated import, sandboxed player, progress/resume tracking
- **AI framework** (BYOK, review-gated), **coding exercises** (static review; execution gated), **email queue**, **invitations**, **CSV imports** (dry-run + row errors)
- **Security**: refresh-token reuse detection, extended OWASP matrix tests

## Testing

```bash
npm test            # 87+ tests: auth, RBAC matrix, tenant isolation, IDOR,
                    # courses, quiz (scoring/expiry/limits/pools/manual),
                    # assignments, attendance, certificates, files, setup, search,
                    # idempotency, CORS, rate limiting, authoring, banks, cohorts,
                    # live, commerce, webhooks, SCORM, AI-mock, imports, reuse,
                    # journey E2E, PWA assets, OpenAPI honesty
npm run typecheck
npm run lint
npm run build
npm run audit       # migrations, FK/indexes, secrets, CDN, envelope, RBAC, PWA, guards
npm run contract    # every frontend API path resolves to a backend route
npm run test:e2e    # Playwright browser tests (needs seeded dev DB)
```

## Security

Threat model and controls: `SECURITY.md` (+ `docs/security.md`).
OWASP-style coverage is tested in `apps/api/test/security.test.ts`.

## Customization, product & license

- Customize: `docs/customization.md` · Product sheet: `PRODUCT.md`
- Contributing: `CONTRIBUTING.md` · Changelog: `CHANGELOG.md`
- **License: see `LICENSE`. Final commercial terms must be selected by the product owner.**

## Documentation index

`docs/api.md` · `architecture.md` · `cloudflare.md` · `customization.md` ·
`deployment.md` · `flutter.md` · `multi-organization.md` · `pwa.md` ·
`security.md` · `white-label.md` · `course-authoring.md` · `assessment.md` ·
`commerce.md` · `scorm.md` · `ai.md` · `exercises.md` · `backup-recovery.md` ·
`troubleshooting.md` · `competitive-benchmark.md` · `feature-gap-matrix.md` ·
`implementation-status.md` · `production-readiness.md` · `upgrade-guide.md` ·
`capability-matrix.md` · `api-versioning.md`

# Feature inventory (generated 2026-10-10T15:30:40.353Z, commit ac79226)

Source: parsed route registrations in `apps/api/src/routes/*.ts`, hash routes in `apps/*/src/main.ts`, `CREATE TABLE` in `migrations/*.sql`. Coverage = invocation-confirmed call-sites (`app.request`/`page.request`/`fetch` URL arguments, static-prefix matched, query stripped). VERIFIED_PASS additionally requires the spot-audited meaningful assertions below — invocation alone is not a pass.

## Counts

- Endpoints: 261 (public: 16)
- Invoked by API tests: 259 (5690 call-sites)
- Invoked by E2E: 105
- Frontend hashes: 57
- Tables: 108 across 23 migrations

## Status histogram

- VERIFIED_PASS: 259
- IMPLEMENTED_TEST_GAP: 2

## Assertion spot-audit (module → what tests assert beyond status)

- auth: rotation invalidates old token, reuse kills family, reset revokes sessions, logout kills token, throttle caps.
- courses/enroll: 402 without entitlement under drift, approval/closed modes, capacity, prerequisites, progress math.
- assessment: exact scores per type, partial/negative floors, attempt/cooldown/expiry rejections, manual-grade audit.
- commerce: server-side totals, coupon atomicity, webhook idempotency + forgery rejection, refund reversal, commission idempotency, cohort revocation.
- certificates: eligibility, uniqueness, verify valid/revoked/expired, re-issue entropy.
- RBAC/IDOR: cross-org 403s, cross-student cert/grade/user blocks, parent-link scoping, teacher refund 403.
- xAPI/AI/SCORM/imports: validation rejections, isolation, review gates, idempotent replays.

## Public endpoints (no requireAuth in handler)

- POST /api/v1/auth/register (auth)
- POST /api/v1/auth/login (auth)
- POST /api/v1/auth/refresh (auth)
- POST /api/v1/auth/password/forgot (auth)
- POST /api/v1/auth/password/reset (auth)
- POST /api/v1/auth/verify-email (auth)
- POST /api/v1/payments/webhooks/:provider (commerce)
- GET /api/v1/catalog/courses (commerce)
- GET /api/v1/catalog/bundles (commerce)
- GET /api/v1/catalog/bundles/:id (commerce)
- GET /api/v1/catalog/instructors/:id (commerce)
- POST /api/v1/invitations/accept (growth)
- GET /api/v1/certificates/verify/:number (ops)
- GET /api/v1/setup/status (platform)
- POST /api/v1/setup (platform)
- GET /api/v1/organizations/:id/branding (platform)

## Endpoints with zero invocations (IMPLEMENTED_TEST_GAP)

- GET /api/v1/reports/completion (ops)
- GET /api/v1/reports/attendance (ops)

Known matcher blind spot (manually verified, not a gap): `GET /api/v1/reports/completion` and `GET /api/v1/reports/attendance` are invoked via the interpolated loop `for (const path of ['completion','attendance','teacher-activity'])` in `platform.test.ts:419-425` with status + real-data assertions.

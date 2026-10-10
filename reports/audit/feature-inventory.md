# Feature inventory (generated 2026-10-10T07:34:39.241Z, commit fe6a8ec)

Source: parsed route registrations in `apps/api/src/routes/*.ts`, hash routes in `apps/*/src/main.ts`, `CREATE TABLE` in `migrations/*.sql`. Coverage flags are mechanical substring matches of the endpoint path in `apps/api/test/*.ts` (backend_test) and `apps/web/e2e/*.ts` (e2e_test).

## Counts

- Endpoints: 257 (public: 16)
- With backend-test reference: 255
- With e2e reference: 101
- Frontend hashes: 56
- Tables: 108 across 22 migrations

## Status histogram

- IMPLEMENTED_PARTIALLY_VERIFIED: 154
- IMPLEMENTED_AND_VERIFIED: 101
- IMPLEMENTED_NOT_VERIFIED: 2

## Public endpoints (no requireAuth in handler)

- POST /register (auth)
- POST /login (auth)
- POST /refresh (auth)
- POST /password/forgot (auth)
- POST /password/reset (auth)
- POST /verify-email (auth)
- POST /payments/webhooks/:provider (commerce)
- GET /catalog/courses (commerce)
- GET /catalog/bundles (commerce)
- GET /catalog/bundles/:id (commerce)
- GET /catalog/instructors/:id (commerce)
- POST /invitations/accept (growth)
- GET /api/v1/certificates/verify/:number (ops)
- GET /api/v1/setup/status (platform)
- POST /api/v1/setup (platform)
- GET /api/v1/organizations/:id/branding (platform)

## Endpoints without any test reference

- GET /api/v1/reports/completion (ops)
- GET /api/v1/reports/attendance (ops)

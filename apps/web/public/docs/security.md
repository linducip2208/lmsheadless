# Security (companion to `SECURITY.md`)

## Enforcement points

- `requireAuth` per route (never a broad `use('*')` on a shared mount).
- Granular `roleHasPermission` checks for settings/audit-sensitive actions.
- Tenant resolution from server-side relations, never from client claims.
- Zod on every write; parameterized `bind(...)` SQL only; allowlisted sort columns.
- Uploads: MIME + extension allowlists, 25 MB default cap, executable/active-content rejection, server-generated keys, traversal checks, ownership/org-gated downloads with `nosniff`.
- CORS: exact-origin allowlist (`ALLOWED_ORIGINS`), localhost-only in dev, credentials never paired with `*`.
- Rate limits on `/api/*` (login/register/refresh/quiz/verify included), KV-backed in prod.
- Errors: uniform envelope, request IDs, no stack traces to clients.

## Tested attacker stories (`test/security.test.ts`)

Org A→B escape · teacher B grading in org A · student A reading student B ·
parent reading unlinked child · staff renaming org · privilege escalation via
mass assignment (`role`, `password_hash` ignored) · SQL injection in search ·
upload traversal · refresh-token replay (rotation) · flood rate limiting.

## Residual risks (owned, not hidden)

- Demo seed credentials are dev-only; production must use `/setup` + strong passwords.
- Push/email delivery requires customer credentials before it does anything.
- File downloads re-check auth per request; presigned R2 URLs are future work.
- Dev-only advisories (vitest/tinypool/esbuild chains) remain in the dev
  dependency tree pending upstream majors; production `npm audit --omit=dev`
  is clean (0 vulnerabilities) and none of these packages ship in the Workers
  bundle or any frontend `dist/`.

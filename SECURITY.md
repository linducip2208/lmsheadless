# SECURITY.md — LMS Headless threat model & controls

## Model

- Authentication: PBKDF2-SHA256 (100k iterations, per-user salt) via WebCrypto; never plaintext.
- Sessions: short JWT access (15 min, HS256, `JWT_SECRET` from env) + rotating opaque refresh tokens (48 random bytes, sha256-hashed at rest, 30 d expiry, single-use rotation) with **reuse detection**: presenting a rotated token revokes the entire session family (`REUSE_DETECTED`, audited).
- Secrets only from environment/bindings. `.env.example` lists vars; `.env` gitignored. Static `audit` scans for hardcoded secrets.

## Authorization (centralized)

- `requireAuth` on all `/api/v1/*` except health, public cert verify, auth login/register/refresh, openapi/docs.
- RBAC roles: `super_admin | organization_admin | teacher | student | parent | staff`; `role_permissions` table seeds least-privilege mapping.
- Tenant isolation: every org-scoped read/write resolves `organization_id` server-side (course→org, quiz→org, etc.) and checks `organization_members`; cross-org access returns `TENANT_DENIED`. Covered by tests (org A vs B).
- IDOR: object IDs never trusted — e.g. grades/progress re-check org membership or parent_links; students can only act on self unless teacher/admin; quiz correctness never exposed to students; `parent` sees only `parent_links` rows.
- Mass assignment guarded by explicit allowlists in PATCH handlers (users, courses).
- Privilege escalation blocked: only `super_admin` can create/assign `super_admin`.

## Input & injection

- Zod validation on every write endpoint (email, password, enums, dates, pagination, file metadata, quiz answers, submissions).
- SQL: parameterized `bind(...)` everywhere via D1 interface; sort columns allowlisted; `LIKE` bounded to 200 chars.
- Uploads: MIME + extension allowlist, 25 MB cap, executable/active-content blocked, server-generated keys, traversal check (`..` rejected), auth required.
- XSS: API returns JSON (no HTML reflection); frontends use `textContent`-style interpolation with slicing and no `innerHTML` of user data except escaped template strings — no `eval`.
- CSRF: API is token-based (Bearer, no cookies) → no CSRF surface; same-origin frontends use Authorization header.
- Rate limiting: per-IP sliding window middleware; KV-backed in production (binding `KV`), in-memory fallback locally. Auth endpoints share the same limiter.

## Transport & errors

- Uniform envelope; production errors never include stack traces (`onError` logs server-side with request ID only).
- `X-Request-Id` on every response; structured server logs include request ID.
- Public endpoints: health, certificate verification (by unguessable number), openapi/docs (disable docs in prod via route guard if needed).

## File/storage & data

- R2 private by default; downloads require auth + org check (architecture: signed URLs via `R2_PUBLIC_BASE_URL` only for explicitly public assets).
- Soft delete for identity/content roots; transactional rows cascade.
- Password reset/email verification: single-use hashed tokens with expiry; forgot endpoint is enumeration-safe.

## Reporting

Do not commit secrets. Report vulnerabilities with reproduction steps and affected `/api/v1` route.

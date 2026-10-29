# Troubleshooting

## Flaky E2E first test (cold vite transforms)

The first spec of a Playwright run may time out once while vite compiles
portals on demand ("cold-load class"), then go green on retry and on every
re-run. This is environmental, not a product bug: `apps/web/playwright.config.ts`
runs `e2e/global-setup.ts` to warm all five portals + the API before specs,
which reduced the suite from flaky to 73/73 green. If a single spec still
flakes, re-run just that file — a second consecutive failure is a real bug.
See `docs/architecture.md` (quarantine process).

## `npm run db:migrate` fails with “table already exists”

Migrations use `CREATE TABLE IF NOT EXISTS` and guarded `ALTER`s — safe to
re-run. If a custom edit broke one, restore the file from git and add a new
migration instead.

## Login returns 401 after deploy

- Check `JWT_SECRET` is set (≥32 chars) via `wrangler secret put`.
- Cookies: set `COOKIE_SECURE=1` only on HTTPS; browsers drop Secure cookies
  on http://localhost.
- CORS: `ALLOWED_ORIGINS` must list exact portal origins (no trailing slash).

## `REUSE_DETECTED` on refresh

A rotated refresh token was presented twice (possible theft or double client).
All sessions for the user were revoked by design — log in again. Check
`audit_logs` (`auth.reuse_detected`).

## Webhook 401 INVALID_SIGNATURE

The provider secret in organization settings does not match the merchant
dashboard, or payload fields were reordered/trimmed by a proxy. Compare the
stored `payment_webhooks` payload with the provider dashboard event.

## SCORM import rejected

- `INVALID_PACKAGE`: not a ZIP / no `imsmanifest.xml` / unsafe paths.
- `UNSUPPORTED_VERSION`: SCORM 2004 — see `docs/scorm.md` gaps.

## Quiz submit 400 ATTEMPT_EXPIRED / COOLDOWN

Time limit or cooldown configured on the quiz; start a new attempt (limits apply).

## PWA shows stale UI

Bump `VERSION` in the app's `public/sw.js`, redeploy, and accept the update
toast. `controllerchange` reloads once automatically.

## 429 Too Many Requests

Rate limiter engaged (KV in prod, memory locally). Auth, quiz, webhook and
verify endpoints are intentionally strict. Retry after a minute.

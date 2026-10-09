# API versioning & deprecation policy

Base path: `/api/v1`. All changes within `v1` are **additive and backward
compatible**: new endpoints, new optional fields, new enum values on *output*
only where documented. Breaking changes (removed endpoints, required-field
additions, envelope changes) require a new major version (`/api/v2`) with:

1. Minimum **6-month overlap**: v1 keeps serving with a `Deprecation: true`
   response header and a `Sunset` date (RFC 8594) on affected routes.
2. Migration notes in `CHANGELOG.md` + `docs/upgrade-guide.md`.
3. Contract tests asserting v1 stability (`scripts/check-contract.mjs`).

## Client guidance (Flutter)

- Pin the base path (`/api/v1`); never construct unlisted paths.
- Unknown JSON fields must be ignored (forward compatibility).
- Switch on `error.code`, never on message text.
- Send `Idempotency-Key` on writes you may retry.
- Honor `429` (backoff) and `503 + Retry-After` (maintenance).

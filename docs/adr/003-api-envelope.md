# ADR 003 — Uniform API envelope, no raw bodies

Status: accepted (2026-10-09).

Context: five portals + Flutter client share one REST API; inconsistent
shapes multiply client bugs.

Decision: every JSON response is `{success, data, meta}` or
`{success: false, error: {code, message}}`. Only file/CSV/ICS downloads may
use raw bodies (allowlisted in `static-audit.mjs`, which fails CI otherwise).
`openapi.ts` is generated from a route table; `contract` script proves every
frontend fetch path resolves to a backend route.

Consequences: no `c.json()` outside the envelope helpers; the audit is
mechanical, not judgment-based.

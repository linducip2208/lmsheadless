# Implementation status (October 2026)

## Shipped this release (v1.2.0)

Migrations 008–014 (+17 column patches). New route modules: `authoring`,
`banks`, `cohorts`, `live`, `commerce`, `scorm`, `growth` (AI/exercises/email/
invites/units/approvals/imports), extended `reports` + certificates.
New deps (MIT): `jszip`, `fast-xml-parser` (Workers-compatible, pure JS).

Portals: admin (commerce, cohorts, live, SCORM, imports, AI, exercises, email),
teacher (banks, live, cohorts), student (catalog/bundles purchase, live,
programs, SCORM player, exercises), parent (cohort view), web (catalog, bundles,
instructors, pricing honesty intact).

Tests: journey suite added (setup→enroll→complete→quiz→assignment→cert→parent),
commerce + webhook + SCORM + import + AI-mock + email-queue + reuse-detection
tests. Full suite must stay green; coverage target ≥75% on `src/`.

## Deferred with reason

- SCORM 2004 / H5P native: runtime size vs. budget; 1.2 covers the common market need; gaps documented.
- Custom role builder UI: catalog + mapping exist; UI deferred, API supports it.
- RTL/Arabic: architecture ready; translation + layout pass deferred.
- Live provider OAuth (Zoom/Meet): interfaces + Jitsi/custom working without creds; vendor OAuth needs customer keys.
- AI live-provider verification, SMTP delivery, sandbox execution: adapters + contract tests done; credentials pending (labeled in UI/docs).
- SSO/SAML/SCIM, native mobile apps: out of scope (documented).

# Security results (commit 2e8feba + tree; local tests only)

## Re-verified this session

- 134/134 API tests green incl. `security`, `hardening`, `governance`,
  `security-fixes`, `xss-escape` suites; 19/19 E2E incl. negative journeys.
- IDOR matrix re-passing: cross-org course/enrollment/grading blocks,
  cross-student cert/grade/user blocks, parent-link scoping, teacher refund
  403, student roster/commerce-admin 403s.
- Stored XSS: `esc()` boundary + centralized `errorHtml`/`tableHtml`; new
  sinks closed (admin shell/quizzes, teacher live panel, student progress
  attrs); stored-URL schemes validated (`httpUrl` on video/resource/meeting
  URLs); `javascript:` back-link removed. Round-trip test proves the API
  stores verbatim while portals render escaped.
- Webhook: signature-before-write, amount-match (402), replay dedupe,
  idempotent fulfill; conditional confirm/refund/decide transitions;
  commission unique index.
- Rate limits: strict auth bucket on 10 paths; global bucket intact;
  E2E-only raised env, production defaults unchanged (verified in code).
- Secrets: no hashes/keys in responses (key-absence asserted); error
  envelope hides stacks; audit log captures setup/auth/commerce/cert/AI
  admin actions.

## Residual risks (explicit, not waived)

1. AI BYOK keys recoverable by DB holders — protect backups (Medium).
2. First-run setup has no distributed lock — sequential re-entry 403-tested;
   concurrent fresh-DB setup could double-provision (Low/Medium).
3. No per-user upload quota — storage-exhaustion abuse possible (Low).
4. `ON DELETE CASCADE` on financial/academic tables is unreachable via the
   API (soft deletes only) — accepted with rationale (Low).
5. Lesson bodies render as escaped text — no rich-HTML lessons until a
   vetted sanitizer ships (design choice, documented).

No critical/high finding remains without a fix or an explicit exception.

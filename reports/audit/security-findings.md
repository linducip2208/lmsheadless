# Security findings (all reproduced from code; no external testing)

## Fixed this session (regression-tested)

| ID  | Severity | Finding                                                                                                                 | Fix                                                                                                                                                                                                          | Test                                                                       |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| H1  | High     | Stored XSS: ~80 `innerHTML` sinks rendered server/user strings raw; no escaper; `SECURITY.md` falsely claimed otherwise | `esc()` in `@lms/ui`, applied to all portal sinks (titles, bodies, prompts, options, feedback, threads, replies, notifications, AI output, catalog); `javascript:` back-link replaced; SECURITY.md corrected | `test/xss-escape.test.ts` (unit + verbatim-round-trip + sink pinning)      |
| M2  | Medium   | Webhook replay row inserted before signature check (unauthenticated storage-DoS)                                        | Order lookup + HMAC verify moved before any write; replay insert only for authentic events                                                                                                                   | existing webhook tests green; flood inserts now impossible by construction |
| P1  | Medium   | Notification preferences stored but never consulted (docs claimed enforcement)                                          | `wantsNotification()` gate on all 6 fan-out writes (announcements, enroll approve/reject, live reschedule/cancel, compliance)                                                                                | `coverage-gaps.test.ts` opt-out test                                       |
| M3  | Medium   | Strict rate bucket covered only login/register/refresh; reset/verify/invite/setup unthrottled                           | Extended strict bucket to 10 credential-abuse paths in `app.ts`                                                                                                                                              | `hardening.test.ts` bucket test still green                                |
| L1  | Low      | Refresh cookie `Secure` opt-in, default off                                                                             | Documented: production checklist requires `COOKIE_SECURE=1`                                                                                                                                                  | — (config, not code)                                                       |

## Fixed in 1.8.0 (verified present, not re-broken)

Reset revokes sessions; certificate-list IDOR; roster enumeration; grades
oracle; attendance membership (`security-fixes.test.ts`, 5 tests green).

## Residual (documented, not silently dropped)

1. AI provider keys recoverable by DB holders — key-absence asserted in
   `lifecycle-fixes.test.ts`; backups must be access-controlled.
2. Setup first-run race (two parallel setups on a fresh DB) — sequential
   re-entry tested 403; concurrent case has no distributed lock (Workers).
3. No per-user upload quota — storage-exhaustion abuse possible.
4. Cascade clauses (`ON DELETE CASCADE` on orders/certs/grades) are inert in
   practice (no hard-delete app path: users/courses soft-delete, no org
   delete endpoint) — recorded in `database-integrity.md`.
5. Lesson bodies render as escaped text (no rich-HTML lessons) — by design
   until a sanitizer ships.

No critical/high finding remains without a fix or an explicit exception above.

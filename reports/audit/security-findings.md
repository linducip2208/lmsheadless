# Security findings (all reproduced from code; no external testing)

Methodology note: parallel review agents in this session also re-reported
several issues that `git show HEAD:` proves were already fixed in v1.9.0
(webhook write-order, preference gates, rate-bucket paths, esc rollout,
tiebreakers). Those reports are not counted as new findings or fixes here.
Every item below is grounded in this session's `git diff` plus a green
regression test — no credit is taken for pre-existing work.

## Fixed in 1.10.0 (regression-tested)

| ID  | Severity | Finding                                                                                                  | Fix                                                                                                                                    | Test                                                                 |
| --- | -------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| H2  | High     | Webhook accepted signed-but-underpaid events (`gross_amount` never compared)                             | Amount match vs order total, 402 `AMOUNT_MISMATCH`, rejected events logged not fulfilled                                               | `commerce-edges.test.ts` (rejected + forensics row, order untouched) |
| H3  | High     | Shadowed duplicate autosave handlers (`banks.ts` weaker guards)                                          | Removed; canonical `assessment.ts` handler accepts batch + legacy shapes                                                               | enterprise + quiz-autosave suites green                              |
| M8  | Medium   | Confirm/refund/payout-decide check-then-act races                                                        | Conditional `AND status=` transitions (409 on loss); commissions unique index (023) + `ON CONFLICT DO NOTHING`; invoice race tolerated | double-transition tests                                              |
| M9  | Medium   | Negative subscription price, unvalidated affiliate rates, NaN-poisoning via garbage org rates            | Write validation + read-time sanitization                                                                                              | `commerce-edges.test.ts` guards suite                                |
| M10 | Medium   | Cohort gift codes burned without granting anything                                                       | Cohort entitlement + membership + course grants mirroring fulfillment                                                                  | `commerce-edges.test.ts` redeem test                                 |
| M11 | Medium   | Residual `esc()` gaps (admin shell/quizzes, teacher live panel, progress attrs, `errorHtml`/`tableHtml`) | Closed + centralized; `SECURITY.md` already corrected in 1.9.0                                                                         | `xss-escape.test.ts` extended                                        |
| L3  | Low      | PATCH silently dropped `status` for non-super-admins                                                     | Server reports `ignored` fields in response                                                                                            | existing mass-assignment test still green                            |

## Fixed in 1.9.0 (verified present, not re-broken)

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

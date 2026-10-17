# Security results (commit d73c6b9 + tree; local tests only — 2026-10-16)

## Re-verified this session

- 149/149 API tests green incl. `security`, `hardening`, `governance`,
  `security-fixes`, `xss-escape`, `release-fixes` (9), new `release2-fixes`
  (6) suites; 20/20 E2E incl. negative journeys + multiselect browser submit.
- IDOR matrix re-passing: cross-org course/enrollment/grading blocks,
  cross-student cert/grade/user blocks, parent-link scoping, teacher refund
  403, student roster/commerce-admin 403s; students get 403 on foreign attempt
  scopes and teacher files.
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

## Fixed this session (regression-tested)

Round 2 (2026-10-16, `release2-fixes`):

1. Org-wide file ACL: any org member could list/fetch all org files.
   Listing/download now role-scoped (teaching/admin all, students/parents
   own-only, owners always); course materials still reach learners via
   lessons, not the file browser.
2. Login had IP-bucket limiting only: per-account lockout added (5 failures
   → 15-min 423, reset on success; unknown emails stay generic 401).
3. Concurrent fresh-DB setup could double-provision: atomic single-winner
   claim (`in_progress` marker, 409 while held, stale-steal after 5 min);
   setup passwords capped at 128 chars like all other password paths.

Round 1 (2026-10-11, `release-fixes`):

1. Parent answer-key leak: `GET /quizzes/:id/questions` treated only
   `student` as unprivileged; parents received `is_correct`. Now
   student+parent both get label-only options (`release-fixes` §1).
2. Unbounded passwords on reset/invitation-accept paths (PBKDF2 CPU burn):
   capped at 128 chars like the other password paths (`release-fixes` §2).
3. Offline queue cross-user replay: global `lms-pending-queue` key replaced
   with owner-tagged actions + scoped flush; production-readiness claim now
   matches code. Only lesson-complete is enqueued (student portal).

## Residual risks (explicit, not waived)

1. AI BYOK keys recoverable by DB holders — protect backups (Medium).
2. Setup stale-claim window is 5 minutes; distributed (multi-instance) first
   boot still needs a serialized deploy hook — atomic claim covers
   single-instance concurrency (Low).
3. Upload quota is org-level and default-off; per-user granularity and
   restrictive defaults need product policy (Low).
4. `ON DELETE CASCADE` on financial/academic tables is unreachable via the
   API (soft deletes only) — accepted with rationale (Low).
5. Lesson bodies render as escaped text — no rich-HTML lessons until a
   vetted sanitizer ships (design choice, documented).

No critical/high finding remains without a fix or an explicit exception.

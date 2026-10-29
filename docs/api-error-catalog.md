# API error catalog (generated 2026-10-23)

Source: `fail(status, CODE)` call-sites in `apps/api/src/routes/*.ts`.
Envelope: `{success:false, error:{code,message}}` (ADR 003). Regenerate: `node scripts/gen-error-catalog.mjs`.

| Code                        | Route files                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 AI_DISABLED`           | growth.ts                                                                                                                                                                  |
| `400 AI_LIMIT`              | growth.ts                                                                                                                                                                  |
| `400 ATTEMPT_EXPIRED`       | assessment.ts                                                                                                                                                              |
| `400 ATTEMPT_LIMIT`         | assessment.ts, growth.ts                                                                                                                                                   |
| `400 COHORT_FULL`           | cohorts.ts                                                                                                                                                                 |
| `400 COOLDOWN`              | assessment.ts                                                                                                                                                              |
| `400 COURSE_FULL`           | authoring.ts, courses.ts                                                                                                                                                   |
| `400 ENROLLMENT_CLOSED`     | courses.ts                                                                                                                                                                 |
| `400 EXECUTION_UNAVAILABLE` | growth.ts                                                                                                                                                                  |
| `400 INVALID_COUPON`        | commerce.ts                                                                                                                                                                |
| `400 INVALID_FILE`          | ops.ts                                                                                                                                                                     |
| `400 INVALID_INVITE`        | growth.ts                                                                                                                                                                  |
| `400 INVALID_PACKAGE`       | h5p.ts, scorm.ts                                                                                                                                                           |
| `400 INVALID_STUDENT`       | ops.ts                                                                                                                                                                     |
| `400 INVALID_TOKEN`         | auth.ts                                                                                                                                                                    |
| `400 LATE_NOT_ALLOWED`      | assessment.ts                                                                                                                                                              |
| `400 LESSON_LOCKED`         | courses.ts                                                                                                                                                                 |
| `400 PREREQUISITE_NOT_MET`  | courses.ts                                                                                                                                                                 |
| `400 PROGRAM_LOCKED`        | courses.ts                                                                                                                                                                 |
| `400 RETRY_EXHAUSTED`       | growth.ts                                                                                                                                                                  |
| `400 SELF_REFERRAL`         | commerce.ts                                                                                                                                                                |
| `400 SESSION_CANCELLED`     | live.ts                                                                                                                                                                    |
| `400 SESSION_FULL`          | live.ts                                                                                                                                                                    |
| `400 THREAD_LOCKED`         | ops.ts                                                                                                                                                                     |
| `400 UNSUPPORTED_VERSION`   | scorm.ts                                                                                                                                                                   |
| `400 VALIDATION_ERROR`      | assessment.ts, auth.ts, authoring.ts, banks.ts, cohorts.ts, commerce.ts, courses.ts, growth.ts, h5p.ts, live.ts, ops.ts, orgs.ts, platform.ts, scorm.ts, users.ts, xapi.ts |
| `401 INVALID_CREDENTIALS`   | auth.ts                                                                                                                                                                    |
| `401 INVALID_REFRESH`       | auth.ts                                                                                                                                                                    |
| `401 INVALID_SIGNATURE`     | commerce.ts                                                                                                                                                                |
| `401 REUSE_DETECTED`        | auth.ts                                                                                                                                                                    |
| `402 AMOUNT_MISMATCH`       | commerce.ts                                                                                                                                                                |
| `402 PAYMENT_REQUIRED`      | courses.ts                                                                                                                                                                 |
| `403 ACCESS_EXPIRED`        | assessment.ts, courses.ts                                                                                                                                                  |
| `403 ACCOUNT_INACTIVE`      | auth.ts                                                                                                                                                                    |
| `403 FORBIDDEN`             | assessment.ts, auth.ts, authoring.ts, banks.ts, cohorts.ts, commerce.ts, courses.ts, growth.ts, h5p.ts, live.ts, ops.ts, orgs.ts, platform.ts, scorm.ts, users.ts, xapi.ts |
| `403 REGISTRATION_DISABLED` | auth.ts                                                                                                                                                                    |
| `403 SETUP_LOCKED`          | platform.ts                                                                                                                                                                |
| `403 TENANT_DENIED`         | assessment.ts, authoring.ts, banks.ts, cohorts.ts, commerce.ts, courses.ts, growth.ts, h5p.ts, live.ts, ops.ts, orgs.ts, platform.ts, scorm.ts, users.ts, xapi.ts          |
| `404 NOT_FOUND`             | assessment.ts, auth.ts, authoring.ts, banks.ts, cohorts.ts, commerce.ts, courses.ts, growth.ts, h5p.ts, live.ts, ops.ts, orgs.ts, platform.ts, scorm.ts, users.ts          |
| `404 ORDER_NOT_FOUND`       | commerce.ts                                                                                                                                                                |
| `409 CONFLICT`              | auth.ts, authoring.ts, cohorts.ts, commerce.ts, courses.ts, orgs.ts, platform.ts, users.ts                                                                                 |
| `409 RESUBMIT_NOT_ALLOWED`  | assessment.ts                                                                                                                                                              |
| `409 SETUP_IN_PROGRESS`     | platform.ts                                                                                                                                                                |
| `413 QUOTA_EXCEEDED`        | h5p.ts, ops.ts, scorm.ts                                                                                                                                                   |
| `423 ACCOUNT_LOCKED`        | auth.ts                                                                                                                                                                    |
| `429 RATE_LIMITED`          | auth.ts                                                                                                                                                                    |
| `502 AI_PROVIDER_ERROR`     | growth.ts                                                                                                                                                                  |
| `502 EMAIL_FAILED`          | growth.ts                                                                                                                                                                  |

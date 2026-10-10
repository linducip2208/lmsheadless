# LMS domain inventory (commit 2e8feba + tree; generated 2026-10-10)

Method: route registrations parsed from `apps/api/src/routes/*.ts` with
mount prefixes resolved from `app.ts`; coverage = invocation-confirmed
call-sites (`app.request`/`page.request`, static-prefix matched, 5,690 total).
VERIFIED_PASS additionally requires the assertion behavior named per row —
invocation alone is not a pass. Machine detail: `feature-matrix.json`
(261 endpoints, 16 public, 57 frontend hashes, 108 tables, 23 migrations).

## Auth, sessions, recovery, roles

| Feature                           | Chain (UI → API → DB → test)                                                | Status                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Register/login/logout/refresh     | web `#/register                                                             | #/login`, portals `#/login`→`POST /auth/*` → users/refresh_tokens → api/governance suites + roles E2E §1 | VERIFIED_PASS |
| Refresh rotation + reuse kill     | `POST /auth/refresh` → token family revoke                                  | VERIFIED_PASS                                                                                            |
| Password forgot/reset             | web `#/forgot                                                               | #/reset/:token` (new) → always-200 forgot, single-use reset, reset revokes sessions                      | VERIFIED_PASS |
| Email verify loop                 | token + throttle + status                                                   | VERIFIED_PASS                                                                                            |
| Invitations/parent links          | token accept, org-unit scoping                                              | VERIFIED_PASS                                                                                            |
| Setup lock                        | first-run once, 403 after; concurrent-run race documented                   | PARTIAL                                                                                                  |
| Roles/permissions catalog + remap | admin `#/roles` modal (no more `prompt()`) → `PUT /roles/:role/permissions` | VERIFIED_PASS                                                                                            |
| User status edit                  | admin roster edit → `PATCH /users/:id` → `ignored` reported for non-super   | VERIFIED_PASS                                                                                            |

## Organization & academic structure

| Feature                               | Chain                                                                                                                           | Status        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Orgs, members, branding, domain       | admin `#/organizations` → orgs routes → organizations/members                                                                   | VERIFIED_PASS |
| Academic years/terms/classes/subjects | org-scoped CRUD + member assignment                                                                                             | VERIFIED_PASS |
| Instructor assignment to courses      | NEW `GET/POST/DELETE /courses/:id/instructors` (privileged, member+role validated) → `course_instructors` → coverage-gaps suite | VERIFIED_PASS |
| Parent-child links                    | `POST /users/:id/parent-links`, org-scoped reads                                                                                | VERIFIED_PASS |

## Courses, content, delivery

| Feature                                                      | Chain                                                                                                   | Status        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------- |
| Course builder (sections/lessons/order/tags/prereq/drip)     | admin `#/courses` builder + teacher UI (real buttons, serialized navigation) → courses/authoring routes | VERIFIED_PASS |
| Draft/publish/approval workflow                              | status gates, approval queue, request endpoint                                                          | VERIFIED_PASS |
| Enrollment (open/approval/closed, capacity, windows, prereq) | student shop/program + API → enrollments/requests/waitlist                                              | VERIFIED_PASS |
| Paid gates (enroll/lesson/quiz/assignment)                   | minor-unit reads with legacy fallback                                                                   | VERIFIED_PASS |
| Lesson completion → progress → auto-cert                     | `POST /lessons/:id/complete` → progress math → certificate                                              | VERIFIED_PASS |
| SCORM 1.2                                                    | upload/launch/track/resume/isolate; sandboxed iframe                                                    | VERIFIED_PASS |
| SCORM 2004 sequencing / H5P runtime                          | imported-not-interpreted / absent (docs honest)                                                         | PARTIAL       |
| Files/uploads/downloads                                      | validated, owner/org-scoped, traversal-guarded                                                          | VERIFIED_PASS |
| PWA offline queue                                            | lesson-complete queue, per-user flush, no private caching                                               | VERIFIED_PASS |

## Assessment & assignments

| Feature                                       | Chain                                                                                                                                                                  | Status        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Question banks/pools/difficulty               | teacher `#/banks`, admin quizzes → banks routes                                                                                                                        | VERIFIED_PASS |
| 7 question types + scoring                    | exact-score fixtures incl. partial/negative floors                                                                                                                     | VERIFIED_PASS |
| Attempt limits/cooldown/expiry/answer release | server-enforced, resume-single-active                                                                                                                                  | VERIFIED_PASS |
| Autosave + recovery                           | NEW `PUT/GET /quiz-attempts/:id/autosave` (canonical in assessment; shadow duplicates removed) + student debounced save + restore → quiz-autosave suite + roles E2E §8 | VERIFIED_PASS |
| Manual grading + rubrics                      | per-answer grading, audit trail                                                                                                                                        | VERIFIED_PASS |
| Assignments/submissions/feedback/late policy  | teacher review, student resubmit rules                                                                                                                                 | VERIFIED_PASS |

## Attendance, grades, certs, discussion

| Feature                                              | Chain                                                                                   | Status        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| Attendance sessions/records                          | membership-validated writes, batched reads                                              | VERIFIED_PASS |
| Gradebook + progress reports                         | course-scoped, role-gated reads                                                         | VERIFIED_PASS |
| Certificates (issue/bulk/revoke/re-issue/PDF/verify) | eligibility, unique numbers, entropy on re-issue, public verifier honors revoke/expired | VERIFIED_PASS |
| Announcements/discussions                            | modal-based posting (no more `prompt()`), prefs-gated fan-out                           | VERIFIED_PASS |
| Notifications + preferences                          | center, unread, read-all, enforced opt-out                                              | VERIFIED_PASS |

## Commerce (LMS purchase flows only)

| Feature                                              | Chain                                                                        | Status        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| Orders → manual/webhook pay → entitlements → invoice | server-side totals, HMAC, replay table, idempotent fulfill                   | VERIFIED_PASS |
| Amount matching                                      | `gross_amount` vs order total, 402 on mismatch                               | VERIFIED_PASS |
| Refunds + commission reversal + cohort revocation    | conditional transitions, unique payee index                                  | VERIFIED_PASS |
| Coupons/gifts/affiliates/payouts/subscriptions       | atomic claims, cohort-gift grants, listings wired, no auto-renewal (labeled) | VERIFIED_PASS |

## Platform: API, i18n, a11y, install

| Feature                                              | Chain                                                                                  | Status        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------- |
| REST `/api/v1` + OpenAPI + envelope + pagination     | 179 frontend refs resolve; new routes registered in openapi                            | VERIFIED_PASS |
| EN/ID dictionaries                                   | teacher/student/admin passes this session; quiz reorder labeled; remaining gaps listed | PARTIAL       |
| Keyboard/focus/responsive/loading/empty/error states | tab roles, aria labels, per-view states; router race fixed (serialized navigation)     | VERIFIED_PASS |
| Install/migrate/seed/setup                           | disposable-DB verified; seed custom-path guard; docs reconciled 001→023                | VERIFIED_PASS |

## External-gated (BLOCKED_EXTERNAL, adapters + mock tests, never live)

Email delivery, web-push send, OpenAI-compatible calls, Zoom/Meet OAuth,
R2/KV live bindings, code sandbox, Midtrans-live merchant.

## Out of scope (not built, not scored)

ERP/CRM/HRIS/POS, generic marketplace, SaaS tenant billing, native mobile
apps, SSO/SAML/SCIM, RTL/Arabic.

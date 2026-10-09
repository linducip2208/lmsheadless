# Feature gap matrix (October 2026)

Legend: ✅ implemented+tested · 🟡 implemented, thin tests · 🟠 partial ·
⚪ documented, not coded · ❌ not implemented · 🚫 intentionally out of scope.

## Authoring

| Feature                              | Status | Evidence                                       |
| ------------------------------------ | ------ | ---------------------------------------------- |
| Sections/lessons/order               | ✅     | courses routes + builder UI + tests            |
| Tags                                 | ✅     | 008 + API + tests                              |
| Prerequisites (course/lesson)        | ✅     | 008 + enforcement in enroll/complete + tests   |
| Drip scheduling                      | ✅     | drip_rules + unlock check + tests              |
| Enrollment windows/capacity/waitlist | ✅     | columns + waitlist flow + tests                |
| Scheduled publish / review workflow  | ✅     | publish_at + review_status + approvals + tests |
| Duplication / templates              | ✅     | duplicate endpoint + tests                     |
| Versions                             | ✅     | snapshots on publish + tests                   |
| CSV course export                    | ✅     | export endpoint + injection-safe               |
| Bulk user/enrollment import          | ✅     | import_jobs + dry-run + tests                  |

## Assessment

| Question banks/pools/difficulty | ✅ | 009 + pool draw at attempt start + tests |
| Essay + manual grading | ✅ | short_answer/essay + grade endpoint + queue |
| Matching/ordering | ✅ | match_value options + grading + tests |
| Explanations / answer release | ✅ | explanation + answer_release policy enforced |
| Negative marking / partial credit | ✅ | per-question negative_points + scoring tests |
| Autosave/recovery | ✅ | attempt_autosaves + tests |
| Cooldowns/availability | ✅ | cooldown_minutes enforced + tests |
| Analytics (difficulty/performance) | ✅ | quiz-performance extended + tests |

## Delivery & business

| Cohorts/programs/paths/competencies | ✅ | 010 + APIs + UI + tests |
| Live classes (providers) | ✅ | 011 + ICS export + registration/attendance + tests |
| Commerce (orders/coupons/invoices) | ✅ | 012 + totals engine + tests |
| Manual payments + provider adapter | ✅ | Midtrans-style signed adapter, signature unit tests; live creds pending |
| Webhook idempotency/replay | ✅ | payment_webhooks unique(event) + tests |
| Refunds/subscriptions | ✅ | state machines + tests |
| Commissions/payouts (manual) | ✅ | refund-aware + approval workflow, labeled manual |
| Affiliates + anti-self-referral | ✅ | expiry + self-check + tests |
| Gifts/bundles/entitlements | ✅ | grant flows + tests |
| SCORM 1.2 | ✅ | import/validate/launch/track/resume + sandboxed player + tests |
| SCORM 2004 | ⚪ | documented gap in `docs/scorm.md` |
| H5P | ⚪ | embed extension point documented, no native runtime |
| AI framework | ✅ | config/jobs/review gate/mocked provider tests; live provider pending |
| Coding exercises | ✅ | static mode live; execution gated behind sandbox provider |
| Email queue | ✅ | queue + status + preferences enforcement; SMTP creds pending |
| Invitations/org units/approvals | ✅ | token invites + units + publish approvals + tests |
| Custom roles/RBAC builder UI | ✅ | catalog + PUT mapping + roles matrix editor + tests |
| SSO/SAML/SCIM | 🚫 | framework note in docs; out of scope this release |

## Platform

Auth/RBAC/tenants/PWA/i18n(a11y pass)/CORS/rate-limit/audit — ✅ tested.
RTL/Arabic — 🚫 deferred (i18n architecture ready, documented).
Native mobile apps — 🚫 out of scope (Flutter-ready API + guide instead).

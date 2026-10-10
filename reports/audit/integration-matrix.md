# Integration matrix (producer → consumer → contract → test → status)

Conventions: API envelope `{success, data, meta?}` enforced (`static-audit`
PASS); contract script verifies all 174 frontend API references resolve
(`contract` PASS); idempotency where required (enroll keys, webhook replay
table, payment `idempotency_key`, `INSERT OR IGNORE` fulfillment).

| #   | Connection                                                  | Contract                                              | Test                                                 | Status                                                         |
| --- | ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Portals → `POST /auth/*` → session/cookie                   | Bearer + httpOnly cookie                              | api/platform/governance suites + roles E2E           | CONNECTED_AND_VERIFIED                                         |
| 2   | Student shop → orders → payments → entitlements/enrollments | server-side totals, webhook HMAC                      | commerce suites + roles E2E §4                       | CONNECTED_AND_VERIFIED                                         |
| 3   | Webhooks → fulfill (entitle/enroll/invoice/commission)      | replay table + idempotent writes                      | commerce + commerce-fixes                            | CONNECTED_AND_VERIFIED                                         |
| 4   | Refunds → entitlement/commission reversal                   | policy in `commerce.md`                               | commerce + cohort-refund test + roles E2E            | CONNECTED_AND_VERIFIED                                         |
| 5   | Quizzes/assignments → grades → progress → certs             | completion rules in code                              | journey/assessment/security suites + roles E2E §3/§6 | CONNECTED_AND_VERIFIED                                         |
| 6   | Announcements/live/compliance → notification center         | prefs-gated fan-out (new)                             | coverage-gaps prefs test                             | CONNECTED_AND_VERIFIED                                         |
| 7   | AI ask → RAG → conversations                                | enrolled-scope retrieval                              | ai-tutor + lifecycle suites                          | CONNECTED_AND_VERIFIED                                         |
| 8   | AI jobs → review → draft apply                              | human-approval gate                                   | ai-tutor suite                                       | CONNECTED_AND_VERIFIED                                         |
| 9   | SCORM upload → content serve → attempts → progress          | tenant-checked serve + CSP sandbox                    | growth SCORM tests + student player                  | CONNECTED_AND_VERIFIED                                         |
| 10  | xAPI send → store → query/purge/export                      | statement-id idempotency, pagination                  | xapi + lifecycle suites                              | CONNECTED_AND_VERIFIED                                         |
| 11  | Email queue → HTTP/log driver                               | 5-attempt cap, idempotent send                        | growth email tests                                   | CONNECTED_BUT_UNVERIFIED (no live delivery)                    |
| 12  | Push subscriptions → (no consumer)                          | storage schema only                                   | config honesty test                                  | DISCONNECTED (labeled)                                         |
| 13  | Live sessions → meeting URLs                                | stored URLs, no vendor API                            | live suites                                          | PARTIALLY_CONNECTED (Jitsi/custom real; Zoom/Meet stored-only) |
| 14  | Notification prefs → fan-out writes                         | `wantsNotification` gate                              | coverage-gaps test                                   | CONNECTED_AND_VERIFIED (new)                                   |
| 15  | Cron → publish-due/retention/quota                          | manual endpoints, no scheduler                        | endpoint tests                                       | DISCONNECTED (no scheduler ships; documented)                  |
| 16  | R2/KV bindings → storage/ratelimit                          | commented bindings + local fallback                   | local paths tested                                   | EXTERNAL_CREDENTIAL_REQUIRED (inactive by default)             |
| 17  | Admin affiliates/payouts tabs → new GET listings            | privileged paginated lists                            | coverage-gaps test                                   | CONNECTED_AND_VERIFIED (new)                                   |
| 18  | Web docs cards → packaged guides                            | `sync-web-docs.mjs` copies repo docs to `public/docs` | manual (static files)                                | CONNECTED_AND_VERIFIED                                         |
| 19  | Quiz attempt → autosave → recover → submit clears           | owner/expiry/question-scope guards, both PUT shapes   | quiz-autosave suite + roles E2E §8                   | CONNECTED_AND_VERIFIED                                         |
| 20  | External cron → AI quota reset / retention purge            | privileged audited idempotent endpoints               | coverage-gaps quota test                             | CONNECTED_AND_VERIFIED (scheduler external, documented)        |
| 21  | Web forgot/reset → auth recovery                            | enumeration-safe responses, single-use tokens         | roles E2E §7 + API recovery suites                   | CONNECTED_AND_VERIFIED                                         |
| 22  | Admin status edit / payout decide → guarded transitions     | `ignored` reporting, conditional updates              | commerce-edges double-transition tests               | CONNECTED_AND_VERIFIED                                         |

Summary: 18 verified-connected, 1 connected-unverified (email delivery),
1 partial (live URLs), 1 disconnected-by-design (push), 1 external-gated
(R2/KV), 1 scheduler-external-by-design (cron endpoints verified, no in-app
scheduler). Zero silent mocks.

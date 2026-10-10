# Competitive benchmark (checked October 2026)

Sources: vendor sites/docs/GitHub observed this week (Rocket LMS demo/storefront,
Frappe Learning site + docs + GitHub, Moodle/Open edX/LearnHouse public feature
pages). Capability-level comparison only — no copied text, assets, or branding.

| Capability                         | Rocket LMS           | Academy/Infix | Frappe Learning | Moodle                | Open edX  | LearnHouse | **LMS Headless (this release)**                                                                                              |
| ---------------------------------- | -------------------- | ------------- | --------------- | --------------------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Course builder (chapters/sections) | yes                  | yes           | yes (chapters)  | yes                   | yes       | yes        | **yes** (sections/lessons/order/versions)                                                                                    |
| Quizzes + banks                    | yes                  | yes           | yes             | yes                   | yes       | yes        | **yes** (banks, pools, negative marking, manual grade)                                                                       |
| Assignments                        | yes                  | yes           | yes             | yes                   | yes       | yes        | **yes** (+resubmit rules, file meta)                                                                                         |
| Live classes                       | yes (multi-provider) | yes           | yes (Zoom)      | plugins               | yes       | yes        | **partial** (scheduling/ICS/attendance real; jitsi rooms + custom URLs stored; Zoom/Meet need customer OAuth, no vendor API) |
| Batches/cohorts                    | n/a (marketplace)    | yes           | yes             | groups                | cohorts   | yes        | **yes** (cohorts + programs + paths)                                                                                         |
| SCORM                              | —                    | yes           | yes             | yes                   | —         | —          | **yes 1.2** (import/launch/track; 2004 deferred, documented)                                                                 |
| Certificates + verify              | yes                  | yes           | yes             | yes                   | yes       | yes        | **yes** (+revoke/bulk/expiry)                                                                                                |
| Commerce/coupons                   | yes                  | yes           | yes             | plugins               | ecommerce | yes        | **yes** (orders/coupons/manual + adapter w/ tested signatures)                                                               |
| Instructor commission              | yes                  | yes           | —               | —                     | —         | —          | **yes** (refund-aware, manual payouts labeled)                                                                               |
| Affiliates                         | yes                  | yes           | —               | —                     | —         | —          | **yes** (+anti-self-referral)                                                                                                |
| Multi-org/white-label              | org system           | —             | —               | multi-tenancy plugins | sites     | —          | **yes** (tenant isolation tested)                                                                                            |
| API-first/headless                 | no (monolith)        | partial       | REST            | WS API                | APIs      | API        | **yes** (versioned REST + OpenAPI + Flutter guide)                                                                           |
| PWA/offline                        | —                    | apps          | —               | app                   | —         | —          | **yes** (installable, offline shell, idempotent sync)                                                                        |
| AI assistance                      | —                    | —             | —               | plugins               | —         | yes        | **framework** (BYOK, review-gated, mocked tests)                                                                             |
| Coding exercises                   | —                    | —             | —               | plugins               | yes (ORA) | —          | **yes** (static mode; sandbox-gated execution)                                                                               |
| Import/export CSV                  | yes                  | yes           | yes             | yes                   | yes       | —          | **yes** (dry-run, row errors, rollback-safe)                                                                                 |

Where we deliberately differ: no native mobile apps in-repo (Flutter-ready API
instead), no live payment verification without merchant credentials, no
high-stakes proctoring claims, SCORM 2004 deferred with documented gaps.

# Capability matrix vs competitors (October 2026)

Sources checked this week: Rocket LMS storefront/about pages, Frappe Learning
site/docs/GitHub, Moodle/Open edX/LearnHouse public feature pages. Verified =
observed in product/docs; claim = vendor marketing, not independently verified.

| Area                         | Rocket        | Frappe           | Moodle         | Us (verified)                                              |
| ---------------------------- | ------------- | ---------------- | -------------- | ---------------------------------------------------------- |
| Course builder + versions    | claim         | claim (chapters) | claim          | **verified** (tests)                                       |
| Question banks + pools       | claim         | claim            | claim          | **verified**                                               |
| Manual/essay grading         | claim         | claim            | claim          | **verified**                                               |
| Live classes                 | claim (multi) | claim (Zoom)     | claim (plugin) | **verified** (provider abstraction + tests)                |
| Batches/cohorts              | n/a           | claim            | claim          | **verified**                                               |
| SCORM                        | —             | claim            | claim          | **verified 1.2**; 2004 honestly absent                     |
| Certificates + public verify | claim         | claim            | claim          | **verified** (+revoke/bulk/expiry)                         |
| Commerce + coupons           | claim         | claim            | claim (plugin) | **verified** (manual + signed adapter; live creds pending) |
| Commissions/affiliates       | claim         | —                | —              | **verified** (manual payouts labeled)                      |
| Multi-tenancy                | claim (orgs)  | —                | claim (plugin) | **verified** (isolation tests)                             |
| Headless API + OpenAPI       | —             | partial          | partial        | **verified** (contract script + tests)                     |
| PWA + offline sync           | —             | —                | app            | **verified** (assets + behavior tests)                     |
| AI assistance                | —             | —                | plugin         | **framework verified** (live provider pending)             |
| Email/push delivery          | claim         | claim            | claim          | **architecture verified** (delivery needs keys)            |
| Import/export                | claim         | claim            | claim          | **verified** (dry-run, row errors)                         |

No competitor source code, text, or assets were copied. Where vendors claim
and we verified, the differentiator is tested guarantees (isolation,
idempotency, webhook signatures, reuse detection) rather than feature count.

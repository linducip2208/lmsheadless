# Browser E2E results (Playwright 1.64.0, chromium)

Command: `npm --workspace apps/web run test:e2e` → **15/15 PASS** (~9s).

| Spec               | Tests                                                                                                                                                                                                                                                                                                                                           | Result   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `smoke.spec.ts`    | home+ID toggle, catalog-vs-live-API, unknown-cert honesty, docs reachability                                                                                                                                                                                                                                                                    | 4/4 PASS |
| `pwa-a11y.spec.ts` | SW offline shell, no private API pre-cache, a11y smoke                                                                                                                                                                                                                                                                                          | 3/3 PASS |
| `roles.spec.ts`    | 1. auth register/login/401s; 2. admin course draft→publish→catalog; 3. teacher quiz/assignment→student attempt→grade; 4. commerce order→webhook→duplicate→refund→dropped; 5. cross-student/parent/teacher-403 negatives; 6. cert auto-issue→verify→revoke→invalid; 7. forgot-always-200 + bad-token-400; 8. autosave save→reload→submit→cleared | 8/8 PASS |

Method: `page.request` against the live dev API (`:8787`, seeded DB) with
timestamp-unique fixtures; every step asserts status AND re-GET effect.
Portal SPAs (admin/teacher/student/parent) are covered at API-contract level
(174 frontend refs resolve, `contract` PASS); per-portal browser CRUD remains
a gap (see `known-limitations.md`). No console-error or network-failure
tolerance: specs fail on unexpected non-2xx.

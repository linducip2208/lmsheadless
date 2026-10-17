# Browser workflows (Playwright chromium, 21/21 this session 2026-10-17, HEAD 5ca54fb)

Single clean run (21/21): 20 prior specs + new
`e2e/admin-payment-confirm.spec.ts` (real browser click on the admin
manual-payment Confirm button; one cold-load `waitForURL` retry on the
parent spec in the same run — documented flake class, pass on retry;
standalone re-runs green).

Config: `apps/web/playwright.config.ts` — API + 5 portal dev servers,
`workers: 1` (shared SQLite + cold vite transforms flake under parallel
load), portal-crud spec timeout 120s, test-only raised rate limits
(production defaults unchanged). Every spec uses disposable fixtures and
asserts server state via re-GET, never toast-only.

## Real-browser portal CRUD (`e2e/portal-crud.spec.ts`, 4/4)

| Portal  | Flow (open → create → list → reload → edit/delete → re-verify)                                                | Result |
| ------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Admin   | login → `#/users` create user via modal → roster shows → reload persists → delete with confirm → API 404/403  | PASS   |
| Teacher | login → `#/courses/:id` add section via modal → list shows → reload persists → API confirms → fixture cleanup | PASS   |
| Student | login → `#/shop` free enroll → home shows → Learn tab complete → reload → API progress 100%                   | PASS   |
| Parent  | login → linked child visible → detail opens → fresh parent sees honest empty state                            | PASS   |

Console/page errors and 5xx responses are collected per test and asserted
empty. Two real product bugs were found and fixed by these specs: missing
instructor-assignment API (new endpoints + tests) and hashchange router
races (serialized navigation in all 5 portals).

## API-via-Playwright journeys (`e2e/roles.spec.ts`, 8/8)

Auth, admin publish, teacher→student→grade, commerce webhook→refund,
cross-student/parent negatives, cert revoke, password recovery, quiz
autosave save→reload→submit→cleared.

## Public site + PWA/a11y (`smoke` 4/4, `pwa-a11y` 3/3)

Home + ID toggle, live catalog, unknown-cert honesty, docs reachability,
offline shell, no-private-cache, named controls.

## Student multi-select (`e2e/student-multiselect.spec.ts`, 1/1)

API fixtures (course + pooled multi-select quiz + enrolled student), then real
UI: login → course → quiz tab → start attempt → check the exact correct
checkboxes → submit → rendered score 100 → attempts API re-read (score 100,
`graded`). Zero page errors / 5xx.

## Admin payment confirm (`e2e/admin-payment-confirm.spec.ts`, 1/1)

API fixtures (paid course + buyer + pending order + manual payment claim),
then real UI: admin login → `#/commerce` → Orders tab → the exact
`data-confirm` button for the seeded payment → in-app dialog (`[data-ok]`,
no native confirm) → button disappears → server re-read: payment `paid`,
order `paid`, active enrollment granted. Zero page errors / 5xx. Cleanup:
course deleted via API; buyer user deleted (RBAC 403 path asserted, then
super_admin fallback) so order/payments cascade away.

## Not browser-covered (disclosed)

Per-route CRUD of every admin tab (cohorts/quizzes/assignments/attendance/
live/scorm/other commerce tabs/data/grades/reports/settings), teacher
banks/grading/attendance-save clicks, student discussion/shop-buy clicks,
parent revoked-link UI. All are covered at API-integration level
(6,379 call-sites, 105 e2e-invoked endpoints); portal-CRUD expansion
remains the top E2E backlog item.

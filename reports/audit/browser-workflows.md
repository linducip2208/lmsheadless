# Browser workflows (Playwright chromium, 19/19 ×2 consecutive runs)

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

## Not browser-covered (disclosed)

Per-route CRUD of every admin tab (cohorts/quizzes/assignments/attendance/
live/scorm/commerce/data/grades/reports/settings), teacher banks/grading/
attendance-save clicks, student quiz submit/discussion/shop-buy clicks,
parent revoked-link UI. All are covered at API-integration level (5,690
call-sites, 105 e2e-invoked endpoints); portal-CRUD expansion remains the
top E2E backlog item.

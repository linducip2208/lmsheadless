# Browser workflows (Playwright chromium, 29/29 this session 2026-10-18, round 4)

Full-suite run 29/29: 21 prior specs + 8 new round-4 specs
(`e2e/portal-admin-tabs.spec.ts` 3/3, `e2e/teacher-workflows.spec.ts` 3/3,
`e2e/student-workflows.spec.ts` 2/2). Two pre-existing specs
(portal-crud teacher section, student-multiselect) flaked once under
full-suite load and passed on retry; both pass standalone (5/5) —
documented cold-load flake class, not a regression from round-4 changes
(untouched routes).

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

## Admin tab CRUD (`e2e/portal-admin-tabs.spec.ts`, 3/3 — round 4)

API fixtures (member student, course), then real UI on `#/cohorts`:
create cohort (capacity 25) → roster badge after member add → server
re-read (capacity, member role) → in-app confirm delete → row gone
server-side. Programs tab: create path → attach course via modal →
ordered course list rendered from the server JOIN → in-app confirm
delete → gone. Settings → org branding: footer edit through the modal
merges (sentinel settings key survives), PUT synced, public branding
re-read, then **reload proves persistence**; restore through the same UI
path. Zero page errors / 5xx.

This spec found a real bug: overlapping settings renders let a stale
branding fetch paint last (PUT 200 + fresh GET proven in trace, DOM
still old). Fixed with a generation guard in `renderOrgSettings`; the
spec additionally syncs on the PUT response.

## Teacher workflows (`e2e/teacher-workflows.spec.ts`, 3/3 — round 4)

Banks: create bank → add single-choice question via modal (`*` marks the
correct line) → questions list renders the prompt → in-app confirm
delete → bank gone server-side (questions/options cascaded). Grading:
fixture submission appears in the queue → grade modal (score 90 +
feedback) → queue row disappears (`status != 'graded'` filter, not a
badge flip) → server re-read `graded`/90. Attendance: instructor
assignment fixture (assignment-scoped dropdown source) → create session
→ take attendance with per-student selects → save records (POST synced)
→ aggregated report shows 1 record / 100% → in-app confirm delete →
session gone. Zero page errors / 5xx.

## Student workflows (`e2e/student-workflows.spec.ts`, 2/2 — round 4)

Discussion: enrolled student posts a thread through the Talk tab modal,
replies through the inline form; server re-reads threads + replies; the
author's DELETE attempt honestly 403s (no delete button in student UI by
design); admin moderation delete verified in cleanup. Shop buy: published
paid course → `#/more` sets the portal org (order POST requires it) →
buy → coupon modal → pending-payment dialog → manual claim synced →
server: order `pending` with a `pending` manual payment, and NO
enrollment (paid gate honest until admin confirm). Buyer + course
fixtures cleaned (user delete cascades orders/payments). Zero page
errors / 5xx.

## Not browser-covered (disclosed, narrowed by round 4)

Round 4 closed the cohorts/programs/settings-org, banks/grading/
attendance, discussion/shop-buy gaps. Still API-verified only: admin
quizzes/assignments/attendance-create/live/scorm/data/grades/reports/
community/files/certificates tabs and global/audit settings tabs;
teacher live/cohorts/AI/exercises/students-detail; student
grades/live/programs/tutor/scorm; parent revoked-link UI. All are covered
at API-integration level (7,325 call-sites, 132 e2e-invoked endpoints);
the remaining per-route expansion is still the top E2E backlog item.

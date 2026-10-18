# Browser workflows (Playwright chromium, 70/70 this session 2026-10-18, round 6)

Full-suite run 70/70 with zero flakes: 42 prior specs + 28 new round-6
specs (`portal-admin-live` 1/1, `portal-data` 3/3, `teacher-cohorts-ai`
2/2, `student-explore` 3/3, `portal-admin-orgs` 3/3, `portal-admin-more`
4/4, `portal-admin-insight` 4/4, `portal-commerce-more` 2/2,
`student-submit` 2/2, `teacher-profile` 1/1, `student-commerce` 3/3).
Round 6 found one more real product bug (navigation downloads always
401 — fixed via shared `downloadFile()` helper, proven byte-exact) and
closed the per-route residue: every portal route now has real-browser
CRUD + key-action coverage with server re-verification.

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

## Admin assessment tabs (`e2e/portal-admin-assess.spec.ts`, 4/4 — round 5)

Quizzes: create quiz via modal → two true_false questions (two-step
modal) → edit prompt → reorder down (positions swap server-verified) →
in-app confirm delete → one remains → performance card renders honest
zeros. Assignments: create → student submits via API → review table →
two-criterion rubric modal → grade with rubric JSON → `graded`/80
server-verified. Gradebook: record via modal → unfiltered list shows the
row (roster-default fix) → student filter → feedback persists.
Certificates: issue form → verify form shows Valid → in-app confirm
revoke → REVOKED → public verify `valid:false`. Zero page errors / 5xx.

## Teacher second wave (`e2e/teacher-more.spec.ts`, 3/3 — round 5)

Students roster shows the enrollee; progress detail expands (server
progress backing it). Live: Jitsi session scheduled via modal (no
external creds), listed with join link, `scheduled` server-side, cleaned
via cancel state machine. Exercises: static-mode create via form (form
resets on success), `execution_mode: static` server-verified. Zero page
errors / 5xx.

## Family loop (`e2e/portal-family.spec.ts`, 2/2 — round 5)

Student `#/grades` renders the teacher-posted grade (category + score)
and the issued certificate number. Parent: fresh linked child visible
with detail; after admin revoke through the new endpoint, reload shows
the honest empty state. Zero page errors / 5xx.

## Admin ops tabs (`e2e/portal-admin-ops.spec.ts`, 4/4 — round 5)

Community: course-scoped announcement via modal, listed + org-served
(no delete endpoint ships — published notices are history; fixture row
documented). Files: real file-input upload (exercising the token fix),
listed with working download href, size verified. Global settings as
super_admin: footer merge with PUT-sync + reload persistence + restore;
audit tab renders real rows. SCORM: non-zip rejected with a clear
package error; a hand-built valid 1.2 package (stored-zip builder,
CRC-correct) imports and lists with `version: 1.2` — proving the jszip
interop fix. Zero page errors / 5xx.

## Round 6 specs (all green, server re-verified, zero page errors / 5xx)

- `portal-admin-live` (1/1): schedule → reschedule (server start moves) →
  record attendance (response `recorded: 1`) → cancel (badge + server
  `cancelled`) → `.ics` downloads with `BEGIN:VCALENDAR`.
- `portal-data` (3/3): users CSV dry-run (`valid: 2`, job `dry_run`,
  empty error detail, nothing written); AI mock config + outline job +
  review-approve (`reviewed_at` set); invites full loop
  (invite_url token → accept 201 → login works).
- `teacher-cohorts-ai` (2/2): cohort roster + progress expand; mock
  outline renders draft with review label, job listed.
- `student-explore` (3/3): live register → registration row; programs
  detail → enroll → active; tutor mock ask → answer + stored
  conversation; SCORM player → bookmark + mark-done → attempt completed.
- `portal-admin-orgs` (3/3): org create + search + manage (member add,
  brand edit with reload persistence); roles remap with try/finally
  restore; dashboard cards equal server summary.
- `portal-admin-more` (4/4): attendance with notes; discussions
  create + replies; bundles create/publish/view; coupons + affiliates
  - plans modals.
- `portal-admin-insight` (4/4): reports overview + attendance CSV bytes;
  alerts run + dismiss; announcement → mark-read → unread 0; system
  status `ok`; exercises create; email queue + log-driver send.
- `portal-commerce-more` (2/2): payouts approve (`paid`) + reject
  (`rejected`) + double-decide 400; revenue cards + global search finds
  fixtures.
- `student-submit` (2/2): assignment submit → teacher sees body;
  exercise submit → teacher sees code.
- `teacher-profile` (1/1): password change via UI on fixture account
  (new logs in, old 401s; seeds untouched).
- `student-commerce` (3/3): bundle buy → pending + claim; plan buy →
  pending subscription row; gift loop (paid → code → redeem → active).

## Not browser-covered (disclosed)

Nothing in LMS scope remains API-only at route/action level: every portal
route listed in each app's router/nav has at least one real-browser flow
with server re-verification (24 spec files, 70 tests). Deliberately
un-automated: live vendor OAuth and live-send paths (BLOCKED_EXTERNAL —
no credentials by design), production cron execution (needs real deploy).
Flake record: one transient API single-failure (round 4, unidentified,
never recurred); one E2E flaky-retry in an intermediate round-6 run
(full re-runs green); cold-load class documented, never suppressed.
(Round-5 residue note, now closed: that round left admin live tab and
data/imports UI, teacher cohorts and AI-draft views, student
live/programs/tutor/SCORM-player views API-only — all covered by round
6 above.)

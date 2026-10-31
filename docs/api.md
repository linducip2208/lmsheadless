# API reference (human companion to `/api/v1/openapi.json`)

Base: `/api/v1`. Envelope: `{success:true,data,meta?}` /
`{success:false,error:{code,message,details?,requestId?}}`.
Pagination: `?page&per_page&q&sort&order`. Auth: `Authorization: Bearer <jwt>`
(Flutter/tests) or httpOnly cookie + in-memory token (web portals).
Writes accept `Idempotency-Key` for safe retries.

## Auth (`/auth/*`)

`register · login(?cookie=1) · refresh (body token or cookie) · logout ·
me · sessions · sessions/:id (revoke) · sessions/revoke-all ·
password/change · password/forgot · password/reset · verify-email`

## Core

- `users` (CRUD, parent links), `users/me/permissions?organization_id=`
- `organizations` (CRUD-lite, members, branding `GET public / PUT`,
  academic-years, terms, classes, subjects)
- `permissions`, `roles` (catalog + mapping)
- `courses` (+ sections/lessons CRUD, reorder endpoints, enrollments,
  lesson completion, progress), `instructor/courses`, `search`
- Quizzes/questions/attempts/submit/grade, assignments/submissions/grade,
  `grading/queue`, grades
- Attendance sessions/records, per-student attendance
- Certificates issue/list + **public** `certificates/verify/:number`
- Announcements, notifications (+unread-count, read-all, preferences),
  discussions + replies, `push/config` + `push/subscriptions`
- Files list + authorized download; `uploads`
- Reports: organization-summary, completion, quiz-performance, attendance,
  teacher-activity, student-progress
- `settings` (super_admin), `setup` + `setup/status` (first-run, locked),
  `audit-logs`

Live machine-readable contract: `/api/v1/openapi.json` (covered by a test
that asserts documented core paths exist on the router).

## Authorization notes (enforced server-side)

- Cross-user reads are org-scoped: `reports/student-progress` and
  `attendance/student` require `organization_id`; `GET /grades` without
  `course_id` returns only grades in orgs where the requester teaches/
  administers or is parent-linked; every row is pinned via `JOIN courses`.
- `question-banks/:id/questions` requires a teaching role (same as writes).
- `cohorts/:id/members` returns emails only to teaching/admin actors;
  students see fellow members, parents see cohorts containing a linked child.
- Parent links are per-organization (`parent_links` unique per
  parent+student+org); a link in org A never authorizes org B.
- `GET /courses` hides `draft` from non-teaching roles; draft detail is 404.
- `POST /xapi/statements` rejects missing `organization_id` (400).
- Public `certificates/verify/:number` is throttled per IP (60/min).

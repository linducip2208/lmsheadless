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

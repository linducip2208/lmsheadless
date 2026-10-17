# Course authoring guide

## Structure

Course → Sections (ordered) → Lessons (ordered). Tags group courses;
prerequisites gate enrollment (course) and completion (lesson).

## States & workflow

`draft → published → archived`. Optional approval: set organization setting
`require_approval=true`; teacher publish actions become approval requests
(`POST /courses/:id/request-approval`), decided at `POST /publish-approvals/:id/approve|reject`.
`publish_at` enables scheduled publishing, now **automatic**: the Worker's
cron handler publishes due drafts daily at 00:00 Asia/Jakarta (approval
workflow takes precedence; audit `sys.cron.publish_due`). The manual
`POST /courses/publish-due` endpoint stays available for admin-triggered runs.

## Access control

- `visibility`: private (members), unlisted (link), public (catalog).
- `enrollment_mode`: open | approval | closed.
- Windows (`enrollment_start/end`), `capacity` (+ waitlist join/promote),
  `access_days` (entitlement expiry enforced on learn/quiz/assignment calls).
- Paid courses (`price > 0`) require a live `entitlements` row — granted by
  order fulfillment, gifts, or cohort purchase. No client bypass: every
  learn/progress/attempt/submit endpoint re-checks.

## Drip & prerequisites

- `drip_rules`: `days_after_enrollment` or fixed `unlock_at` per lesson,
  enforced in `POST /lessons/:id/complete`.
- Lesson completion also enforces `lesson_prerequisites`; enrollment enforces
  `course_prerequisites` (required course must be `completed`) **and program
  locks**: enrolling into a program-placed course whose
  `prerequisite_program_course_id` is unfinished fails with
  `PROGRAM_LOCKED` (manual placement via direct inserts by cohort/commerce/
  import flows remains documented as privileged bypass).

## Reuse & history

- `POST /courses/:id/duplicate` deep-copies structure as a new draft
  (enrollments/progress never copied).
- Every publish writes a `course_versions` snapshot (`GET /courses/:id/versions`).
- Instructor notes (`/lessons/:id/notes`) are teacher-only and never appear
  in student payloads.
- CSV export (`GET /courses/export`) is formula-injection safe.

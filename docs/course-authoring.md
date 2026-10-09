# Course authoring guide

## Structure

Course → Sections (ordered) → Lessons (ordered). Tags group courses;
prerequisites gate enrollment (course) and completion (lesson).

## States & workflow

`draft → published → archived`. Optional approval: set organization setting
`require_approval=true`; teacher publish actions become approval requests
(`POST /courses/:id/request-approval`), decided at `POST /publish-approvals/:id/approve|reject`.
`publish_at` + `POST /courses/publish-due` enables scheduled publishing
(call it from Workers Cron or an admin action — documented, not automatic).

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
  `course_prerequisites` (required course must be `completed`).

## Reuse & history

- `POST /courses/:id/duplicate` deep-copies structure as a new draft
  (enrollments/progress never copied).
- Every publish writes a `course_versions` snapshot (`GET /courses/:id/versions`).
- Instructor notes (`/lessons/:id/notes`) are teacher-only and never appear
  in student payloads.
- CSV export (`GET /courses/export`) is formula-injection safe.

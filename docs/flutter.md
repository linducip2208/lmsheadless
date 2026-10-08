# Flutter integration guide

The API is built so a Flutter Android/iOS app can use it without any web UI.

## Principles

- Predictable JSON: `{success:true,data,meta?}` / `{success:false,error:{code,message}}`.
- Pagination everywhere list-shaped: `?page&per_page&q&sort&order` → `meta{page,perPage,total,totalPages}`.
- Stable IDs (UUID strings), ISO-8601 timestamps (parse with `DateTime.parse`, display with the device locale/timezone).
- File/image URLs: upload responses return `key` + metadata; downloads via `GET /api/v1/files/:id/download` (authenticated).
- Error codes are stable strings (`VALIDATION_ERROR`, `TENANT_DENIED`, `ATTEMPT_LIMIT`, `ATTEMPT_EXPIRED`, `RESUBMIT_NOT_ALLOWED`, …) — switch on `error.code`, not messages.

## Auth flow (recommended for mobile)

1. `POST /api/v1/auth/login {"email","password"}` → store `access_token` (memory/secure storage) + `refresh_token` (**flutter_secure_storage**, never plain prefs).
2. `Authorization: Bearer <access_token>` on every call.
3. On `401`: `POST /api/v1/auth/refresh {"refresh_token"}` → replace both tokens (rotation; old refresh is single-use).
4. `POST /api/v1/auth/logout` with the refresh token; `DELETE /api/v1/auth/sessions/:id` per device; `POST /api/v1/auth/sessions/revoke-all` on “log out everywhere”.

## Offline-friendly patterns

- Cache GETs (courses, lessons, announcements) locally; show `updated_at` staleness.
- Queue writes (lesson completion, quiz submit, assignment submit) and replay with a client-generated `Idempotency-Key` header — the server returns the original response instead of duplicating.
- Quiz attempts: `POST …/attempts` resumes an in-progress attempt; `expires_at` tells the client when to stop the timer; late submits get `ATTEMPT_EXPIRED`.

## Suggested screens ↔ endpoints

- Catalog: `GET /courses?organization_id=` · Detail: `GET /courses/:id` + `/:id/sections` + `/sections/:sid/lessons`
- Enroll: `POST /enrollments` · Progress: `GET /courses/:id/progress`
- Quiz: `GET /quizzes?course_id=` → `GET /quizzes/:id/questions` → `POST …/attempts` → `POST /quiz-attempts/:id/submit`
- Tasks: `GET /assignments?course_id=` → `POST /assignments/:id/submissions`
- Grades/certificates/attendance/notifications: `GET /grades`, `/certificates`, `/attendance/student`, `/notifications`

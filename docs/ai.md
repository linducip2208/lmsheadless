# AI integration (optional framework)

Core LMS works with AI fully `disabled` (default). Enable per organization:

1. `PUT /ai/config` — `mock` (deterministic trials) or `openai-compatible`
   (BYOK: `base_url` + `api_key` required; keys live in the org's own database,
   prefer secret bindings in production).
2. `POST /ai/jobs` — kinds: `outline | lesson_draft | questions | summary`.
   Monthly limits enforced; every output labeled **requires instructor review**.
3. `POST /ai/jobs/:id/review` — approve/reject; nothing publishes automatically.

## Guardrails

- 8s provider timeout; failures recorded, never silent.
- Review gate before any use; generated text never alters grades, issues
  credentials, or executes privileged operations.
- No private student records are sent as model input — jobs carry only the
  instructor-supplied `input_ref` topic/material.
- Live-provider verification is **pending** (mocked contract paths tested);
  label accordingly in product demos.

## Coding exercises

`POST /exercises` (static review mode) → student `POST …/submissions`
(stored, attempt-limited) → teacher feedback. `execute: true` returns
`EXECUTION_UNAVAILABLE` unless a tested sandbox integration is configured —
learner code is **never** run inside the Worker/API process. See `docs/exercises.md`.

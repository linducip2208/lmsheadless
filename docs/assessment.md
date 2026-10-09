# Assessment guide

## Banks & pools

Reusable `question_banks` (difficulty, category, tags, explanations, negative
points) feed quizzes via copy (`copy-to`) or random `quiz_pools` (snapshot at
first attempt — documented).

## Types & grading

`multiple_choice | single_choice | true_false | short_answer | essay |
matching | ordering`. Auto-graded except `essay` (manual queue, attempt stays
`submitted`). Matching answers: `{"pairs": {optionId: matchText}}`; ordering:
`{"order": [optionIds]}`. `negative_points` apply only when the quiz opts into
`negative_marking`; totals clamp at zero.

## Integrity

- Attempt limits, `cooldown_minutes`, `time_limit_minutes` with server-side
  `expires_at`; single in-progress attempt (resume, never duplicate).
- Correctness never leaks: student question reads omit `is_correct`/
  `match_value`/`correct_answer`; ordering options shuffle per fetch.
- `answer_release: never` hides scores from submit responses.
- Autosave (`PUT …/autosave`) recovers drafts; submit clears them.
- Idempotent submits via `Idempotency-Key`; manual re-grade recomputes
  deterministically from stored points.

## Analytics

`GET /reports/quiz-performance` (attempts, average, pass rate, per-question
correct rate). Teachers grade essays at `POST /quiz-attempts/:id/grade`.

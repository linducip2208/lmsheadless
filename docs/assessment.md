# Assessment guide

## Banks & pools

Reusable `question_banks` (difficulty, category, tags, explanations, negative
points) feed quizzes via copy (`copy-to`) or random `quiz_pools`. Pool draws
are snapshotted **per attempt**: each attempt gets its own question copies
(`attempt_id`-scoped), so concurrent attempts never corrupt each other and the
pool template stays reusable. The player fetches
`GET /quizzes/:id/questions?attempt_id=…` (shared + own draws); submit,
autosave, and re-grade accept shared rows plus the caller's own drawn copies.
Per-question analytics (`quiz-performance`) cover shared items only; drawn
copies are attempt history.

## Types & grading

`multiple_choice | single_choice | true_false | short_answer | essay |
matching | ordering`. Auto-graded except `essay` (manual queue, attempt stays
`submitted`). `multiple_choice` submits `option_ids[]` and earns full credit
only for the exact correct set (no partial credit); `single_choice` submits
one `option_id`. Matching answers: `{"pairs": {optionId: matchText}}`;
ordering: `{"order": [optionIds]}`. Scores always divide by the whole quiz —
skipped questions score zero and cannot inflate results (same rule in manual
re-grade). `negative_points` apply only when the quiz opts into
`negative_marking`; totals clamp at zero.

## Integrity

- Attempt limits, `cooldown_minutes`, `time_limit_minutes` with server-side
  `expires_at`; single in-progress attempt (resume, never duplicate).
- Correctness never leaks: student AND parent question reads omit
  `is_correct`/`match_value`/`correct_answer`; ordering options shuffle per
  fetch.
- `answer_release: never` hides scores from submit responses.
- Autosave (`PUT /quiz-attempts/:id/autosave`, drafts read back via
  `GET …/autosave`) recovers drafts across reloads/crashes/devices; the
  student player restores drafts into the form and saves debounced; submit
  clears them. Owner-only, in-progress, unexpired attempts.
- Idempotent submits via `Idempotency-Key`; manual re-grade recomputes
  deterministically from stored points.

## Analytics

`GET /reports/quiz-performance` (attempts, average, pass rate, per-question
correct rate). Teachers grade essays at `POST /quiz-attempts/:id/grade`.

-- 024_attempt_security: per-attempt quiz snapshots + login lockout columns.
-- Per-attempt snapshots stop the first-attempt race that mutated shared quiz
-- rows (and deleted the pool template): each attempt now draws its own
-- question copies (attempt_id), pools survive as reusable templates.
-- Login lockout counters back per-account throttling. Additive only; safe to
-- re-run (bare ALTERs are tolerated by the migrator; patches mirror them).
ALTER TABLE questions ADD COLUMN attempt_id TEXT;
CREATE INDEX IF NOT EXISTS idx_questions_attempt ON questions(quiz_id, attempt_id);
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

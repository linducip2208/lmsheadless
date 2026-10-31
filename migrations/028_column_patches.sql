-- 028: column patches as a real migration file.
-- Background: columns below were historically added by applyColumnPatches()
-- in apps/api/src/migrate.ts, which only runs on local/test boot — never on
-- Cloudflare D1 (`wrangler d1 migrations apply` executes .sql files only).
-- Remote databases are therefore missing these columns. This file applies
-- them declaratively. Rerun-safe: the migrator swallows
-- duplicate-column/already-exists errors, and D1 applies each file once.
ALTER TABLE courses ADD COLUMN slug TEXT;
ALTER TABLE courses ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE courses ADD COLUMN start_at TEXT;
ALTER TABLE courses ADD COLUMN end_at TEXT;
ALTER TABLE courses ADD COLUMN enrollment_mode TEXT NOT NULL DEFAULT 'open';
ALTER TABLE lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE quizzes ADD COLUMN shuffle_questions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD COLUMN allow_resubmit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN allowed_types TEXT;
ALTER TABLE assignments ADD COLUMN max_size_bytes INTEGER NOT NULL DEFAULT 26214400;
ALTER TABLE quiz_attempts ADD COLUMN expires_at TEXT;
ALTER TABLE quiz_attempts ADD COLUMN client_key TEXT;
ALTER TABLE refresh_tokens ADD COLUMN replaced_by TEXT;
ALTER TABLE certificates ADD COLUMN revoked_at TEXT;
ALTER TABLE certificates ADD COLUMN expires_at TEXT;
ALTER TABLE quizzes ADD COLUMN answer_release TEXT NOT NULL DEFAULT 'after_submit';
ALTER TABLE quizzes ADD COLUMN negative_marking INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quizzes ADD COLUMN cooldown_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE questions ADD COLUMN explanation TEXT;
ALTER TABLE questions ADD COLUMN negative_points REAL NOT NULL DEFAULT 0;
ALTER TABLE question_options ADD COLUMN match_value TEXT;
ALTER TABLE courses ADD COLUMN capacity INTEGER;
ALTER TABLE courses ADD COLUMN access_days INTEGER;
ALTER TABLE courses ADD COLUMN enrollment_start TEXT;
ALTER TABLE courses ADD COLUMN enrollment_end TEXT;
ALTER TABLE courses ADD COLUMN publish_at TEXT;
ALTER TABLE courses ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE lessons ADD COLUMN audio_url TEXT;
ALTER TABLE orders ADD COLUMN affiliate_id TEXT;
ALTER TABLE submissions ADD COLUMN rubric_breakdown TEXT;
-- (questions.attempt_id, users.failed_login_count/locked_until ship in 024
-- and are intentionally absent here: D1 aborts a migration file on the first
-- duplicate column, while local reruns tolerate it.)
-- Per-org slug uniqueness (mirrors applyPostPatchConstraints): normalize
-- duplicates first so the index can never fail on a dirty database.
UPDATE courses SET slug = slug || '-' || substr(id, 1, 8) WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id, slug ORDER BY created_at, id) AS rn
    FROM courses WHERE slug IS NOT NULL
  ) WHERE rn > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_org_slug ON courses(organization_id, slug);

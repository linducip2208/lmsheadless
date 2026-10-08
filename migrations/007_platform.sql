-- 007_platform: settings, audit logs, files, idempotency, notification prefs,
-- push subscriptions, course/lesson/quiz/assignment extensions, FTS-lite indexes.
-- SQLite/D1 compatible. Additive only (no breaking changes to 001..006).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  metadata TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_org ON files(organization_id);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idem_user ON idempotency_keys(user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, endpoint)
);

-- Course publishing extensions (nullable/additive; existing rows unaffected)
-- SQLite has no IF NOT EXISTS for ADD COLUMN, so guard in migrate runner.
-- Columns: slug, visibility, start_at, end_at, enrollment_mode
-- Lessons: status (draft/published)
-- Quizzes: shuffle_questions
-- Assignments: allow_resubmit, allowed_types, max_size_bytes

-- Search-supporting indexes (LIKE-prefix friendly; D1/SQLite compatible)
CREATE INDEX IF NOT EXISTS idx_courses_title ON courses(title);
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);
CREATE INDEX IF NOT EXISTS idx_lessons_title ON lessons(title);
CREATE INDEX IF NOT EXISTS idx_ann_title ON announcements(title);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
CREATE INDEX IF NOT EXISTS idx_att_session_date ON attendance_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_grades_created ON grades(created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_created ON quiz_attempts(created_at);

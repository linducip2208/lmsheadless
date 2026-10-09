-- 011_live: provider-based live classes
CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  cohort_id TEXT REFERENCES cohorts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL DEFAULT 'jitsi',
  meeting_url TEXT,
  meeting_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled',
  recording_url TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_org ON live_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_live_start ON live_sessions(starts_at);

CREATE TABLE IF NOT EXISTS live_registrations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TEXT NOT NULL,
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT,
  left_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, user_id)
);

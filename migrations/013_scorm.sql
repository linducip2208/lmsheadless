-- 013_scorm: SCORM 1.2 packages + runtime tracking
CREATE TABLE IF NOT EXISTS scorm_packages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.2',
  entry_url TEXT NOT NULL,
  file_key TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  package_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scorm_attempts (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scorm_packages(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completion TEXT NOT NULL DEFAULT 'incomplete',
  success TEXT NOT NULL DEFAULT 'unknown',
  score REAL,
  location TEXT,
  total_time TEXT NOT NULL DEFAULT '0000:00:00',
  suspend_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scorm_student ON scorm_attempts(student_id);

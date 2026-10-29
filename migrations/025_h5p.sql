-- 025_h5p: minimal native H5P runtime (upload/validate/launch/track)
CREATE TABLE IF NOT EXISTS h5p_packages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  main_library TEXT NOT NULL,
  entry_url TEXT NOT NULL,
  file_key TEXT NOT NULL,
  manifest_json TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_h5p_org ON h5p_packages(organization_id);
CREATE INDEX IF NOT EXISTS idx_h5p_course ON h5p_packages(course_id);

CREATE TABLE IF NOT EXISTS h5p_attempts (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES h5p_packages(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL,
  max_score REAL,
  completed INTEGER NOT NULL DEFAULT 0,
  state TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_h5p_attempt_pkg ON h5p_attempts(package_id);
CREATE INDEX IF NOT EXISTS idx_h5p_attempt_student ON h5p_attempts(student_id);

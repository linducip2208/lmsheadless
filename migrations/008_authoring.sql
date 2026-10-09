-- 008_authoring: tags, prerequisites, drip, waitlist, versions, instructor notes
CREATE TABLE IF NOT EXISTS course_tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS course_tag_links (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES course_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, tag_id)
);

CREATE TABLE IF NOT EXISTS course_prerequisites (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  requires_course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, requires_course_id)
);

CREATE TABLE IF NOT EXISTS lesson_prerequisites (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  requires_lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, requires_lesson_id)
);

-- Drip: unlock lesson N days after enrollment (or on fixed date)
CREATE TABLE IF NOT EXISTS drip_rules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  days_after_enrollment INTEGER,
  unlock_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (lesson_id)
);

CREATE TABLE IF NOT EXISTS instructor_notes (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlists (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT NOT NULL,
  UNIQUE (course_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_waitlist_course ON waitlists(course_id);

CREATE TABLE IF NOT EXISTS course_versions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, version)
);

-- Generic async import jobs (users, enrollments, grades)
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  error_report TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_org ON import_jobs(organization_id);

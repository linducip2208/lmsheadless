-- 002_academic: years, terms, classes, subjects
CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ay_org ON academic_years(organization_id);

CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_org ON terms(organization_id);
CREATE INDEX IF NOT EXISTS idx_terms_ay ON terms(academic_year_id);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
  term_id TEXT REFERENCES terms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  grade_level TEXT,
  homeroom_teacher_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_classes_org ON classes(organization_id);

CREATE TABLE IF NOT EXISTS class_members (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TEXT NOT NULL,
  UNIQUE (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_class ON class_members(class_id);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_subjects_org ON subjects(organization_id);

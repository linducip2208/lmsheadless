-- 010_cohorts: cohorts/batches, programs/paths, competencies
CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  capacity INTEGER,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cohort_org ON cohorts(organization_id);

CREATE TABLE IF NOT EXISTS cohort_members (
  id TEXT PRIMARY KEY,
  cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TEXT NOT NULL,
  UNIQUE (cohort_id, user_id)
);

CREATE TABLE IF NOT EXISTS cohort_courses (
  cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (cohort_id, course_id)
);

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_courses (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  is_required INTEGER NOT NULL DEFAULT 1,
  prerequisite_program_course_id TEXT REFERENCES program_courses(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (program_id, course_id)
);

CREATE TABLE IF NOT EXISTS competencies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competency_links (
  competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (competency_id, course_id)
);

CREATE TABLE IF NOT EXISTS competency_evidence (
  id TEXT PRIMARY KEY,
  competency_id TEXT NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_student ON competency_evidence(student_id);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  achieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 014_growth: AI framework, coding exercises, email queue, invitations, org units, approvals, activity
CREATE TABLE IF NOT EXISTS ai_configs (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'disabled',
  model TEXT,
  api_key_ref TEXT,
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_ref TEXT,
  output_ref TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_org ON ai_jobs(organization_id);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'javascript',
  examples TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'static',
  sandbox_provider TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_submissions (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  feedback TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_queue (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_msg_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_queue(status);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_org ON invitations(organization_id);

CREATE TABLE IF NOT EXISTS org_units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES org_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_unit_members (
  unit_id TEXT NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (unit_id, user_id)
);

CREATE TABLE IF NOT EXISTS publish_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_org ON activity_log(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at);

-- Certificate lifecycle extensions (nullable/additive via patches)
-- certificates: revoked_at, expires_at
-- quizzes: answer_release (default 'after_submit'), negative_marking, cooldown_minutes
-- assignments: allow file info in submission_attachments (exists)

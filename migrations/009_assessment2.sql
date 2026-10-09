-- 009_assessment2: question banks, pools, autosave, matching support
CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_org ON question_banks(organization_id);

CREATE TABLE IF NOT EXISTS bank_questions (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  category TEXT,
  tags TEXT,
  explanation TEXT,
  correct_answer TEXT,
  negative_points REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bq_bank ON bank_questions(bank_id);

CREATE TABLE IF NOT EXISTS bank_options (
  id TEXT PRIMARY KEY,
  bank_question_id TEXT NOT NULL REFERENCES bank_questions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  match_value TEXT,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Random pools: pick N questions from a bank into a quiz at attempt start
CREATE TABLE IF NOT EXISTS quiz_pools (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  pick_count INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

-- Autosaved in-progress answers (recovery across devices/reloads)
CREATE TABLE IF NOT EXISTS attempt_autosaves (
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);

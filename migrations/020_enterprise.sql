-- 020_enterprise: rubrics, late policy, compliance flag, early-warning alerts
CREATE TABLE IF NOT EXISTS rubric_criteria (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  max_points REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  dismissed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(organization_id, status);

ALTER TABLE assignments ADD COLUMN allow_late INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assignments ADD COLUMN late_penalty_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN is_compliance INTEGER NOT NULL DEFAULT 0;

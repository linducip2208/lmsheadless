-- 018_xapi: LRS statement store (xAPI 2.0.0 subset)
CREATE TABLE IF NOT EXISTS xapi_statements (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL UNIQUE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  verb TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_name TEXT,
  result_score REAL,
  result_success INTEGER,
  result_completion INTEGER,
  context TEXT,
  timestamp TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xapi_actor ON xapi_statements(actor_id);
CREATE INDEX IF NOT EXISTS idx_xapi_verb ON xapi_statements(verb);
CREATE INDEX IF NOT EXISTS idx_xapi_object ON xapi_statements(object_id);
CREATE INDEX IF NOT EXISTS idx_xapi_stored ON xapi_statements(stored_at);

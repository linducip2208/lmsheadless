-- 016_enrollment_requests: approval workflow for enrollment_mode = 'approval'
CREATE TABLE IF NOT EXISTS enrollment_requests (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (course_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_enr_req_course ON enrollment_requests(course_id);

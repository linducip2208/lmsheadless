-- 027: integrity batch from the enterprise repair audit (additive, rerun-safe).
-- SQLite + Cloudflare D1 compatible. No table may fail a dirty database boot:
-- every statement below is IF NOT EXISTS / OR IGNORE / data-preserving.

-- ---- Join/filter indexes (report + roster + grading hot paths) ----
CREATE INDEX IF NOT EXISTS idx_questions_attempt_id ON questions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_question ON quiz_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_lesson_attachments_lesson ON lesson_attachments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_submission_attachments_sub ON submission_attachments(submission_id);
CREATE INDEX IF NOT EXISTS idx_course_instructors_course ON course_instructors(course_id);
CREATE INDEX IF NOT EXISTS idx_course_instructors_user ON course_instructors(user_id);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members_cohort ON cohort_members(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members_user ON cohort_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cohort_courses_cohort ON cohort_courses(cohort_id);
CREATE INDEX IF NOT EXISTS idx_program_courses_program ON program_courses(program_id);
CREATE INDEX IF NOT EXISTS idx_live_reg_session ON live_registrations(session_id);
CREATE INDEX IF NOT EXISTS idx_live_att_session ON live_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_orders_kind_ref ON orders(kind, reference_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_kind ON activity_log(kind);
CREATE INDEX IF NOT EXISTS idx_email_org_status ON email_queue(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_grades_course_student ON grades(course_id, student_id);

-- ---- parent_links: scope the pair uniqueness per organization ----
-- A parent linked to the same student in two organizations was rejected by
-- UNIQUE(parent_id, student_id). Rebuild preserves every row (the old
-- constraint guarantees no exact-triple conflicts can exist).
CREATE TABLE IF NOT EXISTS parent_links_new (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (parent_id, student_id, organization_id)
);
INSERT OR IGNORE INTO parent_links_new (id, parent_id, student_id, organization_id, created_at)
  SELECT id, parent_id, student_id, organization_id, created_at FROM parent_links;
DROP TABLE IF EXISTS parent_links;
ALTER TABLE parent_links_new RENAME TO parent_links;
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_links_student ON parent_links(student_id);

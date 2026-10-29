-- 026_audit_request: correlate audit rows with X-Request-Id (idea 99)
ALTER TABLE audit_logs ADD COLUMN request_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_logs(request_id);

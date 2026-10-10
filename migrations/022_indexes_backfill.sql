-- 022_indexes_backfill: hot-path indexes + one-shot ledger repair for
-- fully-discounted orders missed by the 017 backfill (total = 0 rows where
-- subtotal/discount/tax minors stayed 0). Additive only; safe to re-run.
CREATE INDEX IF NOT EXISTS idx_xapi_org ON xapi_statements(organization_id);
CREATE INDEX IF NOT EXISTS idx_xapi_org_stored ON xapi_statements(organization_id, stored_at);
CREATE INDEX IF NOT EXISTS idx_threads_course ON discussion_threads(course_id);
CREATE INDEX IF NOT EXISTS idx_replies_thread ON discussion_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_grades_course_student ON grades(course_id, student_id);

-- Repair free-after-coupon orders: recompute minors from REAL parts.
UPDATE orders
SET subtotal_minor = CAST(ROUND(subtotal * 100) AS INTEGER),
    discount_minor = CAST(ROUND(discount * 100) AS INTEGER),
    tax_minor = CAST(ROUND(tax * 100) AS INTEGER)
WHERE total = 0 AND total_minor = 0
  AND (subtotal != 0 OR discount != 0 OR tax != 0);

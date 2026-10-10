-- 023_commission_guard: one commission row per (order, payee). The application
-- already guards re-runs in code; this index makes double-mint structurally
-- impossible under concurrent fulfillment. Additive only; safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_order_payee ON commissions(order_id, instructor_id);

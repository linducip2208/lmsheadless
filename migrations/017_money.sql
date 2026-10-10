-- 017_money: integer minor-unit columns (cents) as the source of truth for all
-- financial arithmetic. REAL columns remain synced for backward compatibility.
-- Rule: minor = ROUND(real * 100), round-half-up via application code.
ALTER TABLE courses ADD COLUMN price_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bundles ADD COLUMN price_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN value_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN min_amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN subtotal_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN total_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE commissions ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN total_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscription_plans ADD COLUMN price_minor INTEGER NOT NULL DEFAULT 0;

-- Backfill legacy REAL values (exact for 2dp amounts).
-- Percent coupons keep `value` as a rate; fixed coupons move to value_minor.
UPDATE coupons SET value_minor = CAST(ROUND(value * 100) AS INTEGER) WHERE kind = 'fixed' AND value_minor = 0 AND value != 0;
UPDATE coupons SET min_amount_minor = CAST(ROUND(min_amount * 100) AS INTEGER) WHERE min_amount_minor = 0 AND min_amount != 0;
UPDATE courses SET price_minor = CAST(ROUND(price * 100) AS INTEGER) WHERE price_minor = 0 AND price != 0;
UPDATE bundles SET price_minor = CAST(ROUND(price * 100) AS INTEGER) WHERE price_minor = 0 AND price != 0;
UPDATE orders SET subtotal_minor = CAST(ROUND(subtotal * 100) AS INTEGER), discount_minor = CAST(ROUND(discount * 100) AS INTEGER), tax_minor = CAST(ROUND(tax * 100) AS INTEGER), total_minor = CAST(ROUND(total * 100) AS INTEGER) WHERE total_minor = 0 AND total != 0;
UPDATE order_items SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_minor = 0 AND amount != 0;
UPDATE payments SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_minor = 0 AND amount != 0;
UPDATE commissions SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_minor = 0 AND amount != 0;
UPDATE payouts SET amount_minor = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_minor = 0 AND amount != 0;
UPDATE invoices SET total_minor = CAST(ROUND(total * 100) AS INTEGER) WHERE total_minor = 0 AND total != 0;
UPDATE subscription_plans SET price_minor = CAST(ROUND(price * 100) AS INTEGER) WHERE price_minor = 0 AND price != 0;

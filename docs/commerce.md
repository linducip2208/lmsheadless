# Commerce & payment integration guide

## Model

Courses (price), bundles, cohorts, subscription plans → `orders` (server-side
totals; client amounts never trusted) → `payments` → fulfillment writes
`entitlements` + enrollments + `invoices` + `commissions`. States:
pending → paid | failed; paid → refunded (reverses commissions, revokes
entitlements, drops enrollments).

## Pricing

Coupons (percent/fixed, caps, minimums, windows, usage counts), affiliate
attribution (expiry setting, anti-self-referral), tax via org setting
`tax_rate`, currency via org setting. Money is stored and computed in integer
minor units (`*_minor` columns; source of truth, half-up rounding); the REAL
`price/total/amount` columns stay synced for backward compatibility and legacy
rows fall back through rounding. For zero-decimal currencies (e.g. IDR — whole
rupiah), set amounts in whole units and treat minor == major. Coupon claims
are atomic (`used_count` conditional increment); commissions are idempotent
per order; refunds reverse commissions and revoke entitlements.

## Providers

- **Manual/offline**: buyer claims (`/orders/:id/payments/manual`), admin
  confirms (`/payments/:id/confirm`). Fully tested, no credentials needed.
- **Adapter interface**: `verifyProviderSignature()` + `POST /payments/webhooks/:provider`
  with `payment_webhooks(provider, event_id)` replay protection and idempotent
  fulfillment. Order lookup + signature run before any write; `gross_amount`
  (major-unit decimal string) must equal the order total or the event is
  rejected with 402 `AMOUNT_MISMATCH` — an underpaid settlement never
  fulfills. Currency is free-form (≤8 chars, stored as-is); the DB total in
  minor units always wins over payload amounts.
- **Race safety**: confirm/refund/payout-decide use conditional transitions
  (`AND status=…`, 409 on lost races); commissions carry a unique
  `(order_id, instructor_id)` index with `ON CONFLICT DO NOTHING`; invoices
  tolerate fulfill races via the order guard. Garbage `tax_rate` /
  `commission_rate` org settings are sanitized at read (NaN can never poison
  an order); affiliate rates are validated 0–100 at write.
- **Midtrans-style adapter** ships with unit-tested SHA512 signatures.
  Configure `payment_midtrans_server_key` in organization settings. **Live
  merchant verification is pending customer credentials — never mark paid
  from a browser redirect.**
- Add providers by extending `verifyProviderSignature` + webhook mapping and
  adding signature-vector tests (see `test/commerce.test.ts`).

## Marketplace honesty

Commissions are refund-aware; **payouts are manual bank transfers** tracked
through request → approve/reject (the system never moves money). Gifts,
bundles, cohorts (gift redemption grants cohort + membership + courses),
subscriptions and revenue reports included. Refund flows
tested (course/bundle/cohort revocation, commission reversal). There is no
order-cancel endpoint: `cancelled` appears only as a fulfillment guard — do
not advertise cancellation. Subscription records are point-in-time
(active/pending) with no automated renewal, charge, or cancel linkage;
recurring billing is provider-driven.

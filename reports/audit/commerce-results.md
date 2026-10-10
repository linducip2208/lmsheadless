# Commerce results (all executed, none simulated)

Update 1.10.0: webhook amount-match enforced (402 on mismatch; an E2E vector
with minor-unit gross was correctly rejected mid-session and the spec fixed
to major units); conditional confirm/refund/decide transitions; commissions
unique index; rate sanitization; cohort-gift grants; sequential double
transitions verified rejected with state unchanged.

- Server-side totals only: `priceReference` + `applyCoupon` + org `tax_rate`,
  integer minor units, half-up rounding (`commerce.test.ts` 999→849 case).
- Coupons: percent/fixed/minimum/windows/`max_uses` validated; atomic claim
  (`UPDATE … WHERE used_count < max_uses`, void-on-lost-race) tested with
  `max_uses=1` double-order (`commerce-fixes.test.ts`).
- Manual flow: buyer claim → admin confirm → paid + entitlement + enrollment
  - commission + invoice (tested, incl. double-confirm 400).
- Webhooks: Midtrans-style SHA512 constant-time verify; unknown providers
  rejected; unknown orders 404 without writes (post-reorder); exact replay →
  `duplicate:true`; distinct second event processes without duplicating
  commissions/entitlements/invoices (`commerce-fixes.test.ts`).
- Refunds: course/bundle/cohort revocation (entitlements deleted, enrollments
  dropped, cohort membership removed), commissions → `reversed` (tested incl.
  cohort order E2E in `roles.spec.ts`).
- Gifts: paid-orders-only, single redeem, double-redeem 404 (existing tests).
- Affiliates: anti-self-referral at click and order time; new GET listings
  for affiliates/payouts wired to the admin commerce tab (tested 403/200).
- Subscriptions: point-in-time records only — NO automated renewal/charge/
  cancel linkage (documented, not claimed).
- Drift safety: paid gates read `price_minor` with REAL fallback; create/
  PATCH/duplicate/CSV-import keep both columns synced (minor wins); catalog
  reads expose `price_minor` (6 regression tests green).

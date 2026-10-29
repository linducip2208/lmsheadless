# ADR 002 — Money is stored and computed in integer minor units

Status: accepted (2026-10-10, migration 017).

Context: REAL-column rupiah math drifted (0.1 + 0.2), and free-order checks
read a different column than the totals engine.

Decision: `*_minor` integer columns are the source of truth (half-up
rounding); legacy REAL columns stay synced for compatibility. `pickMinor()`
is the single read path with legacy fallback. Webhook `gross_amount` is
matched against the recomputed total (402 on mismatch).

Consequences: dual writes on every money path; migration 022 repaired
pre-017 free rows. Property tests pin `major(minor(x)) === x` (see
`test/round9b-properties.test.ts`).

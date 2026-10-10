# Database integrity (SQLite/D1, migrations 001–022)

- Ordering deterministic (`readdirSync().sort()`); clean-install tested on
  every suite run (`:memory:` + `runMigrations`); double-boot tested
  (`migration-rerun.test.ts`); tolerant re-run of bare `ADD COLUMN`s.
- `IF NOT EXISTS` on all CREATEs; 017/020/022 bare ALTERs covered by the
  duplicate-column-tolerant runner.
- FKs: declared throughout; enforced locally (`PRAGMA foreign_keys=ON` in
  adapter) and re-asserted per request in `app.ts` for D1/exotic adapters
  (D1 enforces by default). UNIQUE on slug, email, certificate_number,
  statement_id, payment_webhooks(provider,event_id), idempotency_key,
  invoice number, gift code, entitlements triple.
- New 022: `idx_xapi_org`, `idx_xapi_org_stored`, `idx_threads_course`,
  `idx_replies_thread`, `idx_grades_course_student` + free-order minor repair.
- Money canonical: minor-unit source of truth, dual-write, legacy fallback
  (`pickMinor`); 017 backfill + 022 free-order repair; no REAL-only writes in
  prod routes; subscription-plan ordering moved to `price_minor`.
- Pagination: all lists bounded; every `ORDER BY` now carries an `id`/`rowid`
  tiebreaker (insertion-order semantics preserved via `rowid` for messages
  and replies — caught by `ai-tutor.test.ts` during this session).
- Seed: file-local only, early-exits on existing users; new guard refuses
  custom `DATABASE_PATH` outside `./.data` without `SEED_ALLOW_CUSTOM_PATH=1`.
- Cascades: `ON DELETE CASCADE` on financial/academic tables is unreachable
  via the API (soft deletes only, no org-delete endpoint); changing them
  would require table rebuilds — accepted residual with rationale.
- No interpolated user input in SQL (static fragments + `?` bindings only);
  no destructive migration; drill restore verified `integrity_check=ok` and
  zero `foreign_key_check` violations (see `backup-restore-results.md`).

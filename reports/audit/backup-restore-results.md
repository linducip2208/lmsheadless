# Backup/restore drill (executed 2026-10-10, local test copies only)

Procedure (isolated temp copies, production DB never touched):

1. Fresh DB → all 22 migrations → seed 1 org + 1 user + membership + 1 course.
2. File-copy backup with no writers active.
3. Simulated loss: DELETE courses, memberships, users (counts 0/0).
4. Restore: copy backup over live file → boot app migrations (clean) →
   verify counts, `PRAGMA foreign_key_check`, `PRAGMA integrity_check`.

Measured outcome:

- Before loss: users=1, courses=1. After loss: 0/0.
- After restore: users=1, courses=1, `foreign_key_violations: 0`,
  `integrity: ok`, migration re-run clean. **DRILL: PASS.**

Notes: file-copy backup is valid for SQLite only with quiesced writers;
D1 production backups follow `docs/backup-recovery.md` (point-in-time). R2
object inventory restore was not drilled (no R2 binding active locally) —
recorded as a gap in `known-limitations.md`. Secrets are not part of backups
(keys live in env/bindings, never in dumps).

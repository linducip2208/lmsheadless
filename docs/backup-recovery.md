# Backup & recovery

## D1 (production)

- Enable Cloudflare D1 backups (automatic point-in-time where available) and
  verify restores on a non-production database before relying on them.
- Before every upgrade: `wrangler d1 export <db> --remote --output backup.sql`
  (or time-travel export) and store it outside Cloudflare.
- Migration safety: files are ordered and idempotent (column patches are
  PRAGMA-guarded); never edit an applied migration — add a new one.
- Local dev DB (`./.data/lms.db`) is disposable: `db:migrate` + `db:seed`
  rebuild it.

## R2 (production)

- Enable versioning/lifecycle on the storage bucket for SCORM extractions,
  uploads, and certificates.
- Local uploads (`STORAGE_LOCAL_DIR`) are not backed up by the app — include
  the directory in host backups.

## Recovery drills

Quarterly: restore D1 backup to a staging database, run migrations, boot the
API, run `npm test`, and verify login + catalog + certificate verification.
Record the drill date and result in the ops log.

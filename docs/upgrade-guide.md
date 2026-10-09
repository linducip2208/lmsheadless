# Upgrade guide (1.1.0 → 1.2.0)

1. Pull `main`, run `npm install` (new deps: `jszip`, `fast-xml-parser`).
2. `npm run db:migrate` — applies 008–014 plus idempotent column patches
   (safe to re-run; each `ALTER` is PRAGMA-guarded).
3. `npm run db:seed` — tops up permissions/settings only; never duplicates demo data.
4. Rebuild portals (`npm run build`) — new routes/pages included.
5. If you customized RBAC mappings, re-check `role_permissions` against the
   extended catalog (`GET /permissions`); new keys default per `ROLE_PERMISSIONS`.
6. Commerce is **opt-in**: paid features stay inert until a provider is
   configured; existing free courses are unaffected.
7. Backup D1 + R2 before upgrading production (see `docs/backup-recovery.md`).

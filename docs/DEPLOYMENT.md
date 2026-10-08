# Deployment (Cloudflare)

1. `wrangler login`
2. `wrangler d1 create lms-headless` → put `database_id` in `apps/api/wrangler.toml`, uncomment `[[d1_databases]]`.
3. `wrangler d1 migrations apply lms-headless --remote` (or per-file `wrangler d1 execute lms-headless --remote --file=./migrations/00X_*.sql` in order).
4. `wrangler r2 bucket create lms-storage` → uncomment `[[r2_buckets]]`.
5. `wrangler kv namespace create RATE_LIMIT` → uncomment `[[kv_namespaces]]`.
6. `wrangler secret put JWT_SECRET` (≥32 random chars).
7. `wrangler deploy` (from `apps/api`).
8. Admin/student: `npm run build --workspace apps/admin` etc.; host `dist/` on Pages/Workers Static Assets; set API base to Workers URL.

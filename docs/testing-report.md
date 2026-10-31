# Testing Report — Enterprise Repair (2026-10-31)

## API (vitest, SQLite :memory: per test)

- **200/200 lolos, 36 file** (~10 detik). Termasuk 9 regression test baru
  `security-repair.test.ts`: isolasi grade lintas-org, row-scope
  student-progress, bank anti-siswa, roster tanpa email, parent-link
  per-org, draf 404 + tak ter-list, instructor-scoping, xAPI 400 tanpa org.
- Cakupan (dari audit): auth, RBAC matrix, tenant isolation, IDOR, courses,
  quiz (scoring/expiry/limits/pools/manual), assignments, attendance,
  certificates, files, setup, search, idempotency, CORS, rate limiting,
  authoring, banks, cohorts, live, commerce (+minor-units, webhook, refund),
  SCORM/H5P, AI-mock, imports, reuse, retention, upload sniffing, journey
  E2E-level (setup→parent), PWA assets, OpenAPI honesty.
- Celak yang diakui: subscription lifecycle, invoice PDF/pajak,
  multi-currency, H5P luas, SCORM 2004 penuh, kompetisi longitudinal,
  push/email delivery nyata, SSO, Flutter contract test, beban (bench
  terpisah), divergensi D1-vs-SQLite.

## Gates otomatis

| Gate | Hasil |
|---|---|
| `typecheck` (semua workspace) | ✓ |
| `lint` (`--max-warnings=0`) | ✓ (2 error + 10 warning diperbaiki, termasuk HUB_IPS gateway) |
| `contract` (182 ref frontend→backend) | ✓ PASS |
| `audit` (migrasi, FK/index, secrets, CDN, envelope, RBAC, PWA) | ✓ PASS |
| `static-audit` (hash links, envelope) | ✓ PASS |
| `build` (api + 5 portal) | ✓ |
| `db:migrate` rerun (28 file, 2x) | ✓ + `foreign_key_check` kosong |
| `db:seed` fresh | ✓ (attempt, submission, cert, forum, bank terisi) |

## E2E Playwright (Chromium, dev server + SQLite lokal)

- 27 spec / 87 test: roles journey, CRUD 4 portal, admin assess/insight/
  live/ops/orgs, commerce, family, teacher workflows, student workflows,
  lifecycle, payment-confirm, smoke, pwa-a11y, axe (7), visual.
- **Hasil pasca-perbaikan: 81 passed, 6 skipped (visual baselines opt-in),
  0 failed** (~2 menit, workers:1). Sertifikasi penuh terakhir 2026-10-31.
- Yang diperbaiki selama sertifikasi (semuanya terverifikasi hijau):
  `packages/ui` query-merge (`?cookie=1&lang=id`), visibility draf +
  `canSeeCourseContent` (enrolled-bypass), asersi bilingual
  (Students|Siswa, commissions|Komisi, No linked students|Belum ada siswa
  tertaut), hook `data-t="learn"`, perbaikan test roles-remap yang salah
  (asersi kolom katalog → sel staff + case-insensitive header), override
  kontras `.text-muted` (axe color-contrast pada empty state).
- Catatan: E2E memakai DB dev bersama (`reuseExistingServer`); DB direset
  (migrate+seed) sebelum run sertifikasi. Throttle verify (60/mnt) tidak
  tersentuh volume E2E.

## Produksi (terverifikasi manual pasca-deploy)

Worker `/health` ok · login admin ok · `/setup` terkunci · proxy Pages
`/api/*` JSON (GET+POST) · 5 portal 200 · custom domain + sertifikat aktif.

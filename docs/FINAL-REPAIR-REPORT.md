# FINAL REPAIR REPORT — LMS Headless Enterprise Repair

Tanggal: 2026-10-31 · Branch: `repair/enterprise-ux` → merge ke `main`
Produksi: Worker `lms-headless-api` + 5 Pages + D1/R2/KV (ter-deploy, terverifikasi)

## 1. Temuan awal (dari 4 audit paralel)

- **Keamanan**: bacaan lintas-org (`GET /grades`, `student-progress`,
  `certificates`, `orders`), bank soal bocor ke siswa, roster cohort memuat
  email untuk semua peran, parent link tanpa scope org (6 endpoint), kursus
  draf terbaca siswa, `/instructor/courses` tanpa filter org, xAPI yatim
  (`organization_id` NULL), verifikasi sertifikat publik tanpa throttle.
- **Database**: 21 index join/filter hilang, `parent_links` UNIQUE terlalu
  sempit (pasangan sama tak bisa di 2 org), `courses.slug` tanpa unique di
  DB lama, kolom patch (`migrate.ts`) **tak pernah teraplikasi di D1 remote**
  (skema produksi ketinggalan!), `questions.attempt_id` tanpa index.
- **Frontend**: default locale EN di semua portal, teacher/student tanpa
  pemilih bahasa, ~49 string hardcoded, 3 lubang empty/loading,
  teacher/student/parent tanpa theme (Tabler mentah).
- **Seed demo**: tanpa attempt, submission, sertifikat terbit, forum, isi bank.
- **Docs**: tanpa panduan peran, tanpa matriks role, tanpa laporan integritas.

Kabar baik: tidak ada angka dashboard palsu, kontrak 182 ref valid, suite
kuat (191 API + ~76 E2E), envelope konsisten, migrasi rapi.

## 2. Penyebab data tidak terdeteksi

Bukan satu bug — tiga pola: (a) query tanpa filter tenant pada tabel anak
(sebagian transportation, diperketat), (b) skema D1 remote tidak punya kolom
patch sehingga tulis dengan kolom baru gagal di produksi, (c) seed minim
membuat dashboard demo kosong. Tidak ada yang ditutup dengan angka palsu.

## 3. Perbaikan database

- Migrasi **027** (21 index + rebuild `parent_links` preservasi data +
  mirror diuji rerun + `foreign_key_check` kosong).
- Migrasi **028** (seluruh column patch sebagai file deklaratif — menutup
  kesenjangan D1 remote; diterapkan lokal + remote terverifikasi).
- `applyPostPatchConstraints()` di `migrate.ts` (dedupe slug + index unik,
  tak pernah menggagalkan boot).

## 4. Perbaikan API (kompatibel, tanpa endpoint dihapus/diubah kontrak)

`banks.ts` (canTeach), `cohorts.ts` (roster scoped + tanpa email),
`assessment.ts` (grades intersection-filter + parent org),
`ops.ts` (student-progress row-scope + 3 parent-link org),
`courses.ts` (progress link org + instructor filter + draft 404/list),
`xapi.ts` (tolak org NULL), `app.ts` (throttle verify 60/mnt).
Matriks commerce (staff read-only) didokumentasikan, bukan diubah.

## 5. Perbaikan setiap role

- Admin: tidak ada data palsu (terverifikasi); chart penyelesaian + aktivitas
  dari data nyata; empty/loading lengkap.
- Guru: pemilih bahasa, string ID, loading/empty daftar kursus, theme violet.
- Siswa: pemilih bahasa, string ID, empty pengumuman, theme teal + bottom nav.
- Orang tua: header tabel i18n, skeleton loading, theme; akses tetap
  anak-tertaut per-org (diuji).
- Staff: kewenangan didokumentasikan (baca, bukan mutasi uang).
- Super admin: tenant isolation diuji org-vs-org.

## 6. Perbaikan UI/UX

Theme per-role (`theme.css` teacher/student/parent, token sekeluarga dengan
admin), stat card data nyata, bar progres/aktivitas, quick actions, skeleton,
reduced-motion, responsif. Publik tidak dirombak (redesain premium sudah ada).

## 7. Bahasa Indonesia

Default `id` di 5 portal + pemilih ID/EN/AR; `api()` mengirim `?lang=` dari
`documentElement.lang`; 49 key baru (en+id); backend negosiasi
`?lang=`/`Accept-Language` (default server tetap `en` untuk stabilitas
kontrak Flutter — didokumentasikan di `indonesian-localization.md`).

## 8. Keamanan

8 regression test baru (`security-repair.test.ts`, isolasi A/B); throttle
verify; setup terkunci; login produksi terverifikasi; tidak ada secret di repo
(`.gitignore` menutup `.wrangler/`, secret via `wrangler secret put`).

## 9. Test

- API: **199/199** (35 file, termasuk 8 baru).
- Gates: typecheck ✓, lint ✓, contract 182 ✓, audit ✓, static-audit ✓,
  build 6 workspace ✓, migrate rerun ✓, seed fresh ✓.
- E2E Playwright: **81 passed, 6 skipped, 0 failed** (lihat testing-report.md).

## 10. Build & file penting

`routes/{assessment,ops,cohorts,courses,banks,xapi}.ts`, `app.ts`,
`migrate.ts`, `seed.ts`, `migrations/027,028`, `packages/ui`,
`*/theme.css`, `*/i18n.ts`, `docs/{roles-and-permissions,user-workflows,
database-integrity,indonesian-localization,testing-report}`, `docs/api.md`.

## 11. Risiko tersisa (jujur)

Teacher org-wide (keputusan desain); `questions.attempt_id` tanpa FK;
tanpa tabel `roles`; kategori grade tanpa FK; polimorfik commerce via kode;
uang REAL+minor di tangan aplikasi; `ai_configs.api_key_ref` mentah (pindah
ke secret sebelum serius); stub AR; langganan/invoice-PDF/multicurrency
belum diuji; push/email delivery butuh kredensial sendiri.

## 12. Kesiapan produksi

API + portal ter-deploy dan diverifikasi (health, login, setup-lock, proxy,
domain + sertifikat). Production-readiness penuh lihat
`docs/production-readiness.md` + `docs/testing-report.md`.

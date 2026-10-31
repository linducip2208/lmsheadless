# Database Integrity (hasil audit + perbaikan)

## Metode

Audit membaca `migrations/001–027`, `apps/api/src/db.ts`, `migrate.ts`,
`seed.ts`, dan seluruh `SELECT` di `apps/api/src/routes/`. Prinsip:
tabel anak tidak selalu punya `organization_id`, jadi keamanan bergantung
pada helper (`courseOrg`/`quizOrg` + `canAccessOrg`) **dan** filter baris
(`JOIN courses`) — keduanya diverifikasi, bukan salah satu.

## Yang diperbaiki (migrasi 027 + kode)

1. **Cross-org grade read** (`GET /grades` tanpa `course_id`,
   `reports/student-progress`, `certificates`, `orders`) — baris kini
   di-scope org lewat `JOIN courses`; bacaan lintas-user wajib konteks org.
   Uji: `security-repair.test.ts` (isolasi A/B), `security-fixes.test.ts`.
2. **Bank soal bocor ke siswa** — `GET /question-banks/:id/questions`
   kini mensyaratkan `canTeach`, setara endpoint tulis.
3. **Roster cohort** — siswa/orang tua hanya daftar tanpa email; orang tua
   wajib anak tertaut yang menjadi anggota.
4. **Parent link per-org** — 6 endpoint anak memfilter
   `parent_links.organization_id`; constraint menjadi
   `UNIQUE(parent_id, student_id, organization_id)` (rebuild preservasi data).
5. **Draf terlihat siswa** — list menyembunyikan `draft` dari non-pengajar;
   detail draf 404; `/instructor/courses` difilter org yang diminta.
6. **xAPI yatim** — `organization_id` NULL ditolak (400).
7. **Verifikasi sertifikat** — throttle per-IP (`verify`, 60/menit).
8. **27 index** join/filter (attempt snapshots, answers, attachments,
   instructors, members, live, subscriptions, orders, audit/activity, email,
   invitations) + `idx_courses_org_slug` (dengan normalisasi duplikat
   dahulu) — seluruhnya `IF NOT EXISTS`, rerun-safe, kompatibel SQLite+D1.
9. **`courses.slug` unik per org di DB lama** — kolom patch tidak membawa
   constraint; migrasi kini mendedupe lalu membuat index unik lewat
   `applyPostPatchConstraints()` (berjalan setelah patch kolom, tidak
   pernah menggagalkan boot).

## Sisa yang disengaja (residual, bukan utang tersembunyi)

- `questions.attempt_id` tanpa FK: diindeks; snapshot dihapus oleh purge
  per-`attempt_id` di sisi aplikasi. FK reload penuh tabel inti
  ditunda karena risiko > manfaat.
- Tanpa tabel `roles` (`role` TEXT + `role_permissions` tanpa FK):
  validasi di lapisan aplikasi + katalog izin terpusat; `CHECK` tak bisa
  ditambah via `ALTER` di SQLite.
- `grades.category` tanpa FK ke `grade_categories`: kategori bebas per
  kursus; bobot tidak ditegakkan di DB.
- Relasi polimorfik (`entitlements`, `orders.kind/reference_id`,
  `files.object_key`): cascade di kode (fulfill/refund), bukan FK.
- Uang ganda `REAL`+`minor`: kebenaran di aplikasi (`minor()`/`pickMinor()`);
  tulis SQL langsung bisa drift — jangan.
- `ai_configs.api_key_ref` menyimpan secret provider: pindahkan ke
  Cloudflare secret sebelum produksi serius (arsitektur BYOK siap, delivery
  butuh kredensial sendiri).
- Teacher org-wide (bukan assignment-scoped): keputusan desain, lihat
  `roles-and-permissions.md`.

## Verifikasi

- `npm run db:migrate` rerun-safe (27 file, dua kali tanpa error).
- `PRAGMA foreign_key_check` kosong pada DB dev berisi seed.
- `npm --workspace apps/api run test` 199/199 (termasuk 8 regresi keamanan
  baru lintas-org).
- `npm run audit` + `npm run contract` hijau (dijalankan di quality gate).

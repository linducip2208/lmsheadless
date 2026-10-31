# Roles & Permissions

Sumber kebenaran implementasi: `apps/api/src/access.ts` (`orgRole`, `canAccessOrg`,
`canTeach`, `isPrivileged`), `apps/api/src/middleware/common.ts`,
`apps/api/src/routes/*.ts`. Menu frontend hanya tampilan — penegakan selalu di backend.

## Peran

| Peran | Cakupan |
|---|---|
| `super_admin` | Lintas organisasi. Kelola tenant, domain, white-label, admin org, role/permission, pengaturan platform, audit, monitoring. |
| `organization_admin` | Satu organisasi: profil, branding, tahun ajaran/semester/departemen/kelas/mapel, pengguna, course builder, kuis, tugas, absensi, sertifikat, laporan, commerce. |
| `teacher` | Org-wide mengajar (lihat catatan): kursus/kelas yang terlihat, materi, kuis, grading, absensi, progres. Daftar `/instructor/courses` hanya assignment. |
| `student` | Milik sendiri: enroll, materi, kuis, tugas, nilai (sesuai kebijakan rilis), absensi riwayat, sertifikat. |
| `parent` | Hanya anak tertaut (`parent_links`, dicek **per organisasi**): progres, nilai, absensi, tugas, pengumuman, sertifikat. Tidak bisa ubah apa pun. |
| `staff` | Operasional sesuai kewenangan: **baca** (orders, laporan, absensi, pengumuman). Mutasi uang (cancel/refund/confirm) hanya buyer + privileged. |

## Keputusan desain yang disengaja

1. **Teacher org-wide, bukan assignment-scoped** — kecuali `/instructor/courses`.
   Mengubahnya menjadi per-assignment di semua endpoint akan memecahkan alur
   wali kelas/pengganti dan ratusan asersi. Jika kebutuhan mewajibkan,
   tambahkan flag per-org, bukan mengubah default.
2. **Staff read-only untuk commerce** — melihat order boleh, membatalkan/
   me-refund tidak (mutasi uang = buyer atau `isPrivileged`).
3. **Siswa tidak membaca draf** — `GET /courses` menyembunyikan `draft` dari
   non-pengajar; detail draf mengembalikan 404 (bukan 403) agar eksistensi
   tidak bocor. `archived` tetap terlihat sebagai riwayat belajar.
4. **Bank soal = materi ajar** — hanya `canTeach`. Daftar cohort untuk
   siswa/orang tua tanpa email (anti-panen roster).
5. **Parent link per-org** — tautan di org A tidak berlaku di org B; semua
   endpoint anak (`progress`, `grades`, `attendance/student`, PDF sertifikat)
   memfilter `organization_id`.
6. **Bacaan lintas-user wajib konteks org** — `student-progress` dan
   `attendance/student` menolak tanpa `organization_id`; `grades` tanpa
   `course_id` memfilter ke irisan org yang boleh dilihat; baris di-scope
   lewat `JOIN courses`.

## Katalog izin

29 izin granular (`users.view`, `courses.publish`, `quiz.grade`,
`certificates.issue`, …) di `apps/api/src/permissions.ts`, dipetakan per
peran di `ROLE_PERMISSIONS`. Uji matriks: `apps/api/test/security*.test.ts`,
`governance.test.ts`, `security-repair.test.ts`.

# User Workflows (end-to-end, teruji)

Setiap skenario di bawah berjalan dari UI maupun API langsung dan tercakup
oleh `apps/api/test/journey.test.ts` + `apps/web/e2e/roles.spec.ts` (atau
spesifikasi portal terkait). Data yang dibuat satu peran terlihat peran lain
sesuai haknya — bukan angka statis.

## 1. Organisasi baru

Super admin → buat organisasi → buat admin org → admin melengkapi profil,
branding, tahun ajaran, semester, kelas, mapel → daftarkan guru/siswa/orang
tua (+tautan anak) → tugaskan guru ke kelas/kursus. Isolasi tenant diuji
org-vs-org di `api.test.ts` dan `security.test.ts`.

## 2. Pembelajaran

Admin buat kursus (draf) → tetapkan guru → guru isi bab/materi (teks, video,
dokumen), prasyarat, drip → terbitkan (approval bila aktif) → siswa enroll
→ buka materi → tandai selesai → `lesson_progress` + `course_progress`
tersimpan → admin & guru membaca progres yang sama (`course-progress`,
`student-progress`).

## 3. Penilaian

Siswa mulai attempt → jawab (autosave berkala) → submit → skor otomatis
untuk pilihan ganda/benar-salah/isian (pool, acak, negative marking,
cooldown, batas percobaan) → esai ke antrean grading → guru menilai +
feedback → nilai terbit sesuai `answer_release` → siswa melihat nilainya;
orang tua melihat nilai anak tertaut.

## 4. Absensi

Guru buat sesi → catat hadir/alpa/terlambat/izin → rekap tersimpan →
admin membaca laporan → siswa melihat riwayatnya → orang tua melihat riwayat
anak (`attendance/student` ter-scope org).

## 5. Sertifikat

Kriteria lulus terpenuhi → terbitkan sesuai permission (`certificates.issue`)
→ nomor unik → unduh PDF → verifikasi publik tanpa login
(`/certificates/verify/:number`, di-throttle anti-enumerasi) → orang tua
melihat sertifikat anak.

## 6. Multi-tenant & commerce

Dua org + peran serupa → tidak ada kebocoran via API/URL/ID/pencarian/export/
laporan/lampiran (diuji). Commerce: katalog → order → bayar (manual/tertanda)
→ fulfill entitlement → invoice → refund/cancel sesuai matriks peran.

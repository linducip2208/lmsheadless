# Panduan Admin (Organisasi)

Untuk peran `super_admin` dan `organization_admin` di portal Admin.

## 1. Siapkan organisasi

- **Pengaturan → Organisasi**: isi nama, logo, warna, footer, dan info bantuan (white-label). Yang tampil publik bisa dicek di branding organisasi.
- **Tahun ajaran, semester, kelas, mata pelajaran**: buat strukturnya dulu sebelum membuat kursus.
- **Pengguna & peran**: undang admin, guru, siswa, orang tua, staf. Ada 29 izin granular (`users.view`, `courses.publish`, …) — menu di depan hanya tampilan, keamanan selalu dicek server.
- **Orang tua**: tautkan akun orang tua ke anaknya agar hanya melihat anaknya sendiri.

## 2. Susun kursus (course builder)

- Buat kursus → tambah **bab (sections)** → tambah **pelajaran (lessons)**: teks, video, dokumen.
- Atur **prasyarat**, **drip (jadwal buka materi)**, jendela pendaftaran, kapasitas, dan daftar tunggu.
- Alur terbit: draf → minta persetujuan → terbit. Kursus terbit bisa diduplikasi dan diekspor ke CSV.
- **SCORM 1.2**: paket valid bisa diimpor dan dimainkan di pemutar sandbox dengan pelacakan progres.

## 3. Kuis & bank soal

- Buat **bank soal** per topik: pilihan ganda, benar/salah, isian singkat, menjodohkan, urutan, esai.
- Rakit kuis dari bank (acak/pool), atur batas waktu, batas percobaan, jeda antar percobaan, pengurangan nilai, dan kapan jawaban dibuka.
- Soal esai dan penilaian manual masuk **antrean grading** guru.

## 4. Tugas, absensi, nilai

- **Tugas**: instruksi, tenggat, aturan kirim ulang; tinjau kiriman siswa dan beri umpan balik.
- **Absensi**: buka sesi per kelas/kursus, tandai hadir/alpa/terlambat/izin; rekap otomatis.
- **Nilai**: kategori, skor, umpan balik; siswa dan orang tua hanya melihat miliknya.

## 5. Sertifikat & laporan

- Buat templat sertifikat → terbitkan saat siswa lulus; nomor sertifikat bisa diverifikasi publik di halaman `/verify`.
- **Laporan**: progres organisasi, per kursus, per guru; log audit mencatat semua perubahan penting.

## Tips

- Semua aksi tulis aman diulang (dukungan `Idempotency-Key`) — sinkronisasi offline siswa tidak menggandakan data.
- Butuh toko? Modul commerce (paket, kupon, order, invoice, pembayaran manual/tertanda, webhook, refund, langganan, komisi, afiliasi) ada di menu Commerce.

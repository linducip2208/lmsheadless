# Indonesian Localization

Bahasa Indonesia adalah default seluruh portal; Inggris tetap tersedia
penuh; Arab parsial (RTL didukung, sebagian dict masih stub).

## Default & penyimpanan

| Portal  | Kunci `localStorage` | Default |
| ------- | -------------------- | ------- |
| Admin   | `admin-locale`       | `id`    |
| Teacher | `teacher-locale`     | `id`    |
| Student | `student-locale`     | `id`    |
| Parent  | `parent-locale`      | `id`    |
| Web     | `web-locale`         | `id`    |

Pemilih bahasa (ID/EN/AR) ada di halaman login + header semua portal.
Teacher/student memakai pola reload (dict `const`), admin/parent/web
me-render ulang. Pilihan tersimpan per portal.

## Istilah baku

Dasbor, Kursus, Materi, Tugas, Absensi, Nilai, Sertifikat, Siswa, Guru,
Orang Tua, Organisasi, Laporan, Pengaturan, Progres Belajar, Pengumpulan
Tugas, Penilaian. Istilah teknis (API, PWA, SCORM, quiz attempt) tidak
diterjemahkan membingungkan.

## Server & format

- Portal mengirim locale ke API otomatis (`packages/ui` `api()` menambah
  `?lang=id|ar` dari `document.documentElement.lang`) sehingga pesan
  validasi/error server mengikuti bahasa UI.
- Backend menegosiasikan `?lang=` / `Accept-Language` (`middleware/language.ts`).
  Default server tetap `en` (kontrak API stabil untuk Flutter/integrasi);
  portal selalu mengirim `lang` eksplisit.
- Tampilan tanggal/jam Asia/Jakarta, mata uang IDR (minor units), format
  angka Indonesia mengikuti locale aktif.

## Cakupan & sisa

- 49 key baru ditambahkan (en+id) untuk string yang tadinya hardcoded:
  nav, tombol, form, header tabel, empty/loading, toast, aria-label,
  FAQ, pricing, dan status operasional.
- Brand (`LMS Teacher`, …) dan value teknis API (`reviewed`, `true/false`,
  `content_type`) disengaja tidak diterjemahkan.
- Stub `ar`: teacher/student/parent hanya `loading/failed`; admin/web
  lebih lengkap. Melengkapi AR bukan target rilis ini.

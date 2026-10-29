# Admin Redesign — Phase 1 (selesai)

Tanggal: 2026-10-29. Stack nyata: vanilla TS + hash routing + Tabler CSS
(`@tabler/core`), helper `@lms/ui`, tanpa framework SPA, tanpa Laravel
(backend: Hono/Workers, bukan Laravel — master command menyebut Laravel,
yang benar adalah API Hono di `apps/api`).

## 1. Audit UI/UX (temuan)

- `apps/admin/src/main.ts`: sidebar tanpa ikon, tanpa collapse, tanpa
  pengelompokan berlabel jelas; topbar minimal (breadcrumb + search + org +
  lang + logout); login satu kartu sempit tanpa branding.
- `apps/admin/src/lib.ts` `crud()`: tabel generik + search + tombol create —
  inilah sumber kesan "CRUD mentah" di semua halaman (satu pola dipakai
  ~20 halaman). Tanpa page header, tanpa deskripsi, tanpa konteks jumlah,
  tanpa skeleton.
- `apps/admin/src/pages/dashboard.ts`: 6 kartu angka + progress bar, tanpa
  konteks, tanpa aktivitas, tanpa aksi cepat, tanpa attention state.
- Halaman `orgs.ts`: daftar + detail tanpa header/deskripsi (kotak kecil di
  ruang kosong — sesuai keluhan).
- Kendala E2E: selector `#email #password #login-form #crud-q #crud-new
  #crud-body .modal-dialog [name] [data-manage] [data-editrole] #view`
  dikunci oleh `apps/web/e2e/*.spec.ts` — semua dipertahankan.

## 2. Design system (`apps/admin/src/theme.css`, baru)

Token: `--lms-primary #206bc4`, aksen indigo `#4263eb`, bg `#f4f6fb`,
surface putih, border `#e6e9f0`, radius 12/8, shadow-sm/md, sidebar 264px /
collapsed 76px, topbar 60px. Komponen: sidebar (ikon + section + active pill
+ collapse + mobile drawer via Tabler), topbar blur sticky, `.lms-page-head`,
`.lms-stat`, tabel (header uppercase, hover), badge pill, tombol gradient,
form focus ring, `.lms-toolbar` (search pill + counter), `.lms-empty`,
`.lms-skeleton` shimmer, `.lms-login-*` split layout, progress, modal,
focus-visible, breakpoint 768px & 380px. Dark mode mengikuti Tabler
(`data-bs-theme`); contrast badge mengikuti `packages/ui/contrast.css`.

## 3. App shell & login (`main.ts`)

- `iconFor()` — 22 ikon SVG inline per hash (tanpa dependensi baru).
- `visibleGroups()` — permission-aware: `#/roles` & `#/system` hanya
  super_admin; menu lain tetap untuk semua admin portal.
- Sidebar: logo+nama org (`#brand-sub`), section, active state, tombol
  collapse `#lms-collapse` (persist `admin-collapse`), kartu bantuan.
- Topbar: collapse + breadcrumb `#crumbs` + search `#g-search/#g-q` +
  notif `#notif-badge` + org `#org-sel` + lang `#lang-sel` + tema + avatar
  inisial + nama + `#logout` (semua ID lama dipertahankan).
- Login: split brand/form, validasi kosong, password toggle `#pw-toggle`,
  loading+disable `#login-btn`, fokus kembali ke password saat gagal,
  tidak ada kredensial demo di kode.

## 4. Halaman (semua 20+ route tersentuh)

- `lib.ts`: `pageHeader()`, `statCard()`, skeleton `loadingHtml()`,
  `emptyHtml()` ber-ikon, `#crud-count`, anti double-submit pada create.
- `dashboard.ts`: 6 stat berkonteks + banner notifikasi unread +
  completion/course + aktivitas 7 hari + aksi cepat + aktivitas pengajar +
  "perlu perhatian" (completion < 30%). Semua dari endpoint real:
  `reports/organization-summary|completion|teacher-activity|engagement`,
  `notifications/unread-count`. Tanpa angka karangan.
- Header+deskripsi ditambahkan ke: orgs, users (`#users-list` wrapper),
  courses, cohorts, quizzes, assignments, attendance, grades, live, scorm,
  files (via certs `renderFilesPage`), certificates, commerce, reports,
  community (social), notifications/search, system, alerts, data, settings.
  Logika CRUD, endpoint, kontrak API: tidak berubah.

## 5. Hasil test & build (aktual)

- `apps/admin`: `typecheck` OK, `eslint` OK, `vite build` OK
  (`dist/index.html 1.02 kB`, css 130 kB, js 156 kB).
- API `npm test`: run-1 190/191 (1 gagal, nama tak tercatat karena
  truncasi output — TIDAK terkait perubahan ini: tidak ada file API yang
  diubah), run-2 & run-3: **191/191 lolos**.
- E2E `portal-admin-orgs.spec.ts`: **2 passed, 1 flaky** (roles-remap
  `toHaveCount(0)` gagal di attempt-1 lalu lolos di retry — pola stale-read
  yang sudah didokumentasikan di repo; tidak ada perubahan logika roles).
- Screenshot: `admin-login.png`, `admin-dashboard.png`, `admin-orgs.png`
  (1440px), `m-login-390.png`, `m-dashboard-390.png` (390px, tanpa overflow).

## 6. Masalah tersisa (jujur)

1. Flake E2E roles-remap attempt-1 (stale read setelah PUT permissions).
2. Data dev tercemar ratusan course/user `E2E/AC/AG Course` dari run E2E —
   dashboard menampilkan angka besar yang real tapi membingungkan;
   disarankan seed ulang DB dev bila ingin angka demo bersih.
3. Teacher/student/parent hanya polish ringan (Fase 2, di bawah).
4. Tidak di-commit: working tree berisi perubahan user sebelumnya +
   perubahan fase ini; commit diserahkan ke pemilik repo.

## 7. Menjalankan

```powershell
Copy-Item .env.example .env   # sekali saja
npm install
npm run db:migrate; npm run db:seed
npm run dev                   # API :8787
npm run dev:admin             # Admin :5173
```

Login: `admin@example.com` / `Password123!` (dev only).

---

# Public Frontend Redesign — Phase 2 (selesai)

Tanggal: 2026-10-29. Cakupan: `apps/web` (situs publik) penuh +
polish aman `apps/student`, `apps/teacher`.

## Audit rute publik (aktual, dari `apps/web/src/main.ts`)

/, /features, /catalog, /bundles/:id, /instructors/:id,
/solutions + /schools /training /corporate, /pricing,
/documentation, /about, /contact, /login, /register,
/forgot, /reset/:token, /verify/:number, /verify-email/:token.
Portal: admin :5173, teacher :5175, student :5174, parent :5176
(link `PORTALS.*`, override via `VITE_PORTAL_*` atau localStorage
`portal-urls`).

## Temuan & perbaikan (web)

1. **Mockup CSS + video player palsu dihapus.**
   `previewDashboard/previewCourse/previewMobile` (kotak abu-abu +
   tombol ▶ palsu) diganti `shotDashboard/shotOrgs/shotMobile`
   memakai **screenshot aktual**
   `public/showcase-{dashboard,orgs,mobile}.png` (72/35/57 KB,
   disalin dari `docs/redesign/`, ber-caption "data demo").
2. **Landing editorial**: hero XL + CTA ganda + trust chip, bento
   12 fitur, 5 kartu portal dengan link "Open →" ke portal real,
   showcase screenshot, pipeline arsitektur (Web+PWA → REST →
   Hono → D1·R2·KV) + link API docs/OpenAPI, pricing 3 tier
   (featured Cloud, tanpa harga palsu — CTA ke `#/contact`),
   FAQ `<details>`, CTA band gradient, footer 4 kolom.
   Judul ganda diperbaiki: fitur memakai
   `product/features/featuresLead`, portal tetap `fiveExperiences`.
3. **Solutions**: layout split editorial + checklist + screenshot real.
4. **Login**: kredensial demo plaintext dihapus dari halaman;
   validasi kosong, anti double-submit `#lbtn`, `aria-live` error,
   autocomplete. Register/catalog/verify/docs/about/contact:
   struktur & ID dipertahankan.
5. Semua selector E2E dipertahankan: `#lang-sel`,
   `#cat-q/#cat-input/#cat-list/#cat-bundles`, `[data-bundle]`,
   `#lform/#le/#lp/#lerr/#roles`, `#rform`, `#cform`,
   heading `headless LMS` / `untuk sekolah`.

## Portal (minimal, tanpa mockup)

- Student: password demo dihapus dari login, brand mark + border
  topbar. `#f/#e/#p`, `#view`, bottom-nav, semua route dipertahankan.
- Teacher: password demo dihapus dari login.
- Parent: tidak diubah (sudah layak: progress, grades, attendance,
  cohorts terfilter ke anak aktual, notifikasi terpisah).

## Hasil test & build FINAL (terverifikasi 2026-10-29)

| Gate | Hasil |
|---|---|
| `typecheck` semua workspace | OK |
| `lint` root | OK |
| `build` 6 workspace | OK |
| API `npm test` | **191/191** |
| `contract` | PASS (182 refs) |
| `contract:breaking` | PASS (277 rute, no removal) |
| `contract:gaps` | PASS (280 endpoint) |
| `static-audit` | PASS |
| `audit` | PASS |
| `drill` (R2 restore) | PASS |
| `scale` | PASS (1500 siswa) |
| E2E penuh (87 test) | **81 passed, 0 failed, 0 flaky, 6 skipped** |

6 skip = `visual.spec.ts` opt-in (`VISUAL=1`); sebagai ganti ada 9
screenshot bukti di `docs/redesign/`.

Jalan menuju 100/100 (jujur, semua tercatat):
- Run E2E #1: 47 gagal — semuanya HTTP 429 karena server dev lokal
  tanpa env uji (`reuseExistingServer`). Salah prosedur, bukan bug.
- Run E2E #3: 31 gagal `ERR_CONNECTION_REFUSED :5173` — server mati
  karena kill saya sendiri di tengah run. Salah prosedur, bukan bug.
- Regresi nyata saya, diperbaiki: (a) link `.btn-link` web gagal
  kontras → jadi tombol outline; (b) kartu bantuan sidebar menambah
  `a[href="#/system"]` kedua → strict-mode violation → kartu dihapus.
- Pre-existing yang saya perbaiki sekalian: 23 node kontras Tabler
  (tab inaktif + `.btn-outline-secondary`) + badge `.bg-danger` →
  override di `packages/ui/contrast.css` (7.9:1 / 6.5:1, pola file itu).
- 1 notifikasi-hilang: fan-out `LIMIT 500` × DB tercemar 1121 member
  (bukan regresi; guard produk disengaja, DB direset ke seed bersih).
- 2 flake lama (roles-remap stale-read, cold-start login) lolos retry;
  di run final: 0 flaky.
- Screenshot: `web-landing.png`, `web-landing-id.png`,
  `web-catalog.png`, `m-web-landing-390.png` (tanpa overflow).

## Sisa (jujur)

1. Katalog dev penuh data uji E2E (`E2E/MS/RS/RC/AG…`) — real tapi
   berisik; seed ulang untuk tampilan demo bersih.
2. Roadmap yang belum ada (dinyatakan jujur di FAQ): aplikasi
   Flutter (API-ready saja), pengiriman email/push (BYOK), SSO/SLA
   Enterprise (pra-kontrak).
3. Tidak di-commit (alasan sama seperti Fase 1).

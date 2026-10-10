import '@tabler/core/dist/css/tabler.min.css';
import './style.css';
import { getDict, type WebDict } from './i18n.js';
import { esc } from '@lms/ui';

const PORTALS: Record<string, string> = {
  admin: 'http://localhost:5173',
  teacher: 'http://localhost:5175',
  student: 'http://localhost:5174',
  parent: 'http://localhost:5176',
};
try {
  const override = JSON.parse(localStorage.getItem('portal-urls') ?? '{}') as Record<
    string,
    string
  >;
  for (const [k, v] of Object.entries(override)) if (typeof v === 'string') PORTALS[k] = v;
} catch {
  /* defaults */
}

function lang(): string {
  return localStorage.getItem('web-locale') ?? 'en';
}
let t: WebDict = getDict(lang());

const META: Record<string, [string, string]> = {
  '/': [
    'LMS Headless — API-first learning platform',
    'API-first, Cloudflare-native LMS. Web + PWA + Flutter-ready, multi-organization, white-label.',
  ],
  '/features': [
    'Features — LMS Headless',
    'Courses, quizzes, assignments, attendance, grades, certificates, reports, API, PWA.',
  ],
  '/pricing': [
    'Pricing — LMS Headless',
    'Illustrative deployment plans for schools, training centers and companies.',
  ],
  '/verify': ['Verify certificate — LMS Headless', 'Public certificate verification.'],
};

function setMeta(path: string): void {
  const [title, desc] = META[path] ?? META['/'];
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
}

function header(active = ''): string {
  const link = (href: string, label: string) =>
    `<li class="nav-item"><a class="nav-link${active === href ? ' active' : ''}" href="#${href}">${label}</a></li>`;
  return `<header class="navbar navbar-expand-md sticky-top bg-white border-bottom"><div class="container-xl">
    <a class="navbar-brand" href="#/"><span class="brand-mark">L</span> LMS Headless</a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#nav" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="nav"><ul class="navbar-nav ms-auto">
    ${link('/features', t.features)}${link('/catalog', t.catalog)}${link('/solutions', t.solutions)}${link('/pricing', t.pricing)}${link('/documentation', t.docs)}${link('/about', t.about)}${link('/contact', t.contact)}
    <li class="nav-item ms-2"><select id="lang-sel" class="form-select form-select-sm" aria-label="Language"><option value="en"${lang() === 'en' ? ' selected' : ''}>EN</option><option value="id"${lang() === 'id' ? ' selected' : ''}>ID</option></select></li>
    <li class="nav-item ms-2"><a class="btn btn-outline-primary" href="#/login">${t.signIn}</a></li>
    <li class="nav-item ms-2"><a class="btn btn-primary" href="#/register">${t.getStarted}</a></li>
    </ul></div></div></header>`;
}

function footer(): string {
  return `<footer class="footer footer-transparent mt-5 border-top"><div class="container-xl"><div class="row">
    <div class="col-md-4"><h4>LMS Headless</h4><p class="text-muted">${t.footerTag}</p></div>
    <div class="col-md-2"><h4>${t.product}</h4><ul class="list-unstyled"><li><a href="#/features">${t.features}</a></li><li><a href="#/pricing">${t.pricing}</a></li><li><a href="#/documentation">${t.documentation}</a></li></ul></div>
    <div class="col-md-2"><h4>${t.solutions}</h4><ul class="list-unstyled"><li><a href="#/schools">${t.schools}</a></li><li><a href="#/training">${t.training}</a></li><li><a href="#/corporate">${t.corporate}</a></li></ul></div>
    <div class="col-md-2"><h4>${t.company}</h4><ul class="list-unstyled"><li><a href="#/about">${t.about}</a></li><li><a href="#/contact">${t.contact}</a></li><li><a href="#/verify/DEMO">${t.verifyNumber}</a></li></ul></div>
    <div class="col-md-2"><h4>${t.portals}</h4><ul class="list-unstyled"><li><a href="${PORTALS.admin}">${t.admin}</a></li><li><a href="${PORTALS.teacher}">${t.teacher}</a></li><li><a href="${PORTALS.student}">${t.student}</a></li><li><a href="${PORTALS.parent}">${t.parent}</a></li></ul></div>
  </div><div class="text-muted small mt-3">${t.footerNote}</div></div></footer>`;
}

function cta(): string {
  return `<section class="cta-band"><div class="container-xl text-center py-5">
    <h2>${t.ctaTitle}</h2>
    <p class="text-muted">${t.ctaSub}</p>
    <a class="btn btn-primary btn-lg" href="#/register">${t.getStarted}</a>
    <a class="btn btn-outline-primary btn-lg ms-2" href="#/documentation">${t.readDocs}</a></div></section>`;
}

function previewDashboard(): string {
  return `<div class="preview" aria-label="Product preview">
    <div class="preview-bar"><span></span><span></span><span></span></div>
    <div class="preview-body"><div class="preview-side"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="preview-main"><div class="preview-cards"><b></b><b></b><b></b></div><div class="preview-chart"><i style="height:60%"></i><i style="height:85%"></i><i style="height:45%"></i><i style="height:70%"></i><i style="height:95%"></i></div>
    <div class="preview-rows"><u></u><u></u><u></u></div></div></div></div>`;
}

function previewCourse(): string {
  return `<div class="preview" aria-label="Product preview">
    <div class="preview-bar"><span></span><span></span><span></span></div>
    <div class="preview-body"><div class="preview-main"><div class="preview-video"></div>
    <div class="preview-rows"><u></u><u></u></div>
    <div class="preview-progress"><i style="width:64%"></i></div></div></div></div>`;
}

function previewMobile(): string {
  return `<div class="preview phone" aria-label="Product preview">
    <div class="preview-notch"></div><div class="preview-cards col"><b></b><b></b></div>
    <div class="preview-progress"><i style="width:42%"></i></div>
    <div class="preview-rows"><u></u><u></u></div><div class="preview-nav"><i></i><i></i><i></i><i></i></div></div>`;
}

function home(): string {
  const features: [string, string][] = [
    [t.fCourseBuilder, t.fCourseBuilderD],
    [t.fQuiz, t.fQuizD],
    [t.fAssign, t.fAssignD],
    [t.fAttend, t.fAttendD],
    [t.fGrades, t.fGradesD],
    [t.fCerts, t.fCertsD],
    [t.fProgress, t.fProgressD],
    [t.fNotif, t.fNotifD],
    [t.fWhite, t.fWhiteD],
    [t.fMulti, t.fMultiD],
    [t.fApi, t.fApiD],
    [t.fPwa, t.fPwaD],
  ];
  const roles: [string, string][] = [
    [t.roleAdmin, t.roleAdminD],
    [t.roleTeacher, t.roleTeacherD],
    [t.roleStudent, t.roleStudentD],
    [t.roleParent, t.roleParentD],
    [t.roleStaff, t.roleStaffD],
  ];
  const faqs: [string, string][] =
    lang() === 'id'
      ? [
          [
            'Apakah ada aplikasi mobile?',
            'Portal siswa adalah PWA yang dapat dipasang dengan shell offline, dan REST API dirancang untuk klien Flutter Android/iOS.',
          ],
          [
            'Bisakah satu instalasi melayani banyak sekolah?',
            'Ya. Organisasi adalah tenant terisolasi dengan pengguna, kursus, merek, dan laporan masing-masing.',
          ],
          [
            'Bisakah memakai merek sendiri?',
            'Ya. Setiap organisasi mengatur nama, logo, warna, footer, dan info dukungan.',
          ],
          [
            'Di mana data dihosting?',
            'Cloudflare-native: Workers untuk API, D1 untuk database, R2 untuk berkas, KV untuk rate limiting. SQLite lokal untuk development.',
          ],
          [
            'Apakah surel/push termasuk?',
            'Arsitekturnya (preferensi notifikasi, langganan push) sudah ada. Penyedia pengiriman butuh kredensial Anda sendiri — tidak ada yang dipalsukan.',
          ],
        ]
      : [
          [
            'Is there a mobile app?',
            'The student portal is an installable PWA with an offline shell, and the REST API is designed for a Flutter Android/iOS client.',
          ],
          [
            'Can one installation serve many schools?',
            'Yes. Organizations are isolated tenants with their own users, courses, branding and reports.',
          ],
          [
            'Can I use my own brand?',
            'Yes. Each organization configures its name, logo, colors, footer and support info.',
          ],
          [
            'Where is data hosted?',
            'Cloudflare-native: Workers for API, D1 for database, R2 for files, KV for rate limiting. Local SQLite for development.',
          ],
          [
            'Is email/push included?',
            'The architecture (notification preferences, push subscriptions) is built in. Delivery providers need your own credentials — nothing is faked.',
          ],
        ];
  return `
  <section class="hero"><div class="container-xl row align-items-center">
    <div class="col-md-6"><span class="badge bg-blue mb-2">${t.tagline}</span>
    <h1 class="display-4">${t.heroTitle}</h1>
    <p class="lead text-muted">${t.heroSub}</p>
    <a class="btn btn-primary btn-lg" href="#/register">${t.getStarted}</a>
    <a class="btn btn-outline-primary btn-lg ms-2" href="#/documentation">${t.apiDocs}</a>
    <div class="mt-3 small text-muted">${t.rolesNote}</div></div>
    <div class="col-md-6">${previewDashboard()}</div></div></section>
  <section class="container-xl py-4"><div class="row row-cards">
    ${features.map(([x, y]) => `<div class="col-sm-6 col-lg-4"><div class="card h-100"><div class="card-body"><h3 class="card-title">${x}</h3><p class="text-muted">${y}</p></div></div></div>`).join('')}
  </div></section>
  <section class="container-xl py-4"><h2>${t.fiveExperiences}</h2>
  <p class="text-muted">${t.fiveExperiencesSub}</p>
  <div class="row row-cards">${roles.map(([x, y]) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3 class="card-title">${x}</h3><p class="text-muted">${y}</p></div></div></div>`).join('')}</div></section>
  <section class="container-xl py-4"><h2>${t.seeProduct}</h2><div class="row">${`<div class="col-md-6">${previewCourse()}</div><div class="col-md-6">${previewMobile()}</div>`}</div></section>
  <section class="container-xl py-4"><h2>${t.architecture}</h2>
  <div class="arch"><span>${t.archLine}</span></div>
  <p class="text-muted">${t.architectureSub}</p></section>
  <section class="container-xl py-4"><h2>${t.pricing}</h2>
  <div class="row row-cards">
    ${[
      [t.startFree, t.pricingLead, ['Full source', 'SQLite + local files', 'Community docs']],
      [
        'Cloud',
        'Managed hosting',
        ['Workers + D1 + R2', 'White-label onboarding', 'Email support'],
      ],
      [
        'Enterprise',
        'Groups & companies',
        ['SSO & integrations', 'SLA & training', 'Flutter delivery'],
      ],
    ]
      .map(
        ([x, s, pts]) =>
          `<div class="col-md-4"><div class="card h-100"><div class="card-body text-center"><h3>${x}</h3><p class="text-muted">${s}</p><ul class="list-unstyled text-start">${(pts as string[]).map((p) => `<li>✓ ${p}</li>`).join('')}</ul><a class="btn btn-primary" href="#/contact">${t.contactUs}</a></div></div></div>`
      )
      .join('')}
  </div><p class="text-muted small mt-2">${t.pricingNote}</p></section>
  <section class="container-xl py-4"><h2>${t.faq}</h2>
  ${faqs.map(([q, a]) => `<details class="mb-2"><summary><strong>${q}</strong></summary><p class="text-muted mt-1">${a}</p></details>`).join('')}</section>
  ${cta()}`;
}

function featuresPage(): string {
  const groups: [string, string[]][] =
    lang() === 'id'
      ? [
          [
            'Mengajar',
            [
              'Penyusun kursus dengan bab, pelajaran, dan urutan',
              'Teks kaya, video, dokumen, gambar, sumber eksternal',
              'Status draf/terbit',
              'Bank soal dengan pengacakan dan penilaian manual',
              'Batas waktu, batas percobaan, nilai negatif',
              'Tugas dengan tenggat dan aturan kirim ulang',
            ],
          ],
          [
            'Pelacakan',
            [
              'Progres pelajaran, kuis, dan tugas',
              'Kehadiran dan laporan persentase',
              'Nilai, kategori, dan umpan balik',
              'Laporan organisasi, penyelesaian, dan aktivitas guru',
            ],
          ],
          [
            'Platform',
            [
              'REST API /api/v1 dengan OpenAPI',
              'PWA terpasang dengan sinkronisasi aman',
              'JSON siap-Flutter dengan idempotency',
              'Isolasi tenant multi-organisasi',
              'White-label per organisasi',
              'Log audit, CORS, rate limiting',
            ],
          ],
        ]
      : [
          [
            'Teaching',
            [
              'Course builder with sections, lessons and ordering',
              'Rich text, video, documents, images, external resources',
              'Draft/published states',
              'Question banks with shuffle and manual grading',
              'Time limits, attempt limits, negative marking',
              'Assignments with due dates and resubmission rules',
            ],
          ],
          [
            'Tracking',
            [
              'Lesson, quiz and assignment progress',
              'Attendance with percentage reports',
              'Grades, categories and feedback',
              'Organization, completion and teacher-activity reports',
            ],
          ],
          [
            'Platform',
            [
              'REST API /api/v1 with OpenAPI',
              'Installable PWAs with safe sync',
              'Flutter-ready JSON with idempotency',
              'Multi-organization tenant isolation',
              'Per-organization white-label',
              'Audit logging, CORS, rate limiting',
            ],
          ],
        ];
  return `<div class="container-xl py-4"><h1>${t.features}</h1><p class="text-muted">${t.featuresLead}</p>
  ${groups.map(([x, items]) => `<h2 class="mt-4">${x}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`).join('')}</div>${cta()}`;
}

function solutionPage(kind: string): string {
  const data: Record<string, [string, string, string[]]> =
    lang() === 'id'
      ? {
          solutions: [
            t.solutions,
            t.solutionsLead,
            [
              'Sekolah: kelas, mata pelajaran, kehadiran, visibilitas orang tua',
              'Pelatihan: katalog, kuis, sertifikat',
              'Perusahaan: onboarding, catatan kepatuhan, laporan',
            ],
          ],
          schools: [
            t.schools,
            'Tahun ajaran, semester, kelas — plus orang tua dalam lingkaran.',
            [
              'Daftar kelas dan wali kelas',
              'Kehadiran per sesi',
              'Nilai terlihat oleh siswa dan orang tua tertaut',
              'Pengumuman seluruh organisasi',
            ],
          ],
          training: [
            t.training,
            'Jual dan sajikan kursus dengan bukti penyelesaian.',
            [
              'Katalog dengan kontrol visibilitas',
              'Kuis dengan ambang lulus dan batas percobaan',
              'Sertifikat dengan tautan verifikasi publik',
              'Laporan progres per siswa dan kohor',
            ],
          ],
          corporate: [
            t.corporate,
            'Onboarding dan upskilling dengan catatan teraudit.',
            [
              'Organisasi per departemen atau klien',
              'Akses berbasis peran',
              'Log audit untuk nilai dan sertifikat',
              'Akses API untuk integrasi HR',
            ],
          ],
        }
      : {
          solutions: [
            t.solutions,
            t.solutionsLead,
            [
              'K-12 schools: classes, subjects, attendance, parent visibility',
              'Training centers: catalogs, quizzes, certificates',
              'Companies: onboarding tracks, compliance records, reports',
            ],
          ],
          schools: [
            t.schools,
            'Academic years, terms, classes and subjects — plus parents in the loop.',
            [
              'Class rosters and homeroom teachers',
              'Attendance per session',
              'Grades visible to students and linked parents',
              'Organization announcements',
            ],
          ],
          training: [
            t.training,
            'Sell and deliver courses with proof of completion.',
            [
              'Catalog with visibility controls',
              'Quizzes with passing scores and attempt limits',
              'Certificates with public verification links',
              'Progress reports per student and cohort',
            ],
          ],
          corporate: [
            t.corporate,
            'Onboard and upskill teams with auditable records.',
            [
              'Organization per department or client',
              'Role-based access',
              'Audit logs for grades and certificates',
              'API access for HR integrations',
            ],
          ],
        };
  const [x, s, items] = data[kind] ?? data.solutions;
  return `<div class="container-xl py-4"><h1>${x}</h1><p class="lead text-muted">${s}</p>
  <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
  <div class="row mt-4"><div class="col-md-6">${previewDashboard()}</div><div class="col-md-6">${previewCourse()}</div></div></div>${cta()}`;
}

function pricingPage(): string {
  return `<div class="container-xl py-4"><h1>${t.pricing}</h1><p class="text-muted">${t.pricingLead}</p>
  <div class="row row-cards">
  ${[
    [t.startFree, t.pricingLead, ['3 organizations', 'White-label', 'PWA portals']],
    ['Growth', t.solutions, ['Unlimited courses*', 'Certificates', 'Reports']],
    ['Enterprise', t.corporate, ['Custom domains', 'SSO', 'SLA']],
  ]
    .map(
      ([x, s, pts]) =>
        `<div class="col-md-4"><div class="card h-100"><div class="card-body text-center"><h3>${x}</h3><p class="text-muted">${s}</p><ul class="list-unstyled text-start">${(pts as string[]).map((p) => `<li>✓ ${p}</li>`).join('')}</ul><a class="btn btn-primary" href="#/contact">${t.contactUs}</a></div></div></div>`
    )
    .join('')}
  </div><p class="text-muted small mt-3">${t.fairUse}</p></div>${cta()}`;
}

function docsPage(): string {
  return `<div class="container-xl py-4"><h1>${t.documentation}</h1>
  <div class="row row-cards">
  ${[
    ['API', '/api/v1/docs'],
    ['Flutter', '/docs/flutter.md'],
    ['White-label', '/docs/white-label.md'],
    ['PWA', '/docs/pwa.md'],
    ['Cloudflare', '/docs/cloudflare.md'],
    ['Security', '/docs/security.md'],
  ]
    .map(
      ([x, href]) =>
        `<div class="col-md-4"><div class="card"><div class="card-body"><h3 class="card-title">${x}</h3><a href="${href}" class="btn btn-sm btn-outline-primary">${t.view ?? 'Open'}</a></div></div></div>`
    )
    .join('')}
  </div>
  <h2 class="mt-4">${t.quickstart}</h2>
  <pre class="card card-body"><code>npm install
npm run db:migrate
npm run db:seed
npm run dev</code></pre>
  <h2 class="mt-4">${t.auth30}</h2>
  <pre class="card card-body"><code>POST /api/v1/auth/login {"email","password"}
GET /api/v1/courses  # Authorization: Bearer &lt;token&gt;</code></pre>
  <p class="text-muted">${t.docsGuidesNote}</p></div>${cta()}`;
}

function aboutPage(): string {
  return `<div class="container-xl py-4"><h1>${t.about}</h1>
  <p class="lead text-muted">${t.aboutLead}</p>
  <h2>${t.principles}</h2><ul><li>API-first</li><li>SQLite / D1</li><li>${t.faq}</li></ul>
  <h2>${t.technology}</h2><p class="text-muted">TypeScript, Hono, Workers/D1/R2/KV, Tabler, Vite.</p></div>${cta()}`;
}

function contactPage(): string {
  return `<div class="container-xl py-4"><h1>${t.contact}</h1>
  <div class="row"><div class="col-md-6"><div class="card"><div class="card-body"><form id="cform">
  <label class="form-label" for="cn">${t.name}</label><input id="cn" class="form-control mb-2" required>
  <label class="form-label" for="ce">${t.email}</label><input id="ce" type="email" class="form-control mb-2" required>
  <label class="form-label" for="cm">${t.message}</label><textarea id="cm" class="form-control mb-3" rows="5" required></textarea>
  <button class="btn btn-primary">${t.sendViaEmail}</button></form>
  <p class="text-muted small mt-2">${t.contactNote}</p></div></div></div>
  <div class="col-md-6"><h2>${t.portals}</h2><ul><li><a href="${PORTALS.admin}">${t.admin}</a></li><li><a href="${PORTALS.teacher}">${t.teacher}</a></li><li><a href="${PORTALS.student}">${t.student}</a></li><li><a href="${PORTALS.parent}">${t.parent}</a></li></ul>
  <h2>API</h2><p><a href="/api/v1/docs">API</a> · <a href="/api/v1/openapi.json">OpenAPI</a></p></div></div></div>`;
}

function loginPage(): string {
  return `<div class="container-xl py-5"><div class="row justify-content-center"><div class="col-md-5"><div class="card"><div class="card-body">
  <h1>${t.signIn}</h1><p class="text-muted">${t.authenticate}</p>
  <form id="lform"><label class="form-label" for="le">${t.email}</label><input id="le" type="email" class="form-control mb-2" required>
  <label class="form-label" for="lp">${t.password}</label><input id="lp" type="password" class="form-control mb-3" required>
  <div id="lerr"></div><button class="btn btn-primary w-100">${t.signIn}</button></form>
  <div id="roles" class="mt-3"></div>
  <p class="mt-3">${t.noAccount} <a href="#/register">${t.register}</a> · ${t.loginDemo}</p></div></div></div></div></div>`;
}

async function verifyPage(num: string): Promise<string> {
  try {
    const res = await fetch(`/api/v1/certificates/verify/${encodeURIComponent(num)}`);
    const j = (await res.json()) as {
      success: boolean;
      data?: { valid?: boolean; certificate: Record<string, string> };
      error?: { message: string };
    };
    if (!j.success || !j.data)
      return `<div class="container-xl py-5"><div class="alert alert-danger">${t.verifyFail}</div></div>`;
    const cc = j.data.certificate;
    return `<div class="container-xl py-5"><div class="card"><div class="card-body text-center">
      <div class="display-6">🎓</div><h1>${t.verifyTitle}</h1>
      <p><strong>${cc.student_name}</strong> ${t.completed} <strong>${cc.course_title}</strong></p>
      <p class="text-muted">${cc.organization_name} · ${t.issued} ${cc.issued_at?.slice(0, 10) ?? ''}</p>
      <code>${cc.certificate_number}</code></div></div></div>`;
  } catch {
    return `<div class="container-xl py-5"><div class="alert alert-danger">${t.verifyServiceDown}</div></div>`;
  }
}

async function verifyEmailPage(token: string): Promise<string> {
  try {
    const res = await fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const j = (await res.json()) as { success: boolean };
    return j.success
      ? `<div class="container-xl py-5"><div class="alert alert-success">Email verified. <a href="#/login">${t.signIn}</a></div></div>`
      : `<div class="container-xl py-5"><div class="alert alert-danger">${t.verifyFail}</div></div>`;
  } catch {
    return `<div class="container-xl py-5"><div class="alert alert-danger">${t.verifyServiceDown}</div></div>`;
  }
}

function registerPage(): string {
  return `<div class="container-xl py-5"><div class="row justify-content-center"><div class="col-md-5"><div class="card"><div class="card-body">
  <h1>${t.createAccount}</h1><p class="text-muted">${t.tryDemo}</p>
  <form id="rform"><label class="form-label" for="rn">${t.fullName}</label><input id="rn" class="form-control mb-2" required>
  <label class="form-label" for="re">${t.email}</label><input id="re" type="email" class="form-control mb-2" required>
  <label class="form-label" for="rp">${t.password}</label><input id="rp" type="password" class="form-control mb-3" required minlength="8">
  <div id="rerr"></div><button class="btn btn-primary w-100">${t.register}</button></form>
  <div id="rok" class="mt-3"></div></div></div></div></div></div>`;
}

function catalogPage(): string {
  return `<div class="container-xl py-4"><h1>${t.catalog}</h1>
  <p class="text-muted">${t.publishedCatalog}</p>
  <form id="cat-q" class="d-flex gap-2 mb-3"><input id="cat-input" class="form-control" placeholder="${t.search}…"><button class="btn btn-primary">${t.search}</button></form>
  <div id="cat-list"><p>${t.loading ?? 'Loading…'}</p></div>
  <h2 class="mt-4">${t.bundlesTitle}</h2><div id="cat-bundles"><p>…</p></div></div>`;
}

// Prefetched bundle payloads: the page loader already fetched the detail,
// so the post-render effect reuses it instead of fetching twice.
const bundleCache = new Map<string, unknown>();

async function bundlePage(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/v1/catalog/bundles/${encodeURIComponent(id)}`);
    if (!res.ok)
      return `<div class="container-xl py-5"><div class="alert alert-warning">${t.bundleNotFound}</div></div>`;
    bundleCache.set(id, await res.json());
    return `<div class="container-xl py-4" data-bundle="${id}"><p>…</p></div>`;
  } catch {
    return `<div class="container-xl py-5"><div class="alert alert-danger">${t.catalogUnavailable}</div></div>`;
  }
}

async function instructorPage(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/v1/catalog/instructors/${encodeURIComponent(id)}`);
    const j = (await res.json()) as {
      success: boolean;
      data?: {
        instructor: { name: string };
        courses: { id: string; title: string; price: number }[];
      };
    };
    if (!j.success || !j.data)
      return `<div class="container-xl py-5"><div class="alert alert-warning">${t.instructorNotFound}</div></div>`;
    return `<div class="container-xl py-4"><h1>${esc(j.data.instructor.name)}</h1><p class="text-muted">${t.teacher}</p>
      <h2>${t.courses ?? 'Courses'}</h2><div class="row">${j.data.courses.map((c) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3 class="card-title">${esc(c.title)}</h3><p>${c.price > 0 ? Number(c.price) : ''}</p><a class="btn btn-sm btn-primary" href="${PORTALS.student}">${t.learn}</a></div></div></div>`).join('') || `<p>${t.noPublicCourses}</p>`}</div></div>`;
  } catch {
    return `<div class="container-xl py-5"><div class="alert alert-danger">${t.catalogUnavailable}</div></div>`;
  }
}

async function router(): Promise<void> {
  t = getDict(lang());
  const app = document.getElementById('app') as HTMLElement;
  const raw = location.hash.replace('#', '') || '/';
  const [path] = raw.split('?');
  let body = '';
  if (path === '/' || path === '') {
    body = home();
    setMeta('/');
  } else if (path === '/features') {
    body = featuresPage();
    setMeta('/features');
  } else if (path === '/catalog') {
    body = catalogPage();
    setMeta('/features');
  } else if (path.startsWith('/bundles/')) {
    body = await bundlePage(path.split('/')[2] ?? '');
    setMeta('/features');
  } else if (path.startsWith('/instructors/')) {
    body = await instructorPage(path.split('/')[2] ?? '');
    setMeta('/features');
  } else if (['/solutions', '/schools', '/training', '/corporate'].includes(path)) {
    body = solutionPage(path.slice(1));
    setMeta('/');
  } else if (path === '/pricing') {
    body = pricingPage();
    setMeta('/pricing');
  } else if (path === '/documentation') {
    body = docsPage();
    setMeta('/');
  } else if (path === '/about') {
    body = aboutPage();
    setMeta('/');
  } else if (path === '/contact') {
    body = contactPage();
    setMeta('/');
  } else if (path === '/login') {
    body = loginPage();
    setMeta('/');
  } else if (path === '/register') {
    body = registerPage();
    setMeta('/');
  } else if (path.startsWith('/verify/')) {
    body = await verifyPage(path.split('/')[2] ?? '');
    setMeta('/verify');
  } else if (path.startsWith('/verify-email/')) {
    body = await verifyEmailPage(path.split('/')[2] ?? '');
    setMeta('/verify');
  } else
    body = `<div class="container-xl py-5"><div class="alert alert-warning">${t.pageNotFound} <a href="#/">${t.home}</a></div></div>`;
  app.innerHTML = `${header(path)}${body}${footer()}`;
  window.scrollTo(0, 0);
  (document.getElementById('lang-sel') as HTMLSelectElement | null)?.addEventListener(
    'change',
    (e) => {
      localStorage.setItem('web-locale', (e.target as HTMLSelectElement).value);
      t = getDict(lang());
      void router();
    }
  );

  const catForm = document.getElementById('cat-q') as HTMLFormElement | null;
  const loadCatalog = async (q = '') => {
    const list = document.getElementById('cat-list');
    const bun = document.getElementById('cat-bundles');
    if (!list || !bun) return;
    try {
      const [cr, br] = await Promise.all([
        fetch(`/api/v1/catalog/courses${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) =>
          r.json()
        ),
        fetch('/api/v1/catalog/bundles').then((r) => r.json()),
      ]);
      const courses =
        (cr as { data?: { id: string; title: string; code: string; price: number }[] }).data ?? [];
      const bundles = (br as { data?: { id: string; name: string; price: number }[] }).data ?? [];
      list.innerHTML = courses.length
        ? `<div class="row">${courses.map((c) => `<div class="col-md-4"><div class="card mb-3"><div class="card-body"><h3 class="card-title">${esc(c.title)}</h3><p class="text-muted">${esc(c.code)} · ${c.price > 0 ? Number(c.price) : ''}</p><a class="btn btn-sm btn-primary" href="${PORTALS.student}">${t.learn}</a></div></div></div>`).join('')}</div>`
        : `<p class="text-muted">${t.noCourses}</p>`;
      bun.innerHTML = bundles.length
        ? `<div class="row">${bundles.map((b) => `<div class="col-md-4"><div class="card mb-3"><div class="card-body"><h3 class="card-title">${esc(b.name)}</h3><p>${Number(b.price)}</p><a class="btn btn-sm btn-outline-primary" href="#/bundles/${b.id}">${t.view ?? 'View'}</a></div></div></div>`).join('')}</div>`
        : `<p class="text-muted">${t.noBundles}</p>`;
    } catch {
      if (list) list.innerHTML = `<div class="alert alert-danger">${t.catalogUnavailable}</div>`;
    }
  };
  if (catForm) {
    void loadCatalog();
    catForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void loadCatalog((document.getElementById('cat-input') as HTMLInputElement).value);
    });
  }
  const bundleBox = document.querySelector('[data-bundle]') as HTMLElement | null;
  if (bundleBox) {
    const id = bundleBox.dataset.bundle ?? '';
    const cached = bundleCache.get(id);
    bundleCache.delete(id);
    (cached
      ? Promise.resolve(cached)
      : fetch(`/api/v1/catalog/bundles/${id}`).then((r) => r.json())
    )
      .then((j) => {
        const det = j as {
          success: boolean;
          data?: {
            bundle: { name: string; description: string | null; price: number };
            courses: { title: string; price: number }[];
          };
        };
        bundleBox.innerHTML =
          det.success && det.data
            ? `<h1>${esc(det.data.bundle.name)}</h1><p class="text-muted">${esc(det.data.bundle.description ?? '')}</p><p><strong>${Number(det.data.bundle.price)}</strong></p><ul>${det.data.courses.map((c) => `<li>${esc(c.title)} (${Number(c.price)})</li>`).join('')}</ul><a class="btn btn-primary" href="${PORTALS.student}">${t.getStarted}</a>`
            : `<div class="alert alert-warning">${t.bundleNotFound}</div>`;
      })
      .catch(() => {
        bundleBox.innerHTML = `<div class="alert alert-danger">${t.catalogUnavailable}</div>`;
      });
  }

  const cform = document.getElementById('cform') as HTMLFormElement | null;
  cform?.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = (document.getElementById('cn') as HTMLInputElement).value;
    const em = (document.getElementById('ce') as HTMLInputElement).value;
    const m = (document.getElementById('cm') as HTMLTextAreaElement).value;
    location.href = `mailto:support@example.com?subject=${encodeURIComponent(`LMS inquiry from ${n}`)}&body=${encodeURIComponent(`${m}\n\n— ${n} <${em}>`)}`;
  });
  const lform = document.getElementById('lform') as HTMLFormElement | null;
  lform?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('le') as HTMLInputElement).value;
    const password = (document.getElementById('lp') as HTMLInputElement).value;
    try {
      const res = await fetch('/api/v1/auth/login?cookie=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = (await res.json()) as {
        success: boolean;
        data?: { access_token: string; user: { memberships: { role: string }[] } };
        error?: { message: string };
      };
      if (!j.success || !j.data) throw new Error(j.error?.message ?? 'Login failed');
      const roles = j.data.user.memberships.map((m) => m.role);
      const primary =
        roles.includes('organization_admin') || roles.includes('super_admin')
          ? 'admin'
          : roles.includes('teacher')
            ? 'teacher'
            : roles.includes('parent')
              ? 'parent'
              : 'student';
      sessionStorage.setItem('lms-token', j.data.access_token);
      (document.getElementById('roles') as HTMLElement).innerHTML =
        `<div class="alert alert-success">${t.signedInAs} ${roles.join(', ') || 'user'}. <a class="btn btn-sm btn-primary ms-2" href="${PORTALS[primary]}">${t.openPortal} ${primary} ${t.portal}</a></div>
        <div class="small text-muted">${t.sessionNote}</div>`;
    } catch (err) {
      (document.getElementById('lerr') as HTMLElement).innerHTML =
        `<div class="alert alert-danger">${err instanceof Error ? err.message : 'Login failed'}</div>`;
    }
  });
  const rform = document.getElementById('rform') as HTMLFormElement | null;
  rform?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: (document.getElementById('re') as HTMLInputElement).value,
          password: (document.getElementById('rp') as HTMLInputElement).value,
          name: (document.getElementById('rn') as HTMLInputElement).value,
        }),
      });
      const j = (await res.json()) as { success: boolean; error?: { message: string } };
      if (!j.success) throw new Error(j.error?.message ?? 'Registration failed');
      (document.getElementById('rok') as HTMLElement).innerHTML =
        `<div class="alert alert-success">${t.accountCreated} <a href="${PORTALS.student}">${t.openStudent}</a></div>`;
    } catch (err) {
      (document.getElementById('rerr') as HTMLElement).innerHTML =
        `<div class="alert alert-danger">${err instanceof Error ? err.message : 'Failed'}</div>`;
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
window.addEventListener('hashchange', () => void router());
void router();

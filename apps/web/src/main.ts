import '@tabler/core/dist/css/tabler.min.css';
import './style.css';

const PORTALS: Record<string, string> = {
  admin: 'http://localhost:5173',
  teacher: 'http://localhost:5175',
  student: 'http://localhost:5174',
  parent: 'http://localhost:5176',
};
try {
  const override = JSON.parse(localStorage.getItem('portal-urls') ?? '{}') as Record<string, string>;
  for (const [k, v] of Object.entries(override)) if (typeof v === 'string') PORTALS[k] = v;
} catch { /* defaults */ }

const META: Record<string, [string, string]> = {
  '/': ['LMS Headless — API-first learning platform', 'API-first, Cloudflare-native LMS. Web + PWA + Flutter-ready, multi-organization, white-label.'],
  '/features': ['Features — LMS Headless', 'Courses, quizzes, assignments, attendance, grades, certificates, reports, API, PWA.'],
  '/pricing': ['Pricing — LMS Headless', 'Illustrative deployment plans for schools, training centers and companies.'],
  '/verify': ['Verify certificate — LMS Headless', 'Public certificate verification.'],
};

function setMeta(path: string): void {
  const [title, desc] = META[path] ?? META['/'];
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
}

function header(active = ''): string {
  const link = (href: string, label: string) => `<li class="nav-item"><a class="nav-link${active === href ? ' active' : ''}" href="#${href}">${label}</a></li>`;
  return `<header class="navbar navbar-expand-md sticky-top bg-white border-bottom"><div class="container-xl">
    <a class="navbar-brand" href="#/"><span class="brand-mark">L</span> LMS Headless</a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#nav" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="nav"><ul class="navbar-nav ms-auto">
    ${link('/features', 'Features')}${link('/solutions', 'Solutions')}${link('/pricing', 'Pricing')}${link('/documentation', 'Docs')}${link('/about', 'About')}${link('/contact', 'Contact')}
    <li class="nav-item ms-2"><a class="btn btn-outline-primary" href="#/login">Sign in</a></li>
    <li class="nav-item ms-2"><a class="btn btn-primary" href="#/register">Get started</a></li>
    </ul></div></div></header>`;
}

function footer(): string {
  return `<footer class="footer footer-transparent mt-5 border-top"><div class="container-xl"><div class="row">
    <div class="col-md-4"><h4>LMS Headless</h4><p class="text-muted">API-first learning management system.<br>Web + PWA · Flutter-ready API · Cloudflare-native.</p></div>
    <div class="col-md-2"><h4>Product</h4><ul class="list-unstyled"><li><a href="#/features">Features</a></li><li><a href="#/pricing">Pricing</a></li><li><a href="#/documentation">Documentation</a></li></ul></div>
    <div class="col-md-2"><h4>Solutions</h4><ul class="list-unstyled"><li><a href="#/schools">Schools</a></li><li><a href="#/training">Training</a></li><li><a href="#/corporate">Corporate</a></li></ul></div>
    <div class="col-md-2"><h4>Company</h4><ul class="list-unstyled"><li><a href="#/about">About</a></li><li><a href="#/contact">Contact</a></li><li><a href="#/verify/DEMO">Verify certificate</a></li></ul></div>
    <div class="col-md-2"><h4>Portals</h4><ul class="list-unstyled"><li><a href="${PORTALS.admin}">Admin</a></li><li><a href="${PORTALS.teacher}">Teacher</a></li><li><a href="${PORTALS.student}">Student</a></li><li><a href="${PORTALS.parent}">Parent</a></li></ul></div>
  </div><div class="text-muted small mt-3">© 2026 LMS Headless. Demo dataset only — no real customer data. Licensing terms are set by the product owner (see LICENSE).</div></div></footer>`;
}

function cta(): string {
  return `<section class="cta-band"><div class="container-xl text-center py-5">
    <h2>Run your academy on an API-first LMS</h2>
    <p class="text-muted">Spin up an organization, invite teachers, publish your first course today.</p>
    <a class="btn btn-primary btn-lg" href="#/register">Get started</a>
    <a class="btn btn-outline-primary btn-lg ms-2" href="#/documentation">Read the docs</a></div></section>`;
}

// Simplified static preview of the actual admin UI (illustrative mock).
function previewDashboard(): string {
  return `<div class="preview" aria-label="Product preview of the admin dashboard">
    <div class="preview-bar"><span></span><span></span><span></span></div>
    <div class="preview-body"><div class="preview-side"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="preview-main"><div class="preview-cards"><b></b><b></b><b></b></div><div class="preview-chart"><i style="height:60%"></i><i style="height:85%"></i><i style="height:45%"></i><i style="height:70%"></i><i style="height:95%"></i></div>
    <div class="preview-rows"><u></u><u></u><u></u></div></div></div>
    <div class="preview-cap">Product preview — actual admin dashboard</div></div>`;
}

function previewCourse(): string {
  return `<div class="preview" aria-label="Product preview of the course player">
    <div class="preview-bar"><span></span><span></span><span></span></div>
    <div class="preview-body"><div class="preview-main"><div class="preview-video"></div>
    <div class="preview-rows"><u></u><u></u></div>
    <div class="preview-progress"><i style="width:64%"></i></div></div></div>
    <div class="preview-cap">Product preview — student course player</div></div>`;
}

function previewMobile(): string {
  return `<div class="preview phone" aria-label="Product preview of the student mobile app">
    <div class="preview-notch"></div><div class="preview-cards col"><b></b><b></b></div>
    <div class="preview-progress"><i style="width:42%"></i></div>
    <div class="preview-rows"><u></u><u></u></div><div class="preview-nav"><i></i><i></i><i></i><i></i></div>
    <div class="preview-cap">Product preview — student PWA on mobile</div></div>`;
}

function home(): string {
  const features: [string, string][] = [
    ['📚 Course builder', 'Sections, lessons, ordering, drafts, rich content, video and documents.'],
    ['📝 Quiz engine', 'Multiple choice, true/false, short answer, attempts, time limits, auto + manual grading.'],
    ['📤 Assignments', 'Instructions, due dates, resubmission rules, teacher review and feedback.'],
    ['🗓 Attendance', 'Sessions per class or course, present/absent/late/excused, percentage reports.'],
    ['⭐ Grades', 'Categories, scores, feedback, role-scoped visibility for students and parents.'],
    ['🎓 Certificates', 'Templates, issuance on completion, public verification page.'],
    ['📊 Progress & reports', 'Lesson, quiz and assignment completion; organization, course and teacher reports.'],
    ['🔔 Notifications', 'Announcements fan-out, unread counts, preferences, push architecture.'],
    ['🏷 White-label', 'Per-organization name, logo, colors, footer and support info.'],
    ['🏢 Multi-organization', 'Strict tenant isolation tested org-vs-org, user-vs-user.'],
    ['🔌 API-first', 'Everything important is REST under /api/v1 with OpenAPI docs.'],
    ['📱 PWA + Flutter-ready', 'Installable apps with offline shell; stable JSON for Flutter clients.'],
  ];
  const roles: [string, string][] = [
    ['Admin', 'Organizations, users, roles, branding, settings, reports, audit log.'],
    ['Teacher', 'Assigned courses, lesson and quiz authoring, grading queue, attendance, student progress.'],
    ['Student', 'Enrolled courses, progress, quizzes, assignments, grades, certificates — mobile-first PWA.'],
    ['Parent', 'Linked children only: progress, grades, attendance, announcements.'],
    ['Staff', 'Operational access: attendance, announcements, reports.'],
  ];
  const faqs: [string, string][] = [
    ['Is there a mobile app?', 'The student portal is an installable PWA with an offline shell, and the REST API is designed for a Flutter Android/iOS client.'],
    ['Can one installation serve many schools?', 'Yes. Organizations are isolated tenants with their own users, courses, branding and reports.'],
    ['Can I use my own brand?', 'Yes. Each organization configures its name, logo, colors, footer and support info.'],
    ['Where is data hosted?', 'Cloudflare-native: Workers for API, D1 for database, R2 for files, KV for rate limiting. Local SQLite/filesystem for development.'],
    ['Is email/push included?', 'The architecture (notification preferences, push subscriptions) is built in. Delivery providers need your own credentials — nothing is faked.'],
  ];
  return `
  <section class="hero"><div class="container-xl row align-items-center">
    <div class="col-md-6"><span class="badge bg-blue mb-2">API-first · Cloudflare-native · PWA</span>
    <h1 class="display-4">The headless LMS for schools, training & companies</h1>
    <p class="lead text-muted">Courses, quizzes, assignments, attendance, grades and certificates — delivered through a clean REST API to web portals, installable PWAs and your future Flutter app.</p>
    <a class="btn btn-primary btn-lg" href="#/register">Get started</a>
    <a class="btn btn-outline-primary btn-lg ms-2" href="#/documentation">API docs</a>
    <div class="mt-3 small text-muted">Multi-organization · White-label · Roles for admin, teacher, student, parent, staff</div></div>
    <div class="col-md-6">${previewDashboard()}</div></div></section>
  <section class="container-xl py-4"><div class="row row-cards">
    ${features.map(([t, x]) => `<div class="col-sm-6 col-lg-4"><div class="card h-100"><div class="card-body"><h3 class="card-title">${t}</h3><p class="text-muted">${x}</p></div></div></div>`).join('')}
  </div></section>
  <section class="container-xl py-4"><h2>One platform, five experiences</h2>
  <p class="text-muted">Each role gets a purpose-built portal — not one dashboard with a different menu.</p>
  <div class="row row-cards">${roles.map(([t, x]) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3 class="card-title">${t}</h3><p class="text-muted">${x}</p></div></div></div>`).join('')}</div></section>
  <section class="container-xl py-4"><h2>See the product</h2><div class="row">${`<div class="col-md-6">${previewCourse()}</div><div class="col-md-6">${previewMobile()}</div>`}</div></section>
  <section class="container-xl py-4"><h2>Architecture</h2>
  <div class="arch"><span>Web + PWA portals</span>→<span>REST /api/v1</span>→<span>Hono on Workers</span>→<span>D1 · R2 · KV</span></div>
  <p class="text-muted">SQLite locally, D1 in production. Files in R2 (local disk in dev). Rate limiting in KV with a safe local fallback.</p></section>
  <section class="container-xl py-4"><h2>Pricing</h2>
  <div class="row row-cards">
    ${[['Self-hosted', 'Run it yourself', ['Full source', 'SQLite + local files', 'Community docs'], 'Start free'], ['Cloud', 'We host it for you', ['Managed Workers + D1 + R2', 'White-label onboarding', 'Email support'], 'Contact us'], ['Enterprise', 'For groups & companies', ['SSO & custom integrations', 'SLA & training', 'Flutter app delivery'], 'Contact us']].map(([t, s, pts, ctaBtn]) => `<div class="col-md-4"><div class="card h-100"><div class="card-body text-center"><h3>${t}</h3><p class="text-muted">${s}</p><ul class="list-unstyled text-start">${(pts as string[]).map((p) => `<li>✓ ${p}</li>`).join('')}</ul><a class="btn btn-primary" href="#/contact">${ctaBtn}</a></div></div></div>`).join('')}
  </div><p class="text-muted small mt-2">Illustrative plans — contact us for an actual quote. Final license terms are set by the product owner.</p></section>
  <section class="container-xl py-4"><h2>FAQ</h2>
  ${faqs.map(([q, a]) => `<details class="mb-2"><summary><strong>${q}</strong></summary><p class="text-muted mt-1">${a}</p></details>`).join('')}</section>
  ${cta()}`;
}

function featuresPage(): string {
  const groups: [string, string[]][] = [
    ['Teaching', ['Course builder with sections, lessons and ordering', 'Rich text, video, documents, images, external resources', 'Draft/published lesson states', 'Question management with reordering', 'Quiz shuffle, time limits, attempt limits, expiry handling', 'Manual grading for short answers', 'Assignments with due dates and resubmission rules']],
    ['Tracking', ['Lesson/course/quiz/assignment progress', 'Attendance sessions and percentage reports', 'Grade categories, scores and feedback', 'Organization, completion, quiz-performance and teacher-activity reports']],
    ['Engagement', ['Announcements with notification fan-out', 'Notification center with unread counts and preferences', 'Course discussions with moderation', 'Certificates with public verification']],
    ['Platform', ['REST API under /api/v1 with OpenAPI', 'Installable PWAs with offline shell and safe sync', 'Flutter-ready JSON: pagination, stable IDs, idempotency keys', 'Multi-organization tenant isolation', 'White-label branding per organization', 'Audit logging, CORS, rate limiting, secure uploads']],
  ];
  return `<div class="container-xl py-4"><h1>Features</h1><p class="text-muted">Everything below is implemented and tested — no mock features.</p>
  ${groups.map(([t, items]) => `<h2 class="mt-4">${t}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`).join('')}</div>${cta()}`;
}

function solutionPage(kind: 'solutions' | 'schools' | 'training' | 'corporate'): string {
  const data: Record<string, [string, string, string[]]> = {
    solutions: ['Solutions', 'One platform for every kind of learning organization.', ['K-12 schools: classes, subjects, attendance, parent visibility', 'Training centers: course catalogs, quizzes, certificates', 'Companies: onboarding tracks, compliance records, reports']],
    schools: ['For schools', 'Academic years, terms, classes and subjects — plus parents in the loop.', ['Class rosters and homeroom teachers', 'Attendance per session with excused/absent/late', 'Grades visible to students and linked parents', 'Announcements to the whole organization']],
    training: ['For training centers', 'Sell and deliver courses with proof of completion.', ['Course catalog with visibility controls', 'Quizzes with passing scores and attempt limits', 'Certificates with public verification links', 'Progress reports per student and cohort']],
    corporate: ['For companies', 'Onboard and upskill teams with auditable records.', ['Organization per department or client', 'Role-based access for admins, trainers and staff', 'Audit logs for grades, publishing and certificates', 'API access for HR/HRIS integrations']],
  };
  const [t, s, items] = data[kind];
  return `<div class="container-xl py-4"><h1>${t}</h1><p class="lead text-muted">${s}</p>
  <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
  <div class="row mt-4"><div class="col-md-6">${previewDashboard()}</div><div class="col-md-6">${previewCourse()}</div></div></div>${cta()}`;
}

function pricingPage(): string {
  return `<div class="container-xl py-4"><h1>Pricing</h1><p class="text-muted">Start with a demo organization, upgrade when you grow.</p>
  <div class="row row-cards">
  ${[['Starter', 'For pilots & small academies', ['Up to 3 organizations', 'White-label branding', 'PWA portals', 'Community docs']], ['Growth', 'For schools & training centers', ['Unlimited courses & students*', 'Certificates & verification', 'Reports & audit log', 'Email support']], ['Enterprise', 'For groups & companies', ['Custom domains', 'SSO & integrations', 'SLA & onboarding', 'Flutter app delivery']]].map(([t, s, pts]) => `<div class="col-md-4"><div class="card h-100"><div class="card-body text-center"><h3>${t}</h3><p class="text-muted">${s}</p><ul class="list-unstyled text-start">${(pts as string[]).map((p) => `<li>✓ ${p}</li>`).join('')}</ul><a class="btn btn-primary" href="#/contact">Contact us</a></div></div></div>`).join('')}
  </div><p class="text-muted small mt-3">* Fair-use limits apply on managed hosting. Illustrative plans — request an actual quote. License terms are set by the product owner.</p></div>${cta()}`;
}

function docsPage(): string {
  return `<div class="container-xl py-4"><h1>Documentation</h1>
  <div class="row row-cards">
  ${[['API reference', 'REST /api/v1 with OpenAPI JSON and human docs.', '/api/v1/docs'], ['Local development', 'SQLite + local files, migrate, seed, dev servers.', '#/documentation'], ['Cloudflare deploy', 'Workers + D1 + R2 + KV setup guide.', '#/documentation'], ['Flutter integration', 'Auth, pagination, offline and idempotency patterns.', '#/documentation'], ['White-label', 'Per-organization branding via settings API.', '#/documentation'], ['Multi-organization', 'Tenant model and isolation guarantees.', '#/documentation']].map(([t, x, href]) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3 class="card-title">${t}</h3><p class="text-muted">${x}</p><a href="${href}" class="btn btn-sm btn-outline-primary">Open</a></div></div></div>`).join('')}
  </div>
  <h2 class="mt-4">Quickstart</h2>
  <pre class="card card-body"><code>npm install
npm run db:migrate
npm run db:seed
npm run dev          # API :8787
npm run dev:admin    # Admin :5173</code></pre>
  <h2 class="mt-4">Auth in 30 seconds</h2>
  <pre class="card card-body"><code>POST /api/v1/auth/login {"email","password"}
# → {"access_token","refresh_token"}
GET /api/v1/courses  # Authorization: Bearer &lt;token&gt;</code></pre>
  <p class="text-muted">Full guides live in the repository <code>docs/</code> folder and PRODUCT.md.</p></div>${cta()}`;
}

function aboutPage(): string {
  return `<div class="container-xl py-4"><h1>About</h1>
  <p class="lead text-muted">LMS Headless is an API-first learning management system built for organizations that outgrow spreadsheets and closed SaaS.</p>
  <h2>Principles</h2><ul><li>API-first: every important action is REST.</li><li>Portable: SQLite locally, Cloudflare D1 in production.</li><li>Honest software: no fake metrics, no fake integrations — email and push providers need your own credentials.</li><li>Tested: authentication, authorization, tenant isolation and learning flows are covered by automated tests.</li></ul>
  <h2>Technology</h2><p class="text-muted">TypeScript, Hono, Cloudflare Workers/D1/R2/KV, Tabler UI, Vite PWAs.</p></div>${cta()}`;
}

function contactPage(): string {
  return `<div class="container-xl py-4"><h1>Contact</h1>
  <div class="row"><div class="col-md-6"><div class="card"><div class="card-body"><form id="cform">
  <label class="form-label" for="cn">Name</label><input id="cn" class="form-control mb-2" required>
  <label class="form-label" for="ce">Email</label><input id="ce" type="email" class="form-control mb-2" required>
  <label class="form-label" for="cm">Message</label><textarea id="cm" class="form-control mb-3" rows="5" required></textarea>
  <button class="btn btn-primary">Send via email</button></form>
  <p class="text-muted small mt-2">This opens your email client — no message is stored on our servers from this page.</p></div></div></div>
  <div class="col-md-6"><h2>Portals</h2><ul><li><a href="${PORTALS.admin}">Admin panel</a></li><li><a href="${PORTALS.teacher}">Teacher panel</a></li><li><a href="${PORTALS.student}">Student portal</a></li><li><a href="${PORTALS.parent}">Parent portal</a></li></ul>
  <h2>API</h2><p><a href="/api/v1/docs">API documentation</a> · <a href="/api/v1/openapi.json">OpenAPI JSON</a></p></div></div></div>`;
}

function loginPage(): string {
  return `<div class="container-xl py-5"><div class="row justify-content-center"><div class="col-md-5"><div class="card"><div class="card-body">
  <h1>Sign in</h1><p class="text-muted">Authenticate, then choose your portal.</p>
  <form id="lform"><label class="form-label" for="le">Email</label><input id="le" type="email" class="form-control mb-2" required>
  <label class="form-label" for="lp">Password</label><input id="lp" type="password" class="form-control mb-3" required>
  <div id="lerr"></div><button class="btn btn-primary w-100">Sign in</button></form>
  <div id="roles" class="mt-3"></div>
  <p class="mt-3">No account? <a href="#/register">Register</a> · Demo: student@example.com / Password123!</p></div></div></div></div></div>`;
}

async function verifyPage(num: string): Promise<string> {
  try {
    const res = await fetch(`/api/v1/certificates/verify/${encodeURIComponent(num)}`);
    const j = (await res.json()) as { success: boolean; data?: { certificate: Record<string, string> }; error?: { message: string } };
    if (!j.success || !j.data) return `<div class="container-xl py-5"><div class="alert alert-danger">Certificate not found.</div></div>`;
    const c = j.data.certificate;
    return `<div class="container-xl py-5"><div class="card"><div class="card-body text-center">
      <div class="display-6">🎓</div><h1>Certificate verified</h1>
      <p><strong>${c.student_name}</strong> completed <strong>${c.course_title}</strong></p>
      <p class="text-muted">${c.organization_name} · issued ${c.issued_at?.slice(0, 10) ?? ''}</p>
      <code>${c.certificate_number}</code></div></div></div>`;
  } catch {
    return `<div class="container-xl py-5"><div class="alert alert-danger">Verification service unavailable (API offline?).</div></div>`;
  }
}

function registerPage(): string {
  return `<div class="container-xl py-5"><div class="row justify-content-center"><div class="col-md-5"><div class="card"><div class="card-body">
  <h1>Create account</h1><p class="text-muted">Try the demo organization as a student.</p>
  <form id="rform"><label class="form-label" for="rn">Full name</label><input id="rn" class="form-control mb-2" required>
  <label class="form-label" for="re">Email</label><input id="re" type="email" class="form-control mb-2" required>
  <label class="form-label" for="rp">Password (min 8 chars)</label><input id="rp" type="password" class="form-control mb-3" required minlength="8">
  <div id="rerr"></div><button class="btn btn-primary w-100">Register</button></form>
  <div id="rok" class="mt-3"></div></div></div></div></div></div>`;
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const raw = location.hash.replace('#', '') || '/';
  const [path] = raw.split('?');
  let body = '';
  if (path === '/' || path === '') { body = home(); setMeta('/'); }
  else if (path === '/features') { body = featuresPage(); setMeta('/features'); }
  else if (['/solutions', '/schools', '/training', '/corporate'].includes(path)) { body = solutionPage(path.slice(1) as 'solutions'); setMeta('/'); }
  else if (path === '/pricing') { body = pricingPage(); setMeta('/pricing'); }
  else if (path === '/documentation') { body = docsPage(); setMeta('/'); }
  else if (path === '/about') { body = aboutPage(); setMeta('/'); }
  else if (path === '/contact') { body = contactPage(); setMeta('/'); }
  else if (path === '/login') { body = loginPage(); setMeta('/'); }
  else if (path === '/register') { body = registerPage(); setMeta('/'); }
  else if (path.startsWith('/verify/')) { body = await verifyPage(path.split('/')[2] ?? ''); setMeta('/verify'); }
  else body = `<div class="container-xl py-5"><div class="alert alert-warning">Page not found. <a href="#/">Home</a></div></div>`;
  const isBare = path.startsWith('/verify/');
  app.innerHTML = isBare ? `${header()}${body}${footer()}` : `${header(path)}${body}${footer()}`;
  window.scrollTo(0, 0);

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
      const res = await fetch('/api/v1/auth/login?cookie=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = (await res.json()) as { success: boolean; data?: { access_token: string; user: { memberships: { role: string }[] } }; error?: { message: string } };
      if (!j.success || !j.data) throw new Error(j.error?.message ?? 'Login failed');
      const roles = j.data.user.memberships.map((m) => m.role);
      const primary = roles.includes('organization_admin') || roles.includes('super_admin') ? 'admin' : roles.includes('teacher') ? 'teacher' : roles.includes('parent') ? 'parent' : 'student';
      sessionStorage.setItem('lms-token', j.data.access_token);
      (document.getElementById('roles') as HTMLElement).innerHTML = `<div class="alert alert-success">Signed in as ${roles.join(', ') || 'user'}. <a class="btn btn-sm btn-primary ms-2" href="${PORTALS[primary]}">Open ${primary} portal →</a></div>
        <div class="small text-muted">Your session cookie was set; the portal will pick it up automatically on the same domain.</div>`;
    } catch (err) {
      (document.getElementById('lerr') as HTMLElement).innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : 'Login failed'}</div>`;
    }
  });
  const rform = document.getElementById('rform') as HTMLFormElement | null;
  rform?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: (document.getElementById('re') as HTMLInputElement).value, password: (document.getElementById('rp') as HTMLInputElement).value, name: (document.getElementById('rn') as HTMLInputElement).value }) });
      const j = (await res.json()) as { success: boolean; error?: { message: string } };
      if (!j.success) throw new Error(j.error?.message ?? 'Registration failed');
      (document.getElementById('rok') as HTMLElement).innerHTML = `<div class="alert alert-success">Account created. <a href="${PORTALS.student}">Open the student portal →</a></div>`;
    } catch (err) {
      (document.getElementById('rerr') as HTMLElement).innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : 'Failed'}</div>`;
    }
  });
}

window.addEventListener('hashchange', () => void router());
void router();

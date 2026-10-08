import '@tabler/core/dist/css/tabler.min.css';
import { getDict } from './i18n.js';

const API = '';
let locale: string = localStorage.getItem('admin-locale') ?? 'en';
const dict = () => getDict(locale);

function token(): string | null {
  return localStorage.getItem('lms-token');
}

async function api(path: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...(opts.headers ?? {}) },
  });
  if (res.status === 401 && location.hash !== '#/login') {
    location.hash = '#/login';
    throw new Error('unauthorized');
  }
  const j = (await res.json().catch(() => null)) as { success: boolean; data?: unknown; error?: { message: string } } | null;
  if (!j || !j.success) throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
  return j.data;
}

function layout(title: string, body: string): string {
  const d = dict();
  const nav: [string, string][] = [
    ['#/', d.dashboard],
    ['#/users', d.users],
    ['#/organizations', d.organizations],
    ['#/courses', d.courses],
    ['#/quizzes', d.quizzes],
    ['#/assignments', d.assignments],
    ['#/attendance', d.attendance],
    ['#/certificates', d.certificates],
    ['#/announcements', d.announcements],
    ['#/reports', d.reports],
    ['#/settings', d.settings],
  ];
  return `<div class="page"><header class="navbar navbar-expand-md d-print-none">
    <div class="container-xl"><h1 class="navbar-brand">LMS Admin</h1>
    <div class="ms-auto d-flex gap-2">
      <select id="lang" class="form-select form-select-sm"><option value="en"${locale === 'en' ? ' selected' : ''}>EN</option><option value="id"${locale === 'id' ? ' selected' : ''}>ID</option></select>
      <button id="logout" class="btn btn-sm btn-outline-danger">${d.logout}</button>
    </div></div></header>
  <div class="page-wrapper"><div class="container-xl py-4"><div class="row">
    <aside class="col-md-2 mb-3"><div class="list-group">${nav.map(([h, l]) => `<a class="list-group-item list-group-item-action" href="${h}">${l}</a>`).join('')}</div></aside>
    <main class="col-md-10"><h2 class="mb-3">${title}</h2><div id="view">${body}</div></main>
  </div></div></div></div>`;
}

function table(rows: Record<string, unknown>[], cols: string[]): string {
  if (!rows.length) return `<div class="empty"><p class="empty-title">${dict().empty}</p></div>`;
  return `<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${String(r[c] ?? '').slice(0, 120)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function dashboard(el: HTMLElement): Promise<void> {
  const d = dict();
  el.innerHTML = `<p>${d.loading}</p>`;
  try {
    const orgs = (await api('/api/v1/organizations')) as { id: string }[];
    const orgId = orgs[0]?.id;
    if (!orgId) { el.innerHTML = `<div class="alert alert-info">${d.empty}</div>`; return; }
    const summary = (await api(`/api/v1/reports/organization-summary?organization_id=${orgId}`)) as Record<string, number>;
    el.innerHTML = `<div class="row row-cards">
      ${[[d.students, summary.students], [d.teachers, summary.teachers], [d.courses, summary.courses], [d.enrollments, summary.enrollments], [d.avgProgress, `${Math.round(Number(summary.avg_progress ?? 0))}%`], [d.avgQuiz, Math.round(Number(summary.avg_quiz_score ?? 0))]].map(([l, v]) => `<div class="col-sm-6 col-lg-4"><div class="card"><div class="card-body"><div class="subheader">${l}</div><div class="h1">${v}</div></div></div></div>`).join('')}
    </div>`;
  } catch (e) { el.innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : d.error}</div>`; }
}

async function crudList(el: HTMLElement, title: string, endpoint: string, cols: string[], createFields?: { name: string; label: string }[]): Promise<void> {
  const d = dict();
  el.innerHTML = `<div class="card"><div class="card-header"><input id="q" class="form-control w-auto" placeholder="${d.search}"></div>
    <div class="card-body" id="tbl"><p>${d.loading}</p></div>
    ${createFields ? `<div class="card-footer d-flex gap-2 flex-wrap">${createFields.map((f) => `<input class="form-control w-auto" data-f="${f.name}" placeholder="${f.label}">`).join('')}<button class="btn btn-primary" id="mk">${d.create}</button></div>` : ''}</div>`;
  const load = async () => {
    const q = (document.getElementById('q') as HTMLInputElement | null)?.value ?? '';
    const rows = (await api(`${endpoint}?q=${encodeURIComponent(q)}&per_page=50`)) as Record<string, unknown>[] | { items: Record<string, unknown>[] };
    const list = Array.isArray(rows) ? rows : (rows as { items: Record<string, unknown>[] }).items ?? [];
    (document.getElementById('tbl') as HTMLElement).innerHTML = table(list, cols);
  };
  (document.getElementById('q') as HTMLInputElement | null)?.addEventListener('input', () => void load().catch(() => undefined));
  await load().catch((e: unknown) => { (document.getElementById('tbl') as HTMLElement).innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : d.error}</div>`; });
  void title;
  document.getElementById('mk')?.addEventListener('click', async () => {
    const payload: Record<string, string> = {};
    document.querySelectorAll('[data-f]').forEach((i) => { payload[(i as HTMLInputElement).dataset.f ?? ''] = (i as HTMLInputElement).value; });
    try { await api(endpoint, { method: 'POST', body: JSON.stringify(payload) }); await load(); } catch (e) { alert(e instanceof Error ? e.message : 'error'); }
  });
}

async function loginPage(el: HTMLElement): Promise<void> {
  const d = dict();
  el.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card"><div class="card-body">
    <h2 class="mb-3">${d.login}</h2>
    <input id="email" class="form-control mb-2" placeholder="${d.email}" value="admin@example.com">
    <input id="pw" type="password" class="form-control mb-3" placeholder="${d.password}" value="Password123!">
    <div id="err"></div>
    <button id="go" class="btn btn-primary w-100">${d.login}</button>
    <p class="mt-3 text-muted">Demo: admin@example.com / Password123! (run db:seed first)</p>
  </div></div></div></div>`;
  document.getElementById('go')?.addEventListener('click', async () => {
    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = (document.getElementById('pw') as HTMLInputElement).value;
    try {
      const r = (await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })) as { access_token: string };
      localStorage.setItem('lms-token', r.access_token);
      location.hash = '#/';
    } catch (e) { (document.getElementById('err') as HTMLElement).innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : 'error'}</div>`; }
  });
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login' || !token()) {
    app.innerHTML = `<div class="page"><div class="page-wrapper"><div class="container-xl py-5" id="root"></div></div></div>`;
    await loginPage(document.getElementById('root') as HTMLElement);
    return;
  }
  const d = dict();
  const route = hash.replace('#', '');
  app.innerHTML = layout('', `<p>${d.loading}</p>`);
  (document.getElementById('lang') as HTMLSelectElement).addEventListener('change', (e) => {
    locale = (e.target as HTMLSelectElement).value;
    localStorage.setItem('admin-locale', locale);
    void router();
  });
  document.getElementById('logout')?.addEventListener('click', () => { localStorage.removeItem('lms-token'); location.hash = '#/login'; });
  const view = document.getElementById('view') as HTMLElement;
  const titleEl = document.querySelector('main h2') as HTMLElement;
  try {
    if (route === '/' || route === '') { titleEl.textContent = d.dashboard; await dashboard(view); }
    else if (route.startsWith('/users')) { titleEl.textContent = d.users; await crudList(view, d.users, '/api/v1/users', ['email', 'name', 'status']); }
    else if (route.startsWith('/organizations')) { titleEl.textContent = d.organizations; await crudList(view, d.organizations, '/api/v1/organizations', ['name', 'slug']); }
    else if (route.startsWith('/courses')) { titleEl.textContent = d.courses; await crudList(view, d.courses, '/api/v1/courses', ['code', 'title', 'status']); }
    else if (route.startsWith('/quizzes')) { titleEl.textContent = d.quizzes; view.innerHTML = `<div class="alert alert-info">Open a course to manage quizzes via API. See API docs: <a href="/api/v1/docs">/api/v1/docs</a></div>`; }
    else if (route.startsWith('/assignments')) { titleEl.textContent = d.assignments; view.innerHTML = `<div class="alert alert-info">Manage assignments from course context via API.</div>`; }
    else if (route.startsWith('/attendance')) { titleEl.textContent = d.attendance; view.innerHTML = `<div class="alert alert-info">Record attendance via API: POST /api/v1/attendance/sessions + /records.</div>`; }
    else if (route.startsWith('/certificates')) { titleEl.textContent = d.certificates; view.innerHTML = `<div class="card card-body"><form id="vf" class="d-flex gap-2"><input id="num" class="form-control" placeholder="CERT-..."><button class="btn btn-primary">Verify</button></form><div id="out" class="mt-3"></div></div>`;
      document.getElementById('vf')?.addEventListener('submit', async (e) => { e.preventDefault(); const n = (document.getElementById('num') as HTMLInputElement).value; try { const r = await api(`/api/v1/certificates/verify/${encodeURIComponent(n)}`); (document.getElementById('out') as HTMLElement).textContent = JSON.stringify(r); } catch (err) { (document.getElementById('out') as HTMLElement).textContent = err instanceof Error ? err.message : 'error'; } }); }
    else if (route.startsWith('/announcements')) { titleEl.textContent = d.announcements; view.innerHTML = `<div class="alert alert-info">Use API: GET/POST /api/v1/announcements?organization_id=...</div>`; }
    else if (route.startsWith('/reports')) { titleEl.textContent = d.reports; await dashboard(view); }
    else if (route.startsWith('/settings')) { titleEl.textContent = d.settings; view.innerHTML = `<div class="card card-body">API base: <code>/api/v1</code> · Docs: <a href="/api/v1/docs">/api/v1/docs</a></div>`; }
    else { titleEl.textContent = d.dashboard; await dashboard(view); }
  } catch (e) { view.innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : d.error}</div>`; }
}

window.addEventListener('hashchange', () => void router());
void router();

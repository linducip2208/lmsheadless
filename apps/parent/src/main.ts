import '@tabler/core/dist/css/tabler.min.css';
import { createClient, applyTheme, themeToggleHtml, bindThemeToggles, bindSwUpdates, type ApiClient } from '@lms/ui';

const THEME_KEY = 'parent-theme';
applyTheme(THEME_KEY);
const client: ApiClient = createClient({ orgKey: 'parent-org', loginRedirect: '#/login' });
const { call, login, logout, ensureMe, getMe } = client;

function errHtml(e: unknown): string {
  return `<div class="alert alert-danger">${e instanceof Error ? e.message : 'Error'}</div>`;
}

async function loginPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card"><div class="card-body">
    <h2 class="card-title">LMS Parent</h2><p class="text-muted">Monitor your children's learning. Demo: parent@example.com / Password123!</p>
    <form id="f"><label class="form-label" for="e">Email</label><input id="e" type="email" class="form-control mb-2" required>
    <label class="form-label" for="p">Password</label><input id="p" type="password" class="form-control mb-3" required>
    <div id="err"></div><button class="btn btn-primary w-100">Sign in</button></form></div></div></div></div>`;
  (root.querySelector('#f') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login((root.querySelector('#e') as HTMLInputElement).value, (root.querySelector('#p') as HTMLInputElement).value);
      location.hash = '#/';
    } catch (err) {
      (root.querySelector('#err') as HTMLElement).innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : 'Error'}</div>`;
    }
  });
}

interface Child { id: string; name: string; email: string }

async function childDetail(el: HTMLElement, orgId: string, child: Child): Promise<void> {
  el.innerHTML = '<p>Loading…</p>';
  try {
    const [rep, att, notifs] = await Promise.all([
      call<{ enrollments: { course_title: string; progress_percent: number; course_id: string }[]; grades: { score: number; category: string }[] }>(`/api/v1/reports/student-progress`, {}, { student_id: child.id, organization_id: orgId }),
      call<{ records: { status: string; title: string; session_date: string }[]; attendance_pct: number }>(`/api/v1/attendance/student`, {}, { student_id: child.id, organization_id: orgId }),
      call<{ title: string; body: string }[]>('/api/v1/notifications').catch(() => []),
    ]);
    el.innerHTML = `<a href="#/" class="btn btn-sm btn-outline-secondary mb-2">← All children</a>
      <h2>${child.name}</h2><p class="text-muted">${child.email}</p>
      <div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Course progress</h3></div>
      <div class="card-body">${rep.enrollments.map((x) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${x.course_title}</span><span>${x.progress_percent}%</span></div>
      <div class="progress"><div class="progress-bar" style="width:${x.progress_percent}%"></div></div></div>`).join('') || '<p class="text-muted">No enrollments.</p>'}</div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Grades</h3></div>
      <div class="card-body">${rep.grades.slice(0, 20).map((g) => `<div class="d-flex justify-content-between border-bottom py-1"><span>${g.category}</span><strong>${g.score}</strong></div>`).join('') || '<p class="text-muted">No grades yet.</p>'}</div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Attendance (${att.attendance_pct}%)</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>Session</th><th>Date</th><th>Status</th></tr></thead><tbody>
      ${(att.records as { status: string; title: string; session_date: string }[]).slice(0, 30).map((r) => `<tr><td>${r.title}</td><td>${r.session_date}</td><td><span class="badge ${r.status === 'present' ? 'bg-green' : r.status === 'absent' ? 'bg-red' : 'bg-yellow'}">${r.status}</span></td></tr>`).join('') || '<tr><td colspan="3">No records.</td></tr>'}</tbody></table></div></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Announcements</h3></div>
      <div class="card-body">${(notifs as { title: string; body: string }[]).slice(0, 5).map((n) => `<div class="alert alert-info"><strong>${n.title}</strong><br>${n.body}</div>`).join('') || '<p class="text-muted">None.</p>'}</div></div></div></div>`;
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function home(el: HTMLElement): Promise<void> {
  el.innerHTML = '<p>Loading…</p>';
  try {
    const me = getMe();
    const orgId = me?.memberships[0]?.organization_id;
    if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization membership.</div>'; return; }
    const children = (await call<Child[]>(`/api/v1/users/${me?.id}/linked-students`, {}, { organization_id: orgId })) as Child[];
    if (!children.length) {
      el.innerHTML = '<div class="alert alert-info">No linked students yet. Ask your school administrator to link your children to this account.</div>';
      return;
    }
    el.innerHTML = `<h2>My children</h2><div class="row row-cards">${children.map((c) => `<div class="col-md-6"><div class="card">
      <div class="card-body"><h3 class="card-title">${c.name}</h3><p class="text-muted">${c.email}</p>
      <button class="btn btn-primary" data-child="${c.id}">View progress</button></div></div></div>`).join('')}</div><div id="detail" class="mt-3"></div>`;
    el.querySelectorAll('[data-child]').forEach((b) => b.addEventListener('click', () => {
      const child = children.find((x) => x.id === (b as HTMLElement).dataset.child);
      if (child) void childDetail(el.querySelector('#detail') as HTMLElement, orgId, child);
    }));
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login') { await loginPage(app); return; }
  const me = await ensureMe();
  if (!me) { location.hash = '#/login'; return; }
  app.innerHTML = `<div class="page"><header class="navbar sticky-top bg-white"><div class="container-xl d-flex gap-2 align-items-center">
    <a class="navbar-brand" href="#/">LMS Parent</a>
    <div class="ms-auto d-flex gap-2 align-items-center"><span class="text-muted small">${me.name}</span>${themeToggleHtml(THEME_KEY)}
    <button id="out" class="btn btn-sm btn-outline-danger">Logout</button></div></div></header>
    <div class="page-wrapper"><div class="page-body"><div class="container-xl py-3" id="view"></div></div></div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  (document.getElementById('out') as HTMLButtonElement).addEventListener('click', () => void logout());
  await home(document.getElementById('view') as HTMLElement);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); bindSwUpdates(); });
}
window.addEventListener('hashchange', () => void router());
void router();

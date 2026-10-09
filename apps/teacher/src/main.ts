import '@tabler/core/dist/css/tabler.min.css';
import {
  createClient, applyTheme, themeToggleHtml, bindThemeToggles, bindSwUpdates, onlineIndicatorHtml,
  bindOnlineIndicator, toast, modalForm, type ApiClient,
} from '@lms/ui';
import { getDict } from './i18n.js';
import { banksView, liveView, cohortsView, aiView, exercisesView } from './panels.js';

const THEME_KEY = 'teacher-theme';
applyTheme(THEME_KEY);
const locale = localStorage.getItem('teacher-locale') ?? 'en';
const d = getDict(locale);
const client: ApiClient = createClient({ orgKey: 'teacher-org', loginRedirect: '#/login' });
const { call, login, logout, ensureMe, getMe, currentOrg, setCurrentOrg, myOrgs } = client;

function loading(msg = d.loading): string {
  return `<div class="d-flex align-items-center gap-2 py-4"><div class="spinner-border spinner-border-sm" role="status"></div><span>${msg}</span></div>`;
}
function errHtml(e: unknown): string {
  return `<div class="alert alert-danger" role="alert">${e instanceof Error ? e.message : 'Error'}</div>`;
}

const NAV = [
  { hash: '#/', label: d.dashboard },
  { hash: '#/courses', label: d.myCourses },
  { hash: '#/banks', label: d.banks },
  { hash: '#/grading', label: d.grading },
  { hash: '#/attendance', label: d.attendance },
  { hash: '#/live', label: d.live },
  { hash: '#/cohorts', label: d.cohorts },
  { hash: '#/ai', label: d.ai },
  { hash: '#/exercises', label: d.exercises },
  { hash: '#/students', label: d.students },
  { hash: '#/profile', label: d.profile },
];

async function loginPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card"><div class="card-body">
    <h2 class="card-title">LMS Teacher</h2><p class="text-muted">${d.login} — teacher@example.com / Password123!</p>
    <form id="f"><label class="form-label" for="e">${d.email}</label><input id="e" type="email" class="form-control mb-2" required>
    <label class="form-label" for="p">${d.password}</label><input id="p" type="password" class="form-control mb-3" required>
    <div id="err"></div><button class="btn btn-primary w-100">${d.login}</button></form></div></div></div></div>`;
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

function shell(): void {
  const app = document.getElementById('app') as HTMLElement;
  app.innerHTML = `<div class="page"><aside class="navbar navbar-vertical navbar-expand-lg"><div class="container-fluid">
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#m" aria-label="Menu"><span class="navbar-toggler-icon"></span></button>
    <h1 class="navbar-brand">LMS Teacher</h1>
    <div class="collapse navbar-collapse" id="m"><ul class="navbar-nav pt-lg-3">
    ${NAV.map((n) => `<li class="nav-item"><a class="nav-link" href="${n.hash}"><span class="nav-link-title">${n.label}</span></a></li>`).join('')}
    </ul></div></div></aside>
    <div class="page-wrapper"><header class="navbar sticky-top bg-white"><div class="container-xl d-flex gap-2 align-items-center">
    <h2 class="mb-0" id="title"></h2><div class="ms-auto d-flex gap-2 align-items-center">${onlineIndicatorHtml()}${themeToggleHtml(THEME_KEY)}
    <button id="out" class="btn btn-sm btn-outline-danger">${d.logout}</button></div></div></header>
    <div class="page-body"><div class="container-xl py-3" id="view"></div></div></div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  bindOnlineIndicator();
  (document.getElementById('out') as HTMLButtonElement).addEventListener('click', () => void logout());
}

async function dashboard(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgs = await myOrgs().catch(() => []);
    if (!currentOrg() && orgs[0]) setCurrentOrg(orgs[0].id);
    const orgId = currentOrg();
    const courses = (await call<{ id: string; title: string; code: string }[]>('/api/v1/instructor/courses', {}, orgId ? { organization_id: orgId } : {})) as {
      id: string; title: string; code: string;
    }[];
    const queue = orgId ? (await call<{ submissions: { id: string }[]; attempts: { id: string }[] }>('/api/v1/grading/queue', {}, { organization_id: orgId }).catch(() => ({ submissions: [], attempts: [] }))) as { submissions: { id: string }[]; attempts: { id: string }[] } : { submissions: [], attempts: [] };
    el.innerHTML = `<div class="row row-cards mb-3">
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.myCourses}</div><div class="h1">${courses.length}</div></div></div></div>
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.pending}</div><div class="h1">${queue.submissions.length}</div></div></div></div>
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">Quiz reviews</div><div class="h1">${queue.attempts.length}</div></div></div></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">${d.myCourses}</h3></div>
      <div class="list-group list-group-flush">${courses.map((c) => `<a class="list-group-item list-group-item-action" href="#/courses/${c.id}"><strong>${c.title}</strong><span class="text-muted"> · ${c.code}</span></a>`).join('') || `<div class="list-group-item text-muted">${d.empty}</div>`}</div></div>`;
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function courseDetail(el: HTMLElement, courseId: string): Promise<void> {
  el.innerHTML = loading();
  try {
    const [course, sections, assignments] = await Promise.all([
      call<Record<string, string>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string }[]>(`/api/v1/courses/${courseId}/sections`),
      call<{ id: string; title: string; due_at: string | null }[]>('/api/v1/assignments', {}, { course_id: courseId }).catch(() => []),
    ]);
    el.innerHTML = `<a href="#/courses" class="btn btn-sm btn-outline-secondary mb-2">← ${d.myCourses}</a>
      <h2>${String(course.title)}</h2><p class="text-muted">${String(course.description ?? '')}</p>
      <div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Sections & lessons</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="sec-add">+ Section</button></div>
      <div class="card-body" id="secs">${(sections as { id: string; title: string }[]).map((s) => `<div class="mb-2"><strong>${s.title}</strong> <button class="btn btn-sm btn-outline-green" data-ladd="${s.id}">+ Lesson</button><div data-less="${s.id}" class="mt-1"></div></div>`).join('') || '<p class="text-muted">No sections.</p>'}</div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.upcoming}</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="asg-add">+ Assignment</button></div>
      <div class="list-group list-group-flush">${(assignments as { id: string; title: string; due_at: string | null }[]).map((a) => `<div class="list-group-item">${a.title}<span class="text-muted"> · ${a.due_at ?? 'no due date'}</span></div>`).join('') || '<div class="list-group-item text-muted">None.</div>'}</div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Enrollments</h3></div><div class="card-body" id="enr">Loading…</div></div></div></div>`;
    for (const s of sections as { id: string }[]) {
      const box = el.querySelector(`[data-less="${s.id}"]`) as HTMLElement;
      const lessons = (await call<{ id: string; title: string; content_type: string }[]>(`/api/v1/courses/sections/${s.id}/lessons`).catch(() => [])) as { id: string; title: string; content_type: string }[];
      box.innerHTML = lessons.map((l) => `<div class="small">• ${l.title} <span class="badge bg-blue">${l.content_type}</span></div>`).join('') || '<div class="small text-muted">No lessons.</div>';
    }
    const enrBox = el.querySelector('#enr') as HTMLElement;
    const enr = (await call<{ student_name: string; progress_percent: number }[]>(`/api/v1/courses/${courseId}/enrollments`).catch(() => [])) as { student_name: string; progress_percent: number }[];
    enrBox.innerHTML = enr.length ? enr.map((x) => `<div class="d-flex justify-content-between border-bottom py-1"><span>${x.student_name}</span><span>${x.progress_percent}%</span></div>`).join('') : 'No enrollments yet.';
    (el.querySelector('#sec-add') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Add section', [{ name: 'title', label: 'Title', required: true }]);
      if (!data) return;
      await call(`/api/v1/courses/${courseId}/sections`, { method: 'POST', body: JSON.stringify(data) });
      toast('Added', 'success');
      await courseDetail(el, courseId);
    });
    el.querySelectorAll('[data-ladd]').forEach((b) => b.addEventListener('click', async () => {
      const data = await modalForm('Add lesson', [
        { name: 'title', label: 'Title', required: true },
        { name: 'content_type', label: 'Type', options: ['text', 'video', 'document', 'image', 'external'].map((x) => ({ value: x, label: x })) },
        { name: 'body', label: 'Body', type: 'textarea' },
      ]);
      if (!data) return;
      await call(`/api/v1/courses/sections/${(b as HTMLElement).dataset.ladd}/lessons`, { method: 'POST', body: JSON.stringify(data) });
      toast('Added', 'success');
      await courseDetail(el, courseId);
    }));
    (el.querySelector('#asg-add') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('New assignment', [
        { name: 'title', label: 'Title', required: true },
        { name: 'description', label: 'Instructions', type: 'textarea' },
        { name: 'due_at', label: 'Due date (optional)' },
        { name: 'max_score', label: 'Max score', type: 'number', value: '100' },
      ]);
      if (!data) return;
      await call('/api/v1/assignments', { method: 'POST', body: JSON.stringify({ course_id: courseId, ...data, max_score: Number(data.max_score), due_at: data.due_at || undefined }) });
      toast('Created', 'success');
      await courseDetail(el, courseId);
    });
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function grading(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization.</div>'; return; }
    const q = (await call<{ submissions: { id: string; student_name: string; assignment_title: string; status: string; body: string }[]; attempts: { id: string; student_name: string; quiz_title: string; score: number | null }[] }>('/api/v1/grading/queue', {}, { organization_id: orgId })) as {
      submissions: { id: string; student_name: string; assignment_title: string; status: string; body: string }[];
      attempts: { id: string; student_name: string; quiz_title: string; score: number | null }[];
    };
    el.innerHTML = `<div class="card mb-3"><div class="card-header"><h3 class="card-title">${d.pending} (${q.submissions.length})</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>Student</th><th>Assignment</th><th>Status</th><th></th></tr></thead>
      <tbody>${q.submissions.map((s) => `<tr><td>${s.student_name}</td><td>${s.assignment_title}</td><td><span class="badge bg-yellow">${s.status}</span></td>
      <td><button class="btn btn-sm btn-primary" data-grade="${s.id}">Review & grade</button></td></tr>`).join('') || '<tr><td colspan="4">All caught up.</td></tr>'}</tbody></table></div></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">Recent quiz attempts</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>Student</th><th>Quiz</th><th>Score</th></tr></thead>
      <tbody>${q.attempts.slice(0, 20).map((a) => `<tr><td>${a.student_name}</td><td>${a.quiz_title}</td><td>${a.score ?? '—'}</td></tr>`).join('') || '<tr><td colspan="3">None.</td></tr>'}</tbody></table></div></div></div>`;
    el.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', async () => {
      const id = (b as HTMLElement).dataset.grade ?? '';
      const sub = q.submissions.find((x) => x.id === id);
      const data = await modalForm(`Grade — ${sub?.student_name ?? ''}`, [
        { name: 'info', label: `Submission: ${(sub?.body ?? '').slice(0, 500)}`, type: 'text', value: '' },
        { name: 'score', label: 'Score', type: 'number', required: true },
        { name: 'feedback', label: 'Feedback', type: 'textarea' },
      ]);
      if (!data?.score) return;
      await call(`/api/v1/submissions/${id}/grade`, { method: 'POST', body: JSON.stringify({ score: Number(data.score), feedback: data.feedback || undefined }) });
      toast('Graded', 'success');
      await grading(el);
    }));
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function studentsView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization.</div>'; return; }
    const courses = (await call<{ id: string; title: string }[]>('/api/v1/instructor/courses', {}, { organization_id: orgId })) as { id: string; title: string }[];
    let html = '';
    for (const c of courses) {
      const enr = (await call<{ student_id: string; student_name: string; progress_percent: number }[]>(`/api/v1/courses/${c.id}/enrollments`).catch(() => [])) as { student_id: string; student_name: string; progress_percent: number }[];
      html += `<div class="card mb-3"><div class="card-header"><h3 class="card-title">${c.title} (${enr.length})</h3></div>
        <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>Student</th><th>Progress</th><th></th></tr></thead><tbody>
        ${enr.map((s) => `<tr><td>${s.student_name}</td><td style="min-width:160px"><div class="progress"><div class="progress-bar" style="width:${s.progress_percent}%"></div></div></td>
        <td><button class="btn btn-sm btn-outline-primary" data-prog="${c.id}:${s.student_id}">Detail</button></td></tr>`).join('') || '<tr><td colspan="3">No students.</td></tr>'}</tbody></table></div></div></div><div data-det></div>`;
    }
    el.innerHTML = html || '<div class="alert alert-info">No courses.</div>';
    el.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', async () => {
      const [cid, sid] = ((b as HTMLElement).dataset.prog ?? '').split(':');
      const rep = (await call<{ progress?: { percent: number }; lessons: { title: string; is_completed: number }[] }>(`/api/v1/courses/${cid}/progress`, {}, { student_id: sid })) as {
        progress?: { percent: number }; lessons: { title: string; is_completed: number }[];
      };
      const box = (b as HTMLElement).closest('.card')?.parentElement?.querySelector('[data-det]') as HTMLElement | null;
      if (box) box.innerHTML = `<div class="alert alert-info">Progress ${rep.progress?.percent ?? 0}% — ${rep.lessons.filter((l) => l.is_completed).length}/${rep.lessons.length} lessons done.</div>`;
    }));
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function attendanceView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization.</div>'; return; }
    const courses = (await call<{ id: string; title: string }[]>('/api/v1/instructor/courses', {}, { organization_id: orgId })) as { id: string; title: string }[];
    el.innerHTML = `<div class="card"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
      <div><label class="form-label" for="at-course">Course</label><select id="at-course" class="form-select">${courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('')}</select></div>
      <div><label class="form-label" for="at-title">Session title</label><input id="at-title" class="form-control" value="Pertemuan"></div>
      <div><label class="form-label" for="at-date">Date</label><input id="at-date" type="date" class="form-control" value="${new Date().toISOString().slice(0, 10)}"></div>
      <button class="btn btn-primary" id="at-create">Create session</button></div></div><div id="at-list" class="mt-3"></div>`;
    const load = async () => {
      const box = el.querySelector('#at-list') as HTMLElement;
      const sessions = (await call<{ id: string; title: string; session_date: string; course_id: string | null }[]>('/api/v1/attendance/sessions', {}, { organization_id: orgId })) as {
        id: string; title: string; session_date: string; course_id: string | null;
      }[];
      const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
      box.innerHTML = sessions.filter((s) => !s.course_id || s.course_id === cid).map((s) => `<div class="card mb-2"><div class="card-body d-flex gap-2 align-items-center flex-wrap">
        <div><strong>${s.title}</strong><div class="text-muted small">${s.session_date}</div></div>
        <button class="btn btn-sm btn-primary ms-auto" data-take="${s.id}">Take attendance</button></div>
        <div data-rec="${s.id}"></div></div>`).join('') || '<div class="alert alert-info">No sessions yet.</div>';
    };
    (el.querySelector('#at-create') as HTMLButtonElement).addEventListener('click', async () => {
      const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
      await call('/api/v1/attendance/sessions', { method: 'POST', body: JSON.stringify({ organization_id: orgId, course_id: cid, title: (el.querySelector('#at-title') as HTMLInputElement).value, session_date: (el.querySelector('#at-date') as HTMLInputElement).value }) });
      toast('Session created', 'success');
      await load();
    });
    (el.querySelector('#at-course') as HTMLSelectElement).addEventListener('change', () => void load());
    el.querySelector('#at-list')?.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest('[data-take]') as HTMLElement | null;
      if (!b?.dataset.take) return;
      const sessId = b.dataset.take;
      const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
      const enr = (await call<{ student_id: string; student_name: string }[]>(`/api/v1/courses/${cid}/enrollments`)) as { student_id: string; student_name: string }[];
      const box = el.querySelector(`[data-rec="${sessId}"]`) as HTMLElement;
      box.innerHTML = `<div class="card-body">${enr.map((s) => `<div class="d-flex gap-2 align-items-center mb-1"><span style="min-width:140px">${s.student_name}</span>
        <select class="form-select w-auto" data-s="${s.student_id}">${['present', 'absent', 'late', 'excused'].map((o) => `<option>${o}</option>`).join('')}</select></div>`).join('') || 'No enrolled students.'}
        ${enr.length ? '<button class="btn btn-primary mt-2" id="at-save">Save</button>' : ''}</div>`;
      box.querySelector('#at-save')?.addEventListener('click', async () => {
        const records = enr.map((s) => ({ student_id: s.student_id, status: (box.querySelector(`[data-s="${s.student_id}"]`) as HTMLSelectElement).value }));
        await call('/api/v1/attendance/records', { method: 'POST', body: JSON.stringify({ session_id: sessId, records }) });
        toast(`Recorded ${records.length}`, 'success');
      });
    });
    await load();
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function profile(el: HTMLElement): Promise<void> {
  const me = getMe();
  el.innerHTML = `<div class="card"><div class="card-body"><h3>${me?.name}</h3><p class="text-muted">${me?.email}</p>
    <form id="pw"><label class="form-label">New password (min 8)</label><input type="password" id="npw" class="form-control mb-2" required>
    <label class="form-label">Current password</label><input type="password" id="cpw" class="form-control mb-2" required>
    <button class="btn btn-primary">Change password</button></form></div></div>`;
  (el.querySelector('#pw') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/auth/password/change', { method: 'POST', body: JSON.stringify({ current_password: (el.querySelector('#cpw') as HTMLInputElement).value, new_password: (el.querySelector('#npw') as HTMLInputElement).value }) });
      toast('Password changed', 'success');
    } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
  });
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login') { await loginPage(app); return; }
  const me = await ensureMe();
  if (!me) { location.hash = '#/login'; return; }
  if (!document.getElementById('view')) shell();
  const view = document.getElementById('view') as HTMLElement;
  const route = hash.replace('#', '');
  (document.getElementById('title') as HTMLElement).textContent = NAV.find((n) => n.hash === `#${route}`)?.label ?? d.dashboard;
  try {
    if (route === '/' || route === '') await dashboard(view);
    else if (route === '/courses') {
      const orgId = currentOrg();
      const courses = (await call<{ id: string; title: string; code: string }[]>('/api/v1/instructor/courses', {}, orgId ? { organization_id: orgId } : {})) as { id: string; title: string; code: string }[];
      view.innerHTML = `<div class="row row-cards">${courses.map((c) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3>${c.title}</h3><p class="text-muted">${c.code}</p><a class="btn btn-primary" href="#/courses/${c.id}">Open</a></div></div></div>`).join('')}</div>`;
    } else if (route.startsWith('/courses/')) await courseDetail(view, route.split('/')[2]);
    else if (route.startsWith('/grading')) await grading(view);
    else if (route === '/banks') await banksView(view, client, currentOrg());
    else if (route === '/live') await liveView(view, client, currentOrg());
    else if (route === '/cohorts') await cohortsView(view, client, currentOrg());
    else if (route === '/ai') await aiView(view, client, currentOrg());
    else if (route === '/exercises') await exercisesView(view, client, currentOrg());
    else if (route.startsWith('/attendance')) await attendanceView(view);
    else if (route.startsWith('/students')) await studentsView(view);
    else if (route.startsWith('/profile')) await profile(view);
    else await dashboard(view);
  } catch (e) { view.innerHTML = errHtml(e); }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); bindSwUpdates(); });
}
window.addEventListener('hashchange', () => void router());
void router();

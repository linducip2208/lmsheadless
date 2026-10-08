import '@tabler/core/dist/css/tabler.min.css';
import { getDict } from './i18n.js';

const locale = localStorage.getItem('student-locale') ?? 'en';
const d = getDict(locale);
const token = () => localStorage.getItem('lms-student-token');

async function api(path: string, opts: RequestInit = {}): Promise<unknown> {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...(opts.headers ?? {}) },
  });
  if (res.status === 401 && location.hash !== '#/login') { location.hash = '#/login'; throw new Error('unauthorized'); }
  const j = (await res.json().catch(() => null)) as { success: boolean; data?: unknown; error?: { message: string } } | null;
  if (!j || !j.success) throw new Error(j?.error?.message ?? `failed ${res.status}`);
  return j.data;
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login' || !token()) {
    app.innerHTML = `<div class="page"><div class="container-xl py-5"><div class="row justify-content-center"><div class="col-md-4"><div class="card"><div class="card-body">
      <h2>${d.login}</h2><input id="e" class="form-control mb-2" placeholder="${d.email}" value="student@example.com">
      <input id="p" type="password" class="form-control mb-3" placeholder="${d.password}" value="Password123!">
      <div id="err"></div><button id="go" class="btn btn-primary w-100">${d.login}</button></div></div></div></div></div></div>`;
    document.getElementById('go')?.addEventListener('click', async () => {
      try {
        const r = (await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: (document.getElementById('e') as HTMLInputElement).value, password: (document.getElementById('p') as HTMLInputElement).value }) })) as { access_token: string };
        localStorage.setItem('lms-student-token', r.access_token);
        location.hash = '#/';
      } catch (e) { (document.getElementById('err') as HTMLElement).innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : 'error'}</div>`; }
    });
    return;
  }
  app.innerHTML = `<div class="page"><header class="navbar"><div class="container-xl"><span class="navbar-brand">LMS Student</span>
    <nav class="ms-4 d-flex gap-3"><a href="#/">🏠 ${d.myLearning}</a><a href="#/courses">${d.courses}</a><a href="#/grades">${d.grades}</a><a href="#/profile">${d.profile}</a></nav>
    <button id="out" class="btn btn-sm btn-outline-danger ms-auto">${d.logout}</button></div></header>
    <div class="page-wrapper"><div class="container-xl py-4" id="root"><p>${d.loading}</p></div></div></div>`;
  document.getElementById('out')?.addEventListener('click', () => { localStorage.removeItem('lms-student-token'); location.hash = '#/login'; });
  const root = document.getElementById('root') as HTMLElement;
  try {
    if (hash.startsWith('#/courses/')) {
      const id = hash.split('/')[2];
      const course = (await api(`/api/v1/courses/${id}`)) as { title: string; description: string };
      const sections = (await api(`/api/v1/courses/${id}/sections`)) as { id: string; title: string }[];
      let html = `<h2>${String(course.title)}</h2><p>${String(course.description ?? '')}</p>`;
      for (const s of sections) {
        const lessons = (await api(`/api/v1/courses/sections/${s.id}/lessons`)) as { id: string; title: string }[];
        html += `<div class="card mb-3"><div class="card-header">${s.title}</div><div class="list-group list-group-flush">${lessons.map((l) => `<div class="list-group-item d-flex justify-content-between">${l.title}<button class="btn btn-sm btn-primary" data-lesson="${l.id}">${d.continue}</button></div>`).join('')}</div></div>`;
      }
      const prog = (await api(`/api/v1/courses/${id}/progress`)) as { progress?: { percent: number } };
      html = `<div class="alert alert-info">${d.progress}: ${prog.progress?.percent ?? 0}%</div>` + html;
      root.innerHTML = html;
      root.querySelectorAll('[data-lesson]').forEach((b) => b.addEventListener('click', async () => {
        await api(`/api/v1/lessons/${(b as HTMLElement).dataset.lesson}/complete`, { method: 'POST' });
        void router();
      }));
    } else if (hash.startsWith('#/courses')) {
      const courses = (await api('/api/v1/courses?per_page=50')) as { items?: { id: string; title: string; code: string }[] } | { id: string; title: string; code: string }[];
      const list = Array.isArray(courses) ? courses : (courses.items ?? []);
      root.innerHTML = `<h2>${d.courses}</h2><div class="row row-cards">${list.map((c) => `<div class="col-md-4"><div class="card"><div class="card-body"><h3>${c.title}</h3><p class="text-muted">${c.code}</p><a class="btn btn-primary" href="#/courses/${c.id}">${d.continue}</a></div></div></div>`).join('') || `<p>${d.empty}</p>`}</div>`;
    } else if (hash.startsWith('#/grades')) {
      const rep = (await api('/api/v1/reports/student-progress')) as { enrollments: { course_title: string; progress_percent: number }[]; grades: { score: number; category: string }[] };
      root.innerHTML = `<h2>${d.grades}</h2><div class="card card-body">${rep.grades.map((g) => `<div>${g.category}: <strong>${g.score}</strong></div>`).join('') || `<p>${d.empty}</p>`}</div>
      <h3 class="mt-4">${d.enrolled}</h3>${rep.enrollments.map((e) => `<div class="card card-body mb-2">${e.course_title} — ${e.progress_percent}%</div>`).join('')}`;
    } else if (hash.startsWith('#/profile')) {
      const me = (await api('/api/v1/auth/me')) as { user: { name: string; email: string; memberships: unknown[] } };
      root.innerHTML = `<h2>${d.profile}</h2><div class="card card-body"><p><strong>${me.user.name}</strong><br>${me.user.email}</p></div>`;
    } else {
      const rep = (await api('/api/v1/reports/student-progress')) as { enrollments: { course_title: string; progress_percent: number }[]; grades: { score: number; category: string }[] };
      const notifs = (await api('/api/v1/notifications')) as { title: string; body: string }[];
      root.innerHTML = `<h2>🏠 ${d.myLearning}</h2>
        <h3>${d.enrolled}</h3>${rep.enrollments.map((e) => `<div class="card card-body mb-2">${e.course_title}<div class="progress mt-2"><div class="progress-bar" style="width:${e.progress_percent}%"></div></div></div>`).join('') || `<p>${d.empty}</p>`}
        <h3 class="mt-4">${d.upcoming}</h3><p class="text-muted">${d.empty}</p>
        <h3 class="mt-4">${d.announcements}</h3>${notifs.slice(0, 5).map((n) => `<div class="alert alert-info"><strong>${n.title}</strong><br>${n.body}</div>`).join('')}`;
    }
  } catch (e) { root.innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : 'error'}</div>`; }
}
window.addEventListener('hashchange', () => void router());
void router();

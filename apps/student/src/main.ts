import '@tabler/core/dist/css/tabler.min.css';
import {
  createClient, applyTheme, themeToggleHtml, bindThemeToggles, bindSwUpdates, onlineIndicatorHtml,
  bindOnlineIndicator, flushQueue, enqueueOffline, toast, subscribePush, type ApiClient,
} from '@lms/ui';
import { getDict } from './i18n.js';

const THEME_KEY = 'student-theme';
applyTheme(THEME_KEY);
const locale = localStorage.getItem('student-locale') ?? 'en';
const d = getDict(locale);
const client: ApiClient = createClient({ orgKey: 'student-org', loginRedirect: '#/login' });
const { call, login, logout, ensureMe, getMe, currentOrg, setCurrentOrg, myOrgs } = client;

function errHtml(e: unknown): string {
  return `<div class="alert alert-danger" role="alert">${e instanceof Error ? e.message : 'Error'}</div>`;
}
function loading(msg = d.loading): string {
  return `<div class="d-flex align-items-center gap-2 py-4"><div class="spinner-border spinner-border-sm" role="status"></div><span>${msg}</span></div>`;
}

let deferredPrompt: { prompt: () => void } | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as unknown as { prompt: () => void };
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.remove('d-none');
});

async function loginPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card"><div class="card-body">
    <h2 class="card-title">${d.login}</h2><p class="text-muted">Demo: student@example.com / Password123!</p>
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
  app.innerHTML = `<div class="page"><header class="navbar sticky-top bg-white"><div class="container-xl d-flex gap-2 align-items-center">
    <a class="navbar-brand" href="#/">LMS Student</a>
    <div class="ms-auto d-flex gap-2 align-items-center">${onlineIndicatorHtml()}
    <button id="install-btn" class="btn btn-sm btn-outline-primary d-none">Install app</button>
    ${themeToggleHtml(THEME_KEY)}
    <button id="out" class="btn btn-sm btn-outline-danger">${d.logout}</button></div></div></header>
    <div class="page-wrapper"><div class="page-body"><div class="container-xl py-3 pb-5" id="view"></div></div></div>
    <nav class="navbar fixed-bottom bg-white border-top d-md-none" aria-label="Primary">
      <div class="container d-flex justify-content-around py-1">
      <a href="#/" class="btn btn-sm btn-ghost-primary">🏠<br><small>${d.myLearning}</small></a>
      <a href="#/courses" class="btn btn-sm btn-ghost-primary">📚<br><small>${d.courses}</small></a>
      <a href="#/grades" class="btn btn-sm btn-ghost-primary">⭐<br><small>${d.grades}</small></a>
      <a href="#/more" class="btn btn-sm btn-ghost-primary">⋯<br><small>More</small></a></div></nav></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  bindOnlineIndicator();
  void flushQueue((a, okAction) => toast(okAction ? 'Pending action synced' : 'Will retry when online', okAction ? 'success' : 'warning'));
  (document.getElementById('install-btn') as HTMLButtonElement).addEventListener('click', () => deferredPrompt?.prompt());
  (document.getElementById('out') as HTMLButtonElement).addEventListener('click', () => void logout());
}

async function home(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const [rep, notifs] = await Promise.all([
      call<{ enrollments: { course_title: string; progress_percent: number; course_id: string }[]; grades: { score: number; category: string }[]; quiz_attempts: { quiz_title: string; score: number }[] }>('/api/v1/reports/student-progress'),
      call<{ title: string; body: string }[]>('/api/v1/notifications').catch(() => []),
    ]);
    el.innerHTML = `<h2>🏠 ${d.myLearning}</h2>
      <h3 class="mt-3">${d.enrolled}</h3>
      ${(rep.enrollments as { course_title: string; progress_percent: number; course_id: string }[]).map((x) => `<a href="#/courses/${x.course_id}" class="card card-link mb-2"><div class="card-body"><strong>${x.course_title}</strong>
      <div class="progress mt-2" role="progressbar" aria-valuenow="${x.progress_percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${x.progress_percent}%"></div></div></div></a>`).join('') || `<p class="text-muted">${d.empty}</p>`}
      <h3 class="mt-4">${d.upcoming}</h3><div id="upcoming">${loading('')}</div>
      <h3 class="mt-4">${d.announcements}</h3>
      ${(notifs as { title: string; body: string }[]).slice(0, 5).map((n) => `<div class="alert alert-info"><strong>${n.title}</strong><br>${n.body}</div>`).join('')}`;
    // Upcoming: assignments across enrolled courses.
    const box = el.querySelector('#upcoming') as HTMLElement;
    const items: string[] = [];
    for (const enr of rep.enrollments as { course_id: string; course_title: string }[]) {
      const asg = (await call<{ id: string; title: string; due_at: string | null }[]>('/api/v1/assignments', {}, { course_id: enr.course_id }).catch(() => [])) as { id: string; title: string; due_at: string | null }[];
      for (const a of asg) items.push(`<div class="card card-body mb-2 py-2">${a.title} <span class="text-muted">· ${enr.course_title} · due ${a.due_at ?? '—'}</span> <a class="btn btn-sm btn-outline-primary ms-2" href="#/courses/${enr.course_id}">Open</a></div>`);
    }
    box.innerHTML = items.join('') || `<p class="text-muted">${d.empty}</p>`;
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function courseList(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const res = (await call<unknown>('/api/v1/courses', {}, { per_page: '50' })) as { items?: { id: string; title: string; code: string }[] } | { id: string; title: string; code: string }[];
    const list = (Array.isArray(res) ? res : (res.items ?? [])) as { id: string; title: string; code: string }[];
    el.innerHTML = `<h2>${d.courses}</h2><div class="row row-cards">${list.map((c) => `<div class="col-md-4 col-6"><div class="card h-100">
      <div class="card-body"><h3 class="card-title">${c.title}</h3><p class="text-muted small">${c.code}</p>
      <a class="btn btn-primary btn-sm w-100" href="#/courses/${c.id}">${d.continue}</a></div></div></div>`).join('') || `<p>${d.empty}</p>`}</div>`;
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function courseDetail(el: HTMLElement, courseId: string): Promise<void> {
  el.innerHTML = loading();
  try {
    const [course, sections, prog, quizzes, assignments] = await Promise.all([
      call<Record<string, string>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string }[]>(`/api/v1/courses/${courseId}/sections`),
      call<{ progress?: { percent: number } }>(`/api/v1/courses/${courseId}/progress`).catch(() => ({ progress: { percent: 0 } })),
      call<{ id: string; title: string }[]>('/api/v1/quizzes', {}, { course_id: courseId }).catch(() => []),
      call<{ id: string; title: string; due_at: string | null }[]>('/api/v1/assignments', {}, { course_id: courseId }).catch(() => []),
    ]);
    const tabs = [['learn', 'Learn'], ['quiz', `Quiz (${(quizzes as unknown[]).length})`], ['task', `Tasks (${(assignments as unknown[]).length})`], ['talk', 'Discussion']];
    el.innerHTML = `<a href="#/courses" class="btn btn-sm btn-outline-secondary mb-2">← ${d.courses}</a>
      <h2>${String(course.title)}</h2><p class="text-muted">${String(course.description ?? '')}</p>
      <div class="alert alert-info">${d.progress}: ${(prog.progress as { percent: number } | undefined)?.percent ?? 0}%</div>
      <ul class="nav nav-tabs mb-3" role="tablist">${tabs.map(([k, l], i) => `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? ' active' : ''}" data-t="${k}" role="tab">${l}</button></li>`).join('')}</ul>
      <div id="tab-body"></div>`;
    const body = el.querySelector('#tab-body') as HTMLElement;
    const renderLearn = async () => {
      let html = '';
      for (const s of sections as { id: string; title: string }[]) {
        const lessons = (await call<{ id: string; title: string; content_type: string; body: string | null; video_url: string | null }[]>(`/api/v1/courses/sections/${s.id}/lessons`).catch(() => [])) as {
          id: string; title: string; content_type: string; body: string | null; video_url: string | null;
        }[];
        html += `<div class="card mb-2"><div class="card-header"><h3 class="card-title">${s.title}</h3></div><div class="list-group list-group-flush">`;
        for (const l of lessons) {
          html += `<div class="list-group-item"><div class="d-flex gap-2 align-items-center flex-wrap"><span class="badge bg-blue">${l.content_type}</span><strong>${l.title}</strong>
            <button class="btn btn-sm btn-outline-green ms-auto" data-done="${l.id}">Mark done</button></div>
            ${l.content_type === 'text' && l.body ? `<div class="mt-2">${l.body.slice(0, 2000)}</div>` : ''}
            ${l.video_url ? `<div class="mt-2 ratio ratio-16x9"><video controls preload="none" src="${l.video_url}" class="w-100"></video></div>` : ''}</div>`;
        }
        html += '</div></div>';
      }
      body.innerHTML = html || `<p class="text-muted">${d.empty}</p>`;
      body.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
        const lid = (b as HTMLElement).dataset.done ?? '';
        try {
          if (!navigator.onLine) {
            enqueueOffline('POST', `/api/v1/lessons/${lid}/complete`, {});
            toast('Offline — completion queued, will sync', 'warning');
            return;
          }
          await call(`/api/v1/lessons/${lid}/complete`, { method: 'POST' });
          toast('Lesson completed', 'success');
          await courseDetail(el, courseId);
        } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
      }));
    };
    const renderQuiz = async () => {
      body.innerHTML = (quizzes as { id: string; title: string }[]).map((q) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${q.title}</h3><button class="btn btn-primary btn-sm" data-start="${q.id}">Start attempt</button>
        <div data-att="${q.id}" class="mt-2"></div></div></div>`).join('') || `<p class="text-muted">${d.empty}</p>`;
      body.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
        const qid = (b as HTMLElement).dataset.start ?? '';
        const box = body.querySelector(`[data-att="${qid}"]`) as HTMLElement;
        try {
          const att = (await call<{ id: string; expires_at: string | null }>(`/api/v1/quizzes/${qid}/attempts`, { method: 'POST' })) as { id: string; expires_at: string | null };
          const qs = (await call<{ id: string; type: string; prompt: string; options: { id: string; label: string }[] }[]>(`/api/v1/quizzes/${qid}/questions`)) as {
            id: string; type: string; prompt: string; options: { id: string; label: string }[];
          }[];
          box.innerHTML = `<form id="quiz-form">${att.expires_at ? `<div class="alert alert-warning">Time limit — submit before ${att.expires_at.slice(11, 16)}</div>` : ''}
            ${qs.map((q, i) => `<div class="mb-3"><strong>${i + 1}. ${q.prompt}</strong>
            ${q.type === 'multiple_choice' ? q.options.map((o) => `<label class="form-check"><input type="radio" class="form-check-input" name="q_${q.id}" value="${o.id}">${o.label}</label>`).join('') : `<input class="form-control" name="q_${q.id}" placeholder="Your answer">`}
            </div>`).join('')}
            <button class="btn btn-primary">Submit answers</button></form><div data-res class="mt-2"></div>`;
          (box.querySelector('#quiz-form') as HTMLFormElement).addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target as HTMLFormElement);
            const answers: { question_id: string; option_id?: string; answer_text?: string }[] = [];
            for (const q of qs) {
              const v = fd.get(`q_${q.id}`);
              if (v === null || v === '') continue;
              if (q.type === 'multiple_choice') answers.push({ question_id: q.id, option_id: String(v) });
              else answers.push({ question_id: q.id, answer_text: String(v) });
            }
            try {
              const res = (await call<{ score: number; passed: boolean }>(`/api/v1/quiz-attempts/${att.id}/submit`, {
                method: 'POST', body: JSON.stringify({ answers }), headers: { 'Idempotency-Key': crypto.randomUUID() },
              })) as { score: number; passed: boolean };
              (box.querySelector('[data-res]') as HTMLElement).innerHTML = `<div class="alert ${res.passed ? 'alert-success' : 'alert-warning'}">Score ${res.score} — ${res.passed ? 'Passed 🎉' : 'Not passed yet'}</div>`;
            } catch (err) { toast(err instanceof Error ? err.message : 'Submit failed', 'danger'); }
          });
        } catch (err) { toast(err instanceof Error ? err.message : 'Cannot start', 'danger'); }
      }));
    };
    const renderTasks = async () => {
      body.innerHTML = (assignments as { id: string; title: string; description: string | null; due_at: string | null }[]).map((a) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${a.title}</h3><p class="text-muted">${(a.description ?? '').slice(0, 400)}</p>
        <p class="small">Due: ${a.due_at ?? '—'}</p><div data-sub="${a.id}"></div>
        <form data-sform="${a.id}" class="d-flex gap-2"><input class="form-control" name="body" placeholder="Paste your answer / link…" required>
        <button class="btn btn-primary btn-sm">Submit</button></form></div></div>`).join('') || `<p class="text-muted">${d.empty}</p>`;
      for (const a of assignments as { id: string }[]) {
        const subs = (await call<{ status: string; score: number | null; feedback: string | null }[]>(`/api/v1/assignments/${a.id}/submissions`).catch(() => [])) as {
          status: string; score: number | null; feedback: string | null;
        }[];
        const box = body.querySelector(`[data-sub="${a.id}"]`) as HTMLElement;
        if (subs[0]) box.innerHTML = `<div class="alert ${subs[0].status === 'graded' ? 'alert-success' : 'alert-info'}">Status: ${subs[0].status}${subs[0].score !== null ? ` · Score ${subs[0].score}` : ''}${subs[0].feedback ? ` · ${subs[0].feedback}` : ''}</div>`;
      }
      body.querySelectorAll('[data-sform]').forEach((f) => (f as HTMLFormElement).addEventListener('submit', async (e) => {
        e.preventDefault();
        const aid = (f as HTMLElement).dataset.sform ?? '';
        const text = new FormData(f as HTMLFormElement).get('body');
        try {
          await call(`/api/v1/assignments/${aid}/submissions`, {
            method: 'POST', body: JSON.stringify({ body: String(text) }), headers: { 'Idempotency-Key': crypto.randomUUID() },
          });
          toast('Submitted', 'success');
          await renderTasks();
        } catch (err) { toast(err instanceof Error ? err.message : 'Submit failed', 'danger'); }
      }));
    };
    const renderTalk = async () => {
      const threads = (await call<{ id: string; title: string; body: string }[]>('/api/v1/discussions', {}, { course_id: courseId }).catch(() => [])) as { id: string; title: string; body: string }[];
      body.innerHTML = `<button class="btn btn-primary btn-sm mb-2" id="th-new">New thread</button>
        ${threads.map((t) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${t.title}</h3><p>${t.body.slice(0, 400)}</p>
        <div data-rep="${t.id}"></div><form data-rform="${t.id}" class="d-flex gap-2 mt-2"><input class="form-control" name="body" placeholder="Reply…" required><button class="btn btn-sm btn-outline-primary">Reply</button></form></div></div>`).join('') || `<p class="text-muted">${d.empty}</p>`}`;
      for (const t of threads) {
        const reps = (await call<{ body: string }[]>(`/api/v1/discussions/${t.id}/replies`).catch(() => [])) as { body: string }[];
        (body.querySelector(`[data-rep="${t.id}"]`) as HTMLElement).innerHTML = reps.map((r) => `<div class="alert alert-info py-1 small">${r.body.slice(0, 300)}</div>`).join('');
      }
      (body.querySelector('#th-new') as HTMLButtonElement)?.addEventListener('click', async () => {
        const title = prompt('Thread title:');
        if (!title) return;
        const text = prompt('Message:');
        if (!text) return;
        await call('/api/v1/discussions', { method: 'POST', body: JSON.stringify({ course_id: courseId, title, body: text }) });
        toast('Posted', 'success');
        await renderTalk();
      });
      body.querySelectorAll('[data-rform]').forEach((f) => (f as HTMLFormElement).addEventListener('submit', async (e) => {
        e.preventDefault();
        const tid = (f as HTMLElement).dataset.rform ?? '';
        await call(`/api/v1/discussions/${tid}/replies`, { method: 'POST', body: JSON.stringify({ body: String(new FormData(f as HTMLFormElement).get('body')) }) });
        toast('Replied', 'success');
        await renderTalk();
      }));
    };
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-t]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.t;
      if (tab === 'learn') void renderLearn();
      else if (tab === 'quiz') void renderQuiz();
      else if (tab === 'task') void renderTasks();
      else void renderTalk();
    }));
    await renderLearn();
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function gradesView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const rep = (await call<{ enrollments: { course_title: string; progress_percent: number }[]; grades: { score: number; max_score?: number; category: string }[] }>('/api/v1/reports/student-progress')) as {
      enrollments: { course_title: string; progress_percent: number }[]; grades: { score: number; max_score?: number; category: string }[];
    };
    el.innerHTML = `<h2>${d.grades}</h2><div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table card-table">
      <thead><tr><th>Category</th><th>Score</th></tr></thead><tbody>
      ${rep.grades.map((g) => `<tr><td>${g.category}</td><td><strong>${g.score}</strong></td></tr>`).join('') || '<tr><td colspan="2">No grades yet.</td></tr>'}
      </tbody></table></div></div></div>
      <h3 class="mt-3">Certificates</h3><div id="certs">${loading('')}</div>`;
    const certs = (await call<{ certificate_number: string; issued_at: string }[]>('/api/v1/certificates').catch(() => [])) as { certificate_number: string; issued_at: string }[];
    (el.querySelector('#certs') as HTMLElement).innerHTML = certs.map((c) => `<div class="card card-body mb-2 py-2">🎓 <code>${c.certificate_number}</code> <span class="text-muted">· ${c.issued_at?.slice(0, 10) ?? ''}</span></div>`).join('') || '<p class="text-muted">No certificates yet — finish a course to earn one.</p>';
  } catch (e) { el.innerHTML = errHtml(e); }
}

async function moreView(el: HTMLElement): Promise<void> {
  const orgId = currentOrg() ?? (await myOrgs().then((o) => { if (o[0] && !currentOrg()) setCurrentOrg(o[0].id); return currentOrg(); }).catch(() => null));
  el.innerHTML = loading();
  try {
    const [att, notifs] = await Promise.all([
      orgId ? call<{ records: { status: string; title: string; session_date: string }[]; attendance_pct: number }>(`/api/v1/attendance/student`, {}, { organization_id: orgId }).catch(() => ({ records: [], attendance_pct: 0 })) : Promise.resolve({ records: [], attendance_pct: 0 }),
      call<{ id: string; title: string; body: string; is_read: number }[]>('/api/v1/notifications').catch(() => []),
    ]);
    el.innerHTML = `<h2>More</h2>
      <div class="card mb-3"><div class="card-header"><h3 class="card-title">My attendance (${(att as { attendance_pct: number }).attendance_pct}%)</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>Session</th><th>Date</th><th>Status</th></tr></thead><tbody>
      ${((att as { records: { status: string; title: string; session_date: string }[] }).records).slice(0, 20).map((r) => `<tr><td>${r.title}</td><td>${r.session_date}</td><td><span class="badge ${r.status === 'present' ? 'bg-green' : 'bg-yellow'}">${r.status}</span></td></tr>`).join('') || '<tr><td colspan="3">No records.</td></tr>'}</tbody></table></div></div></div>
      <div class="card mb-3"><div class="card-header"><h3 class="card-title">${d.announcements}</h3></div><div class="card-body">
      ${(notifs as { id: string; title: string; body: string; is_read: number }[]).map((n) => `<div class="alert ${n.is_read ? 'alert-info' : 'alert-success'} py-2"><strong>${n.title}</strong><br>${n.body}</div>`).join('') || '<p class="text-muted">None.</p>'}</div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">${d.profile}</h3></div><div class="card-body">
      <p><strong>${getMe()?.name}</strong><br><span class="text-muted">${getMe()?.email}</span></p>
      <form id="pw"><label class="form-label">New password</label><input type="password" id="npw" class="form-control mb-2" required>
      <label class="form-label">Current password</label><input type="password" id="cpw" class="form-control mb-2" required>
      <button class="btn btn-primary btn-sm">Change password</button></form>
      <div class="mt-2"><button class="btn btn-sm btn-outline-primary" id="push-btn">Enable push notifications</button> <span id="push-st" class="text-muted small"></span></div></div></div>`;
    (el.querySelector('#pw') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call('/api/v1/auth/password/change', { method: 'POST', body: JSON.stringify({ current_password: (el.querySelector('#cpw') as HTMLInputElement).value, new_password: (el.querySelector('#npw') as HTMLInputElement).value }) });
        toast('Password changed', 'success');
      } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
    });
    (el.querySelector('#push-btn') as HTMLButtonElement).addEventListener('click', async () => {
      const r = await subscribePush();
      (el.querySelector('#push-st') as HTMLElement).textContent = r === 'subscribed' ? 'Enabled.' : r === 'no-keys' ? 'Not configured on this server.' : r;
    });
  } catch (e) { el.innerHTML = errHtml(e); }
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
  try {
    if (route === '/' || route === '') await home(view);
    else if (route === '/courses') await courseList(view);
    else if (route.startsWith('/courses/')) await courseDetail(view, route.split('/')[2]);
    else if (route.startsWith('/grades')) await gradesView(view);
    else if (route.startsWith('/more')) await moreView(view);
    else await home(view);
  } catch (e) { view.innerHTML = errHtml(e); }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); bindSwUpdates(); });
}
window.addEventListener('hashchange', () => void router());
void router();

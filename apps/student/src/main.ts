import '@tabler/core/dist/css/tabler.min.css';
import {
  createClient,
  applyTheme,
  themeToggleHtml,
  bindThemeToggles,
  bindSwUpdates,
  onlineIndicatorHtml,
  bindOnlineIndicator,
  flushQueue,
  enqueueOffline,
  toast,
  subscribePush,
  modalForm,
  confirmDialog,
  esc,
  type ApiClient,
} from '@lms/ui';
import { getDict } from './i18n.js';

const THEME_KEY = 'student-theme';
applyTheme(THEME_KEY);
const locale = localStorage.getItem('student-locale') ?? 'en';
const d = getDict(locale);
const client: ApiClient = createClient({ orgKey: 'student-org', loginRedirect: '#/login' });
const { call, login, logout, ensureMe, getMe, currentOrg, setCurrentOrg, myOrgs } = client;

function errHtml(e: unknown): string {
  return `<div class="alert alert-danger" role="alert">${esc(e instanceof Error ? e.message : 'Error')}</div>`;
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
      await login(
        (root.querySelector('#e') as HTMLInputElement).value,
        (root.querySelector('#p') as HTMLInputElement).value
      );
      location.hash = '#/';
    } catch (err) {
      (root.querySelector('#err') as HTMLElement).innerHTML = errHtml(err);
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
      <a href="#/more" class="btn btn-sm btn-ghost-primary">⋯<br><small>${d.more}</small></a></div></nav></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  bindOnlineIndicator();
  void flushQueue((a, okAction) =>
    toast(
      okAction ? 'Pending action synced' : 'Will retry when online',
      okAction ? 'success' : 'warning'
    )
  );
  (document.getElementById('install-btn') as HTMLButtonElement).addEventListener('click', () =>
    deferredPrompt?.prompt()
  );
  (document.getElementById('out') as HTMLButtonElement).addEventListener(
    'click',
    () => void logout()
  );
}

async function home(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const [rep, notifs] = await Promise.all([
      call<{
        enrollments: { course_title: string; progress_percent: number; course_id: string }[];
        grades: { score: number; category: string }[];
        quiz_attempts: { quiz_title: string; score: number }[];
      }>('/api/v1/reports/student-progress'),
      call<{ title: string; body: string }[]>('/api/v1/notifications').catch(() => []),
    ]);
    el.innerHTML = `<h2>🏠 ${d.myLearning}</h2>
      <div class="d-flex gap-1 flex-wrap mb-3">
      <a class="btn btn-sm btn-outline-primary" href="#/shop">🛍 ${d.shop}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/live">📡 ${d.live}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/programs">🗺 ${d.programs}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/tutor">🤖 AI Tutor</a></div>
      <h3 class="mt-3">${d.enrolled}</h3>
      ${
        (rep.enrollments as { course_title: string; progress_percent: number; course_id: string }[])
          .map(
            (
              x
            ) => `<a href="#/courses/${x.course_id}" class="card card-link mb-2"><div class="card-body"><strong>${esc(x.course_title)}</strong>
      <div class="progress mt-2" role="progressbar" aria-valuenow="${Number(x.progress_percent)}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${Number(x.progress_percent)}%"></div></div></div></a>`
          )
          .join('') || `<p class="text-muted">${d.empty}</p>`
      }
      <h3 class="mt-4">${d.upcoming}</h3><div id="upcoming">${loading('')}</div>
      <h3 class="mt-4">${d.announcements}</h3>
      ${(notifs as { title: string; body: string }[])
        .slice(0, 5)
        .map(
          (n) =>
            `<div class="alert alert-info"><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`
        )
        .join('')}`;
    // Upcoming: assignments across enrolled courses.
    const box = el.querySelector('#upcoming') as HTMLElement;
    const items: string[] = [];
    for (const enr of rep.enrollments as { course_id: string; course_title: string }[]) {
      const asg = (await call<{ id: string; title: string; due_at: string | null }[]>(
        '/api/v1/assignments',
        {},
        { course_id: enr.course_id }
      ).catch(() => [])) as { id: string; title: string; due_at: string | null }[];
      for (const a of asg)
        items.push(
          `<div class="card card-body mb-2 py-2">${esc(a.title)} <span class="text-muted">· ${esc(enr.course_title)} · due ${esc(a.due_at ?? '—')}</span> <a class="btn btn-sm btn-outline-primary ms-2" href="#/courses/${enr.course_id}">Open</a></div>`
        );
    }
    box.innerHTML = items.join('') || `<p class="text-muted">${d.empty}</p>`;
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function courseList(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const res = (await call<unknown>('/api/v1/courses', {}, { per_page: '50' })) as
      | { items?: { id: string; title: string; code: string }[] }
      | { id: string; title: string; code: string }[];
    const list = (Array.isArray(res) ? res : (res.items ?? [])) as {
      id: string;
      title: string;
      code: string;
    }[];
    el.innerHTML = `<h2>${d.courses}</h2><div class="row row-cards">${
      list
        .map(
          (c) => `<div class="col-md-4 col-6"><div class="card h-100">
      <div class="card-body"><h3 class="card-title">${esc(c.title)}</h3><p class="text-muted small">${esc(c.code)}</p>
      <a class="btn btn-primary btn-sm w-100" href="#/courses/${c.id}">${d.continue}</a></div></div></div>`
        )
        .join('') || `<p>${d.empty}</p>`
    }</div>`;
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function courseDetail(el: HTMLElement, courseId: string): Promise<void> {
  el.innerHTML = loading();
  try {
    const [course, sections, prog, quizzes, assignments] = await Promise.all([
      call<Record<string, string>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string }[]>(`/api/v1/courses/${courseId}/sections`),
      call<{ progress?: { percent: number } }>(`/api/v1/courses/${courseId}/progress`).catch(
        () => ({ progress: { percent: 0 } })
      ),
      call<{ id: string; title: string }[]>('/api/v1/quizzes', {}, { course_id: courseId }).catch(
        () => []
      ),
      call<{ id: string; title: string; due_at: string | null }[]>(
        '/api/v1/assignments',
        {},
        { course_id: courseId }
      ).catch(() => []),
    ]);
    const scormPkgs = (await call<{ id: string; title: string }[]>(
      `/api/v1/scorm/packages`,
      {},
      { course_id: courseId }
    ).catch(() => [])) as { id: string; title: string }[];
    const tabs = [
      ['learn', d.learn],
      ['quiz', `${d.quiz} (${(quizzes as unknown[]).length})`],
      ['task', `${d.tasks} (${(assignments as unknown[]).length})`],
      ['talk', d.discussion],
      ['scorm', `${d.scorm} (${scormPkgs.length})`],
      ['code', d.exercises],
    ];
    el.innerHTML = `<a href="#/courses" class="btn btn-sm btn-outline-secondary mb-2">← ${d.courses}</a>
      <h2>${esc(course.title)}</h2><p class="text-muted">${esc(course.description ?? '')}</p>
      <div class="alert alert-info">${d.progress}: ${(prog.progress as { percent: number } | undefined)?.percent ?? 0}%</div>
      <ul class="nav nav-tabs mb-3" role="tablist">${tabs.map(([k, l], i) => `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? ' active' : ''}" data-t="${k}" role="tab">${l}</button></li>`).join('')}</ul>
      <div id="tab-body"></div>`;
    const body = el.querySelector('#tab-body') as HTMLElement;
    const renderLearn = async () => {
      let html = '';
      for (const s of sections as { id: string; title: string }[]) {
        const lessons = (await call<
          {
            id: string;
            title: string;
            content_type: string;
            body: string | null;
            video_url: string | null;
          }[]
        >(`/api/v1/courses/sections/${s.id}/lessons`).catch(() => [])) as {
          id: string;
          title: string;
          content_type: string;
          body: string | null;
          video_url: string | null;
        }[];
        html += `<div class="card mb-2"><div class="card-header"><h3 class="card-title">${esc(s.title)}</h3></div><div class="list-group list-group-flush">`;
        for (const l of lessons) {
          html += `<div class="list-group-item"><div class="d-flex gap-2 align-items-center flex-wrap"><span class="badge bg-blue">${esc(l.content_type)}</span><strong>${esc(l.title)}</strong>
            <button class="btn btn-sm btn-outline-green ms-auto" data-done="${l.id}">${d.markDone}</button></div>
            ${l.content_type === 'text' && l.body ? `<div class="mt-2">${esc(l.body.slice(0, 2000))}</div>` : ''}
            ${l.video_url ? `<div class="mt-2 ratio ratio-16x9"><video controls preload="none" src="${esc(l.video_url)}" class="w-100"></video></div>` : ''}</div>`;
        }
        html += '</div></div>';
      }
      body.innerHTML = html || `<p class="text-muted">${d.empty}</p>`;
      body.querySelectorAll('[data-done]').forEach((b) =>
        b.addEventListener('click', async () => {
          const lid = (b as HTMLElement).dataset.done ?? '';
          try {
            if (!navigator.onLine) {
              enqueueOffline('POST', `/api/v1/lessons/${lid}/complete`, {});
              toast(d.offlineQueued, 'warning');
              return;
            }
            await call(`/api/v1/lessons/${lid}/complete`, { method: 'POST' });
            toast(d.lessonCompleted, 'success');
            await courseDetail(el, courseId);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed', 'danger');
          }
        })
      );
    };
    const renderQuiz = async () => {
      body.innerHTML =
        (quizzes as { id: string; title: string }[])
          .map(
            (q) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${esc(q.title)}</h3><button class="btn btn-primary btn-sm" data-start="${q.id}">${d.start}</button>
        <div data-att="${q.id}" class="mt-2"></div></div></div>`
          )
          .join('') || `<p class="text-muted">${d.empty}</p>`;
      body.querySelectorAll('[data-start]').forEach((b) =>
        b.addEventListener('click', async () => {
          const qid = (b as HTMLElement).dataset.start ?? '';
          const box = body.querySelector(`[data-att="${qid}"]`) as HTMLElement;
          try {
            const att = (await call<{ id: string; expires_at: string | null }>(
              `/api/v1/quizzes/${qid}/attempts`,
              { method: 'POST' }
            )) as { id: string; expires_at: string | null };
            const qs = (await call<
              {
                id: string;
                type: string;
                prompt: string;
                options: { id: string; label: string }[];
              }[]
            >(`/api/v1/quizzes/${qid}/questions`)) as {
              id: string;
              type: string;
              prompt: string;
              options: { id: string; label: string }[];
            }[];
            box.innerHTML = `<form id="quiz-form">${att.expires_at ? `<div class="alert alert-warning">${att.expires_at.slice(11, 16)}</div>` : ''}
            ${qs
              .map(
                (
                  q,
                  i
                ) => `<div class="mb-3"><strong>${i + 1}. ${esc(q.prompt)}</strong> <span class="badge bg-secondary">${esc(q.type.replace(/_/g, ' '))}</span>
            ${q.type === 'multiple_choice' || q.type === 'single_choice' ? q.options.map((o) => `<label class="form-check"><input type="radio" class="form-check-input" name="q_${q.id}" value="${o.id}">${esc(o.label)}</label>`).join('') : ''}
            ${q.type === 'matching' ? q.options.map((o) => `<div class="d-flex gap-2 align-items-center mb-1"><span style="min-width:120px">${esc(o.label)}</span><input class="form-control" name="qm_${q.id}_${o.id}" placeholder="${d.answer}"></div>`).join('') : ''}
            ${q.type === 'ordering' ? `<div class="small text-muted mb-1">${d.orderHelp}</div>` + q.options.map((o) => `<div class="d-flex gap-2 align-items-center mb-1"><input type="number" min="1" max="${q.options.length}" class="form-control w-auto" name="qo_${q.id}_${o.id}" placeholder="#"><span>${esc(o.label)}</span></div>`).join('') : ''}
            ${q.type === 'true_false' ? `<select class="form-select" name="q_${q.id}"><option value="">—</option><option value="true">true</option><option value="false">false</option></select>` : ''}
            ${q.type === 'short_answer' || q.type === 'essay' ? `<textarea class="form-control" name="q_${q.id}" rows="${q.type === 'essay' ? 5 : 2}" placeholder="${d.answer}"></textarea>` : ''}
            </div>`
              )
              .join('')}
            <button class="btn btn-primary">${d.submit}</button></form><div data-res class="mt-2"></div>`;
            const form = box.querySelector('#quiz-form') as HTMLFormElement;
            // Autosave: restore any draft saved before an interruption, then
            // persist edits debounced. Drafts live server-side per attempt.
            const collectDraft = (): { question_id: string; payload: string }[] => {
              const fdata = new FormData(form);
              const out: { question_id: string; payload: string }[] = [];
              for (const q of qs) {
                if (q.type === 'multiple_choice' || q.type === 'single_choice') {
                  const v = fdata.get(`q_${q.id}`);
                  if (v)
                    out.push({
                      question_id: q.id,
                      payload: JSON.stringify({ option_id: String(v) }),
                    });
                } else if (q.type === 'matching') {
                  const pairs: Record<string, string> = {};
                  for (const o of q.options) {
                    const v = fdata.get(`qm_${q.id}_${o.id}`);
                    if (typeof v === 'string' && v !== '') pairs[o.id] = v;
                  }
                  if (Object.keys(pairs).length)
                    out.push({ question_id: q.id, payload: JSON.stringify({ pairs }) });
                } else if (q.type === 'ordering') {
                  const ranks: Record<string, number> = {};
                  for (const o of q.options) {
                    const v = Number(fdata.get(`qo_${q.id}_${o.id}`));
                    if (Number.isFinite(v) && v >= 1) ranks[o.id] = v;
                  }
                  if (Object.keys(ranks).length)
                    out.push({ question_id: q.id, payload: JSON.stringify({ ranks }) });
                } else {
                  const v = fdata.get(`q_${q.id}`);
                  if (v !== null && v !== '')
                    out.push({ question_id: q.id, payload: JSON.stringify({ text: String(v) }) });
                }
              }
              return out;
            };
            const applyDraft = (drafts: { question_id: string; payload: string }[]) => {
              for (const dr of drafts) {
                let p: Record<string, unknown> = {};
                try {
                  p = JSON.parse(dr.payload) as Record<string, unknown>;
                } catch {
                  continue;
                }
                const q = qs.find((x) => x.id === dr.question_id);
                if (!q) continue;
                if (typeof p.option_id === 'string') {
                  const input = form.querySelector(
                    `input[name="q_${q.id}"][value="${p.option_id}"]`
                  ) as HTMLInputElement | null;
                  if (input) input.checked = true;
                }
                if (p.pairs && typeof p.pairs === 'object') {
                  for (const [oid, val] of Object.entries(p.pairs as Record<string, string>)) {
                    const input = form.querySelector(
                      `input[name="qm_${q.id}_${oid}"]`
                    ) as HTMLInputElement | null;
                    if (input) input.value = val;
                  }
                }
                if (p.ranks && typeof p.ranks === 'object') {
                  for (const [oid, val] of Object.entries(p.ranks as Record<string, number>)) {
                    const input = form.querySelector(
                      `input[name="qo_${q.id}_${oid}"]`
                    ) as HTMLInputElement | null;
                    if (input) input.value = String(val);
                  }
                }
                if (typeof p.text === 'string') {
                  const field = form.querySelector(`[name="q_${q.id}"]`) as
                    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                  if (field) field.value = p.text;
                }
              }
            };
            try {
              const saved = (await call<{ question_id: string; payload: string }[]>(
                `/api/v1/quiz-attempts/${att.id}/autosave`
              ).catch(() => [])) as { question_id: string; payload: string }[];
              if (saved.length) {
                applyDraft(saved);
                toast(d.draftRestored, 'info');
              }
            } catch {
              /* drafts are best-effort; the attempt itself still works */
            }
            let saveTimer: ReturnType<typeof setTimeout> | null = null;
            form.addEventListener('input', () => {
              if (saveTimer) clearTimeout(saveTimer);
              saveTimer = setTimeout(() => {
                void call(`/api/v1/quiz-attempts/${att.id}/autosave`, {
                  method: 'PUT',
                  body: JSON.stringify({ answers: collectDraft() }),
                }).catch(() => undefined);
              }, 1500);
            });
            (box.querySelector('#quiz-form') as HTMLFormElement).addEventListener(
              'submit',
              async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target as HTMLFormElement);
                const answers: { question_id: string; option_id?: string; answer_text?: string }[] =
                  [];
                for (const q of qs) {
                  if (q.type === 'multiple_choice' || q.type === 'single_choice') {
                    const v = fd.get(`q_${q.id}`);
                    if (v) answers.push({ question_id: q.id, option_id: String(v) });
                  } else if (q.type === 'matching') {
                    const pairs: Record<string, string> = {};
                    for (const o of q.options) {
                      const v = fd.get(`qm_${q.id}_${o.id}`);
                      if (typeof v === 'string' && v !== '') pairs[o.id] = v;
                    }
                    if (Object.keys(pairs).length)
                      answers.push({ question_id: q.id, answer_text: JSON.stringify({ pairs }) });
                  } else if (q.type === 'ordering') {
                    const ranked: { id: string; rank: number }[] = [];
                    for (const o of q.options) {
                      const v = Number(fd.get(`qo_${q.id}_${o.id}`));
                      if (Number.isFinite(v) && v >= 1) ranked.push({ id: o.id, rank: v });
                    }
                    if (ranked.length) {
                      ranked.sort((a, b) => a.rank - b.rank);
                      answers.push({
                        question_id: q.id,
                        answer_text: JSON.stringify({ order: ranked.map((r) => r.id) }),
                      });
                    }
                  } else {
                    const v = fd.get(`q_${q.id}`);
                    if (v === null || v === '') continue;
                    answers.push({ question_id: q.id, answer_text: String(v) });
                  }
                }
                try {
                  const res = (await call<{
                    score?: number;
                    passed?: boolean;
                    needs_review?: boolean;
                  }>(`/api/v1/quiz-attempts/${att.id}/submit`, {
                    method: 'POST',
                    body: JSON.stringify({ answers }),
                    headers: { 'Idempotency-Key': crypto.randomUUID() },
                  })) as { score?: number; passed?: boolean; needs_review?: boolean };
                  (box.querySelector('[data-res]') as HTMLElement).innerHTML =
                    res.score === undefined
                      ? `<div class="alert alert-info">${d.submittedReview}</div>`
                      : `<div class="alert ${res.passed ? 'alert-success' : 'alert-warning'}">${d.score} ${res.score} — ${res.passed ? d.passed : d.notPassed}</div>`;
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Submit failed', 'danger');
                }
              }
            );
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Cannot start', 'danger');
          }
        })
      );
    };
    const renderTasks = async () => {
      body.innerHTML =
        (
          assignments as {
            id: string;
            title: string;
            description: string | null;
            due_at: string | null;
          }[]
        )
          .map(
            (a) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${esc(a.title)}</h3><p class="text-muted">${esc((a.description ?? '').slice(0, 400))}</p>
        <p class="small">${d.date}: ${esc(a.due_at ?? '—')}</p><div data-sub="${a.id}"></div>
        <form data-sform="${a.id}" class="d-flex gap-2"><input class="form-control" name="body" placeholder="${d.answer}" required>
        <button class="btn btn-primary btn-sm">${d.submit}</button></form></div></div>`
          )
          .join('') || `<p class="text-muted">${d.empty}</p>`;
      for (const a of assignments as { id: string }[]) {
        const subs = (await call<
          { status: string; score: number | null; feedback: string | null }[]
        >(`/api/v1/assignments/${a.id}/submissions`).catch(() => [])) as {
          status: string;
          score: number | null;
          feedback: string | null;
        }[];
        const box = body.querySelector(`[data-sub="${a.id}"]`) as HTMLElement;
        if (subs[0])
          box.innerHTML = `<div class="alert ${subs[0].status === 'graded' ? 'alert-success' : 'alert-info'}">${d.status}: ${esc(subs[0].status)}${subs[0].score !== null ? ` · ${d.score} ${Number(subs[0].score)}` : ''}${subs[0].feedback ? ` · ${esc(subs[0].feedback)}` : ''}</div>`;
      }
      body.querySelectorAll('[data-sform]').forEach((f) =>
        (f as HTMLFormElement).addEventListener('submit', async (e) => {
          e.preventDefault();
          const aid = (f as HTMLElement).dataset.sform ?? '';
          const text = new FormData(f as HTMLFormElement).get('body');
          try {
            await call(`/api/v1/assignments/${aid}/submissions`, {
              method: 'POST',
              body: JSON.stringify({ body: String(text) }),
              headers: { 'Idempotency-Key': crypto.randomUUID() },
            });
            toast(d.quizSubmitted, 'success');
            await renderTasks();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed', 'danger');
          }
        })
      );
    };
    const renderTalk = async () => {
      const threads = (await call<{ id: string; title: string; body: string }[]>(
        '/api/v1/discussions',
        {},
        { course_id: courseId }
      ).catch(() => [])) as { id: string; title: string; body: string }[];
      body.innerHTML = `<button class="btn btn-primary btn-sm mb-2" id="th-new">${d.newThread}</button>
        ${
          threads
            .map(
              (
                x
              ) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${esc(x.title)}</h3><p>${esc(x.body.slice(0, 400))}</p>
        <div data-rep="${x.id}"></div><form data-rform="${x.id}" class="d-flex gap-2 mt-2"><input class="form-control" name="body" placeholder="${d.reply}…" required><button class="btn btn-sm btn-outline-primary">${d.reply}</button></form></div></div>`
            )
            .join('') || `<p class="text-muted">${d.empty}</p>`
        }`;
      for (const t of threads) {
        const reps = (await call<{ body: string }[]>(`/api/v1/discussions/${t.id}/replies`).catch(
          () => []
        )) as { body: string }[];
        (body.querySelector(`[data-rep="${t.id}"]`) as HTMLElement).innerHTML = reps
          .map((r) => `<div class="alert alert-info py-1 small">${esc(r.body.slice(0, 300))}</div>`)
          .join('');
      }
      (body.querySelector('#th-new') as HTMLButtonElement)?.addEventListener('click', async () => {
        try {
          const data = await modalForm(d.newThread, [
            { name: 'title', label: d.threadTitle, required: true },
            { name: 'body', label: d.answer, type: 'textarea', required: true },
          ]);
          if (!data) return;
          await call('/api/v1/discussions', {
            method: 'POST',
            body: JSON.stringify({ course_id: courseId, title: data.title, body: data.body }),
          });
          toast(d.quizSubmitted, 'success');
          await renderTalk();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      });
      body.querySelectorAll('[data-rform]').forEach((f) =>
        (f as HTMLFormElement).addEventListener('submit', async (e) => {
          e.preventDefault();
          const tid = (f as HTMLElement).dataset.rform ?? '';
          try {
            await call(`/api/v1/discussions/${tid}/replies`, {
              method: 'POST',
              body: JSON.stringify({
                body: String(new FormData(f as HTMLFormElement).get('body')),
              }),
            });
            toast(d.quizSubmitted, 'success');
            await renderTalk();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed', 'danger');
          }
        })
      );
    };
    el.querySelectorAll('[data-t]').forEach((b) =>
      b.addEventListener('click', () => {
        el.querySelectorAll('[data-t]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const tab = (b as HTMLElement).dataset.t;
        if (tab === 'learn') void renderLearn();
        else if (tab === 'quiz') void renderQuiz();
        else if (tab === 'task') void renderTasks();
        else if (tab === 'scorm') {
          body.innerHTML =
            scormPkgs
              .map(
                (p) =>
                  `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${p.title}</h3><a class="btn btn-sm btn-primary" href="#/scorm/${p.id}">${d.launch}</a></div></div>`
              )
              .join('') || `<p class="text-muted">${d.empty}</p>`;
        } else if (tab === 'code') void exercisesView(body, courseId);
        else void renderTalk();
      })
    );
    await renderLearn();
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function gradesView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const rep = (await call<{
      enrollments: { course_title: string; progress_percent: number }[];
      grades: { score: number; max_score?: number; category: string }[];
    }>('/api/v1/reports/student-progress')) as {
      enrollments: { course_title: string; progress_percent: number }[];
      grades: { score: number; max_score?: number; category: string }[];
    };
    el.innerHTML = `<h2>${d.grades}</h2><div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table card-table">
      <thead><tr><th>${d.category}</th><th>${d.score}</th></tr></thead><tbody>
      ${rep.grades.map((g) => `<tr><td>${esc(g.category)}</td><td><strong>${Number(g.score)}</strong></td></tr>`).join('') || `<tr><td colspan="2">${d.empty}</td></tr>`}
      </tbody></table></div></div></div>
      <h3 class="mt-3">${d.certificates}</h3><div id="certs">${loading('')}</div>`;
    const certs = (await call<{ certificate_number: string; issued_at: string }[]>(
      '/api/v1/certificates'
    ).catch(() => [])) as { certificate_number: string; issued_at: string }[];
    (el.querySelector('#certs') as HTMLElement).innerHTML =
      certs
        .map(
          (c) =>
            `<div class="card card-body mb-2 py-2">🎓 <code>${esc(c.certificate_number)}</code> <span class="text-muted">· ${esc(c.issued_at?.slice(0, 10) ?? '')}</span></div>`
        )
        .join('') || `<p class="text-muted">${d.noCertificates}</p>`;
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function shopView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    const [courses, bundles, orders] = await Promise.all([
      call<{ id: string; title: string; code: string; price: number }[]>(
        '/api/v1/catalog/courses'
      ).catch(() => []),
      call<{ id: string; name: string; price: number }[]>('/api/v1/catalog/bundles').catch(
        () => []
      ),
      call<{ id: string; kind: string; total: number; status: string }[]>('/api/v1/orders').catch(
        () => []
      ),
    ]);
    const plans = orgId
      ? ((await call<{ id: string; name: string; price: number; interval: string }[]>(
          '/api/v1/subscription-plans',
          {},
          { organization_id: orgId }
        ).catch(() => [])) as { id: string; name: string; price: number; interval: string }[])
      : [];
    el.innerHTML = `<h2>🛍 ${d.shop}</h2>
      <h3>${d.courses}</h3><div class="row row-cards">${
        (courses as { id: string; title: string; code: string; price: number }[])
          .map(
            (c) => `<div class="col-md-4 col-6"><div class="card h-100"><div class="card-body">
      <h3 class="card-title">${esc(c.title)}</h3><p class="text-muted small">${esc(c.code)} · ${c.price > 0 ? Number(c.price) : d.free}</p>
      <div class="d-flex gap-1"><a class="btn btn-sm btn-outline-primary" href="#/courses/${c.id}">${d.continue}</a>
      ${c.price > 0 ? `<button class="btn btn-sm btn-primary" data-buy="course:${c.id}">${d.buy}</button>` : `<button class="btn btn-sm btn-primary" data-enroll="${c.id}">${d.enroll}</button>`}</div></div></div></div>`
          )
          .join('') || `<p>${d.empty}</p>`
      }</div>
      <h3 class="mt-3">${d.bundles}</h3><div class="row row-cards">${
        (bundles as { id: string; name: string; price: number }[])
          .map(
            (b) => `<div class="col-md-4 col-6"><div class="card h-100"><div class="card-body">
      <h3 class="card-title">${esc(b.name)}</h3><p class="text-muted">${Number(b.price)}</p>
      <button class="btn btn-sm btn-primary" data-buy="bundle:${b.id}">${d.buy}</button></div></div></div>`
          )
          .join('') || `<p>${d.empty}</p>`
      }</div>
      <h3 class="mt-3">${d.orders}</h3>    <div id="ord">${(orders as { id: string; kind: string; total: number; status: string }[]).map((o) => `<div class="card card-body mb-2 py-2">${esc(o.kind)} · ${Number(o.total)} · <span class="badge ${o.status === 'paid' ? 'bg-green' : 'bg-yellow'}">${esc(o.status)}</span>${o.status === 'pending' ? `<div class="small text-muted">${d.pendingPayment}</div>` : ''}${o.status === 'paid' ? ` <button class="btn btn-sm btn-outline-primary ms-2" data-inv="${o.id}">${d.invoice}</button>` : ''}<div data-invbox="${o.id}"></div></div>`).join('') || `<p>${d.empty}</p>`}</div>
      ${
        plans.length
          ? `<h3 class="mt-3">${d.plans}</h3><div class="row row-cards">${plans
              .map(
                (p) => `<div class="col-md-4 col-6"><div class="card h-100"><div class="card-body">
      <h3 class="card-title">${esc(p.name)}</h3><p class="text-muted small">${Number(p.price)}/${esc(p.interval)}</p>
      <button class="btn btn-sm btn-primary" data-plan="${p.id}">${d.buy}</button></div></div></div>`
              )
              .join('')}</div>`
          : ''
      }
      <div class="card mt-3"><div class="card-body"><form id="gift-f" class="d-flex gap-2">
      <input id="gift-code" class="form-control" placeholder="Gift code" required><button class="btn btn-outline-primary">${d.redeem}</button></form></div></div>`;
    el.querySelectorAll('[data-enroll]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await call('/api/v1/enrollments', {
            method: 'POST',
            body: JSON.stringify({ course_id: (b as HTMLElement).dataset.enroll }),
          });
          toast(d.enrolled2, 'success');
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
    el.querySelectorAll('[data-plan]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const r = (await call<{ id: string; status: string; note?: string }>(
            '/api/v1/subscriptions',
            { method: 'POST', body: JSON.stringify({ plan_id: (b as HTMLElement).dataset.plan }) }
          )) as { id: string; status: string; note?: string };
          toast(
            `${r.status}${r.note ? ` — ${r.note}` : ''}`,
            r.status === 'active' ? 'success' : 'info'
          );
          await shopView(el);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
    el.querySelectorAll('[data-buy]').forEach((b) =>
      b.addEventListener('click', async () => {
        const [kind, ref] = ((b as HTMLElement).dataset.buy ?? '').split(':');
        try {
          const coupon = await modalForm(d.buy, [{ name: 'coupon_code', label: d.couponCode }]);
          if (!coupon) return;
          const code = String(coupon.coupon_code || '').trim() || undefined;
          const r = (await call<{ id: string; total: number; status: string }>('/api/v1/orders', {
            method: 'POST',
            body: JSON.stringify({
              organization_id: currentOrg() ?? undefined,
              kind,
              reference_id: ref,
              ...(code ? { coupon_code: code } : {}),
            }),
          })) as { id: string; total: number; status: string };
          if (r.status === 'paid') {
            toast(d.enrolled2, 'success');
            await shopView(el);
            return;
          }
          const claim = await confirmDialog(d.pendingPayment, `${d.total}: ${r.total}`, d.confirm);
          if (claim) {
            await call(`/api/v1/orders/${r.id}/payments/manual`, {
              method: 'POST',
              body: JSON.stringify({}),
            });
            toast(d.pendingPayment, 'info');
            await shopView(el);
          }
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
    (el.querySelector('#gift-f') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call('/api/v1/gifts/redeem', {
          method: 'POST',
          body: JSON.stringify({
            code: (el.querySelector('#gift-code') as HTMLInputElement).value,
          }),
        });
        toast(d.enrolled2, 'success');
        await shopView(el);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    el.querySelectorAll('[data-inv]').forEach((b) =>
      b.addEventListener('click', async () => {
        const oid = (b as HTMLElement).dataset.inv ?? '';
        const box = el.querySelector(`[data-invbox="${oid}"]`) as HTMLElement;
        try {
          const inv = (await call<Record<string, unknown>>(`/api/v1/invoices/order/${oid}`)) as {
            number: string;
            total: number;
            issued_at: string;
            lines: string;
          };
          const lines = (JSON.parse(inv.lines) as { title: string; amount: number }[]) ?? [];
          box.innerHTML = `<div class="alert alert-info mt-1"><strong>${d.invoice} ${esc(inv.number)}</strong> — ${Number(inv.total)} · ${esc(String(inv.issued_at).slice(0, 10))}<br>${lines.map((l) => `${esc(l.title)}: ${Number(l.amount)}`).join('<br>')}</div>`;
        } catch (err) {
          box.innerHTML = `<div class="alert alert-danger">${esc(err instanceof Error ? err.message : 'Failed')}</div>`;
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function liveView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    const items = (await call<
      { id: string; title: string; starts_at: string; meeting_url: string | null }[]
    >(
      '/api/v1/live-sessions',
      {},
      orgId ? { organization_id: orgId, upcoming: '1' } : { upcoming: '1' }
    ).catch(() => [])) as {
      id: string;
      title: string;
      starts_at: string;
      meeting_url: string | null;
    }[];
    el.innerHTML = `<h2>📡 ${d.live}</h2>${
      items
        .map(
          (s) => `<div class="card mb-2"><div class="card-body">
      <h3 class="card-title">${esc(s.title)}</h3><p class="text-muted">${esc(s.starts_at?.slice(0, 16).replace('T', ' ') ?? '')}</p>
      <div class="d-flex gap-1"><button class="btn btn-sm btn-primary" data-reg="${s.id}">${d.register2}</button>
      ${s.meeting_url ? `<a class="btn btn-sm btn-outline-primary" href="${esc(s.meeting_url)}" target="_blank" rel="noopener">${d.launch}</a>` : ''}</div></div></div>`
        )
        .join('') || `<p>${d.empty}</p>`
    }`;
    el.querySelectorAll('[data-reg]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await call(`/api/v1/live-sessions/${(b as HTMLElement).dataset.reg}/register`, {
            method: 'POST',
            body: '{}',
          });
          toast(d.registered, 'success');
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function programsView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    const programs = (await call<{ id: string; name: string }[]>(
      '/api/v1/programs',
      {},
      orgId ? { organization_id: orgId } : {}
    ).catch(() => [])) as { id: string; name: string }[];
    el.innerHTML = `<h2>🗺 ${d.programs}</h2>${
      programs
        .map(
          (p) => `<div class="card mb-2"><div class="card-body">
      <h3 class="card-title">${esc(p.name)}</h3><button class="btn btn-sm btn-outline-primary" data-prog="${p.id}">${d.continue}</button>
      <div data-pd="${p.id}" class="mt-2"></div></div></div>`
        )
        .join('') || `<p>${d.empty}</p>`
    }`;
    el.querySelectorAll('[data-prog]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = (b as HTMLElement).dataset.prog ?? '';
        try {
          const det = (await call<{
            courses: {
              course_id: string;
              course_title: string;
              locked: boolean;
              enrollment_status: string | null;
            }[];
          }>(`/api/v1/programs/${id}`)) as {
            courses: {
              course_id: string;
              course_title: string;
              locked: boolean;
              enrollment_status: string | null;
            }[];
          };
          (el.querySelector(`[data-pd="${id}"]`) as HTMLElement).innerHTML = `<ol>${det.courses
            .map(
              (x) => `<li>${esc(x.course_title)}
          ${x.locked ? `<span class="badge bg-red">${d.locked}</span>` : x.enrollment_status ? `<span class="badge bg-green">${esc(x.enrollment_status)}</span>` : `<button class="btn btn-sm btn-primary" data-penroll="${x.course_id}">${d.enroll}</button>`}</li>`
            )
            .join('')}</ol>`;
          el.querySelectorAll('[data-penroll]').forEach((bb) =>
            bb.addEventListener('click', async () => {
              try {
                await call('/api/v1/enrollments', {
                  method: 'POST',
                  body: JSON.stringify({ course_id: (bb as HTMLElement).dataset.penroll }),
                });
                toast(d.enrolled2, 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Failed', 'danger');
              }
            })
          );
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function scormPlayer(el: HTMLElement, pkgId: string): Promise<void> {
  el.innerHTML = loading();
  try {
    const att = (await call<{ id: string; resumed: boolean }>(`/api/v1/scorm/attempts`, {
      method: 'POST',
      body: JSON.stringify({ package_id: pkgId }),
    })) as { id: string; resumed: boolean };
    el.innerHTML = `<button id="sc-back" class="btn btn-sm btn-outline-secondary mb-2">←</button>
      <div class="ratio ratio-16x9 mb-2"><iframe title="SCORM content" sandbox="allow-scripts" src="/api/v1/scorm/content/${pkgId}/index.html" class="w-100 border rounded"></iframe></div>
      <div class="alert alert-info">${d.sandboxNote}</div>
      <div class="d-flex gap-2">
      <button class="btn btn-outline-primary" id="sc-bm">${d.bookmark}</button>
      <button class="btn btn-primary" id="sc-done">${d.markSynced}</button></div><div id="sc-out" class="mt-2"></div>`;
    (el.querySelector('#sc-back') as HTMLButtonElement).addEventListener('click', () =>
      history.back()
    );
    (el.querySelector('#sc-bm') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        const data = await modalForm(d.bookmark, [{ name: 'location', label: d.bookmarkHint }]);
        if (!data) return;
        await call(`/api/v1/scorm/attempts/${att.id}/commit`, {
          method: 'POST',
          body: JSON.stringify({ location: String(data.location ?? '') }),
        });
        toast(d.bookmark, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    (el.querySelector('#sc-done') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        await call(`/api/v1/scorm/attempts/${att.id}/commit`, {
          method: 'POST',
          body: JSON.stringify({ completion: 'completed', success: 'passed' }),
        });
        (el.querySelector('#sc-out') as HTMLElement).innerHTML =
          `<div class="alert alert-success">${d.markSynced} ✓</div>`;
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function tutorView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    const courses = (await call<{ id: string; title: string }[]>(
      '/api/v1/courses',
      {},
      orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }
    ).catch(() => [])) as { id: string; title: string }[];
    el.innerHTML = `<h2>🤖 AI Tutor</h2><p class="text-muted">${d.tutorNote}</p>
      <div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
      <div><label class="form-label">${d.courseOptional}</label><select id="tu-course" class="form-select"><option value="">${d.allMyCourses}</option>${courses.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></div>
      <form id="tu-ask" class="d-flex gap-2 flex-fill"><input id="tu-q" class="form-control" placeholder="${d.askPlaceholder}" required maxlength="2000"><button class="btn btn-primary">${d.ask}</button></form></div></div>
      <div id="tu-out"></div>`;
    (el.querySelector('#tu-ask') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = el.querySelector('#tu-out') as HTMLElement;
      out.innerHTML = loading();
      try {
        const r = (await call<{
          conversation_id: string;
          answer: string;
          grounded: boolean;
          sources: { title: string }[];
        }>('/api/v1/ai/ask', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: orgId,
            course_id: (el.querySelector('#tu-course') as HTMLSelectElement).value || undefined,
            question: (el.querySelector('#tu-q') as HTMLInputElement).value,
          }),
        })) as {
          conversation_id: string;
          answer: string;
          grounded: boolean;
          sources: { title: string }[];
        };
        out.innerHTML = `<div class="card"><div class="card-body"><span class="badge ${r.grounded ? 'bg-green' : 'bg-yellow'}">${r.grounded ? 'course-grounded' : 'general knowledge'}</span>
          <p class="mt-2">${esc(r.answer.slice(0, 4000))}</p>
          ${r.sources.length ? `<div class="small text-muted">Sources: ${r.sources.map((s) => esc(s.title)).join(', ')}</div>` : ''}</div></div>`;
      } catch (err) {
        out.innerHTML = `<div class="alert alert-danger">${esc(err instanceof Error ? err.message : 'Failed')}</div>`;
      }
    });
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function exercisesView(el: HTMLElement, courseId: string): Promise<void> {
  const items = (await call<{ id: string; title: string; language: string }[]>(
    `/api/v1/exercises`,
    {},
    { course_id: courseId }
  ).catch(() => [])) as { id: string; title: string; language: string }[];
  el.innerHTML = `<h3>💻 ${d.exercises}</h3>${
    items
      .map(
        (x) => `<div class="card mb-2"><div class="card-body">
    <h3 class="card-title">${esc(x.title)}</h3><span class="badge bg-blue">${esc(x.language)}</span>
    <form data-ex="${x.id}" class="mt-2"><textarea name="code" class="form-control mb-2" rows="6" placeholder="// your code"></textarea>
    <button class="btn btn-sm btn-primary">${d.submit} (review)</button></form></div></div>`
      )
      .join('') || `<p class="text-muted">${d.empty}</p>`
  }`;
  el.querySelectorAll('[data-ex]').forEach((f) =>
    (f as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call(`/api/v1/exercises/${(f as HTMLElement).dataset.ex}/submissions`, {
          method: 'POST',
          body: JSON.stringify({ code: String(new FormData(f as HTMLFormElement).get('code')) }),
        });
        toast(d.submit, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    })
  );
}

async function moreView(el: HTMLElement): Promise<void> {
  const orgId =
    currentOrg() ??
    (await myOrgs()
      .then((o) => {
        if (o[0] && !currentOrg()) setCurrentOrg(o[0].id);
        return currentOrg();
      })
      .catch(() => null));
  el.innerHTML = loading();
  try {
    const [att, notifs] = await Promise.all([
      orgId
        ? call<{
            records: { status: string; title: string; session_date: string }[];
            attendance_pct: number;
          }>(`/api/v1/attendance/student`, {}, { organization_id: orgId }).catch(() => ({
            records: [],
            attendance_pct: 0,
          }))
        : Promise.resolve({ records: [], attendance_pct: 0 }),
      call<{ id: string; title: string; body: string; is_read: number }[]>(
        '/api/v1/notifications'
      ).catch(() => []),
    ]);
    el.innerHTML = `<h2>${d.more}</h2>
    <div class="d-flex gap-1 flex-wrap mb-3">
      <a class="btn btn-sm btn-outline-primary" href="#/shop">🛍 ${d.shop}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/live">📡 ${d.live}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/programs">🗺 ${d.programs}</a>
      <a class="btn btn-sm btn-outline-primary" href="#/tutor">🤖 AI Tutor</a></div>
      <div class="card mb-3"><div class="card-header"><h3 class="card-title">${d.myAttendance} (${(att as { attendance_pct: number }).attendance_pct}%)</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>${d.session}</th><th>${d.date}</th><th>${d.status}</th></tr></thead><tbody>
      ${
        (att as { records: { status: string; title: string; session_date: string }[] }).records
          .slice(0, 20)
          .map(
            (r) =>
              `<tr><td>${esc(r.title)}</td><td>${esc(r.session_date)}</td><td><span class="badge ${r.status === 'present' ? 'bg-green' : 'bg-yellow'}">${esc(r.status)}</span></td></tr>`
          )
          .join('') || `<tr><td colspan="3">${d.empty}</td></tr>`
      }</tbody></table></div></div></div>
      <div class="card mb-3"><div class="card-header"><h3 class="card-title">${d.announcements}</h3>
      <button class="btn btn-sm btn-outline-primary ms-auto" id="notif-all">${d.markAllRead}</button></div><div class="card-body" id="notif-list">
      ${(notifs as { id: string; title: string; body: string; is_read: number }[]).map((n) => `<div class="alert ${n.is_read ? 'alert-info' : 'alert-success'} py-2"><strong>${esc(n.title)}</strong><br>${esc(n.body)}${n.is_read ? '' : ` <button class="btn btn-sm btn-outline-primary ms-2" data-nread="${n.id}">${d.markRead}</button>`}</div>`).join('') || `<p class="text-muted">${d.empty}</p>`}</div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">${d.profile}</h3></div><div class="card-body">
      <p><strong>${esc(getMe()?.name)}</strong><br><span class="text-muted">${esc(getMe()?.email)}</span></p>
      <form id="pw"><label class="form-label">${d.newPassword}</label><input type="password" id="npw" class="form-control mb-2" required>
      <label class="form-label">${d.currentPassword}</label><input type="password" id="cpw" class="form-control mb-2" required>
      <button class="btn btn-primary btn-sm">${d.changePassword}</button></form>
      <div class="mt-2"><button class="btn btn-sm btn-outline-primary" id="push-btn">${d.enablePush}</button> <span id="push-st" class="text-muted small"></span></div></div></div>`;
    (el.querySelector('#pw') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call('/api/v1/auth/password/change', {
          method: 'POST',
          body: JSON.stringify({
            current_password: (el.querySelector('#cpw') as HTMLInputElement).value,
            new_password: (el.querySelector('#npw') as HTMLInputElement).value,
          }),
        });
        toast(d.changePassword, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    (el.querySelector('#push-btn') as HTMLButtonElement).addEventListener('click', async () => {
      const r = await subscribePush();
      (el.querySelector('#push-st') as HTMLElement).textContent =
        r === 'subscribed' ? 'Enabled.' : r === 'no-keys' ? 'Not configured on this server.' : r;
    });
    const reloadMore = () => moreView(el);
    (el.querySelector('#notif-all') as HTMLButtonElement)?.addEventListener('click', async () => {
      try {
        await call('/api/v1/notifications/read-all', { method: 'POST', body: '{}' });
        await reloadMore();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    el.querySelectorAll('[data-nread]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await call(`/api/v1/notifications/${(b as HTMLElement).dataset.nread}/read`, {
            method: 'POST',
            body: '{}',
          });
          await reloadMore();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login') {
    await loginPage(app);
    return;
  }
  const me = await ensureMe();
  if (!me) {
    location.hash = '#/login';
    return;
  }
  if (!document.getElementById('view')) shell();
  const view = document.getElementById('view') as HTMLElement;
  const route = hash.replace('#', '');
  try {
    if (route === '/' || route === '') await home(view);
    else if (route === '/courses') await courseList(view);
    else if (route === '/shop') await shopView(view);
    else if (route === '/live') await liveView(view);
    else if (route === '/programs') await programsView(view);
    else if (route === '/tutor') await tutorView(view);
    else if (route.startsWith('/scorm/')) await scormPlayer(view, route.split('/')[2]);
    else if (route.startsWith('/courses/')) await courseDetail(view, route.split('/')[2]);
    else if (route.startsWith('/grades')) await gradesView(view);
    else if (route.startsWith('/more')) await moreView(view);
    else await home(view);
  } catch (e) {
    view.innerHTML = errHtml(e);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    bindSwUpdates();
  });
}
window.addEventListener('hashchange', () => void router());
void router();

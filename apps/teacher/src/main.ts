import '@tabler/core/dist/css/tabler.min.css';
import {
  createClient,
  applyTheme,
  themeToggleHtml,
  bindThemeToggles,
  bindSwUpdates,
  onlineIndicatorHtml,
  bindOnlineIndicator,
  toast,
  modalForm,
  esc,
  type ApiClient,
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
  return `<div class="alert alert-danger" role="alert">${esc(e instanceof Error ? e.message : 'Error')}</div>`;
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
  (document.getElementById('out') as HTMLButtonElement).addEventListener(
    'click',
    () => void logout()
  );
}

async function dashboard(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgs = await myOrgs().catch(() => []);
    if (!currentOrg() && orgs[0]) setCurrentOrg(orgs[0].id);
    const orgId = currentOrg();
    const courses = (await call<{ id: string; title: string; code: string }[]>(
      '/api/v1/instructor/courses',
      {},
      orgId ? { organization_id: orgId } : {}
    )) as {
      id: string;
      title: string;
      code: string;
    }[];
    const queue = orgId
      ? ((await call<{ submissions: { id: string }[]; attempts: { id: string }[] }>(
          '/api/v1/grading/queue',
          {},
          { organization_id: orgId }
        ).catch(() => ({ submissions: [], attempts: [] }))) as {
          submissions: { id: string }[];
          attempts: { id: string }[];
        })
      : { submissions: [], attempts: [] };
    el.innerHTML = `<div class="row row-cards mb-3">
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.myCourses}</div><div class="h1">${courses.length}</div></div></div></div>
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.pending}</div><div class="h1">${queue.submissions.length}</div></div></div></div>
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.quizReviews}</div><div class="h1">${queue.attempts.length}</div></div></div></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">${d.myCourses}</h3></div>
      <div class="list-group list-group-flush">${courses.map((c) => `<a class="list-group-item list-group-item-action" href="#/courses/${c.id}"><strong>${esc(c.title)}</strong><span class="text-muted"> · ${esc(c.code)}</span></a>`).join('') || `<div class="list-group-item text-muted">${d.empty}</div>`}</div></div>`;
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function renderCourseExercises(el: HTMLElement, courseId: string): Promise<void> {
  const box = el.querySelector('#exlist') as HTMLElement | null;
  if (!box) return;
  try {
    const items = (await call<{ id: string; title: string; language: string }[]>(
      `/api/v1/exercises`,
      {},
      { course_id: courseId }
    ).catch(() => [])) as { id: string; title: string; language: string }[];
    box.innerHTML = items.length
      ? items
          .map(
            (x) =>
              `<div class="mb-2"><strong>${esc(x.title)}</strong> <span class="badge bg-blue">${esc(x.language)}</span>
        <button class="btn btn-sm btn-outline-primary ms-2" data-exsubs="${x.id}">${d.submissions}</button>
        <div data-exbox="${x.id}"></div></div>`
          )
          .join('')
      : `<span class="text-muted">${d.noExercises}</span>`;
    box.querySelectorAll('[data-exsubs]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = (b as HTMLElement).dataset.exsubs ?? '';
        const target = box.querySelector(`[data-exbox="${id}"]`) as HTMLElement;
        const subs = (await call<
          { id: string; student_name: string; status: string; code: string }[]
        >(`/api/v1/exercises/${id}/submissions`).catch(() => [])) as {
          id: string;
          student_name: string;
          status: string;
          code: string;
        }[];
        target.innerHTML = subs.length
          ? subs
              .map(
                (s) =>
                  `<div class="border rounded p-2 mb-1"><strong>${esc(s.student_name)}</strong> <span class="badge bg-yellow">${esc(s.status)}</span>
            <pre class="small mt-1">${esc(s.code.slice(0, 800))}</pre>
            <form data-exfb="${s.id}" class="d-flex gap-1 mt-1"><input name="feedback" class="form-control form-control-sm" placeholder="${d.feedback}" required>
            <select name="status" class="form-select form-select-sm w-auto"><option value="reviewed">reviewed</option><option value="approved">approved</option><option value="needs_work">needs_work</option></select>
            <button class="btn btn-sm btn-primary">${d.send}</button></form></div>`
              )
              .join('')
          : `<span class="text-muted">${d.noSubmissions}</span>`;
        target.querySelectorAll('[data-exfb]').forEach((f) =>
          (f as HTMLFormElement).addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
              const fd = new FormData(f as HTMLFormElement);
              await call(
                `/api/v1/exercise-submissions/${(f as HTMLElement).dataset.exfb}/feedback`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    feedback: String(fd.get('feedback')),
                    status: String(fd.get('status')),
                  }),
                }
              );
              toast(d.feedbackSent, 'success');
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Failed', 'danger');
            }
          })
        );
      })
    );
  } catch {
    if (box) box.innerHTML = `<span class="text-danger">${d.failedLoad}</span>`;
  }
}

async function courseDetail(el: HTMLElement, courseId: string): Promise<void> {
  el.innerHTML = loading();
  try {
    const [course, sections, assignments] = await Promise.all([
      call<Record<string, string>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string }[]>(`/api/v1/courses/${courseId}/sections`),
      call<{ id: string; title: string; due_at: string | null }[]>(
        '/api/v1/assignments',
        {},
        { course_id: courseId }
      ).catch(() => []),
    ]);
    el.innerHTML = `<a href="#/courses" class="btn btn-sm btn-outline-secondary mb-2">← ${d.myCourses}</a>
      <h2>${esc(course.title)}</h2><p class="text-muted">${esc(course.description ?? '')}</p>
      <div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.sectionsLessons}</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="sec-add">${d.addSection}</button></div>
      <div class="card-body" id="secs">${(sections as { id: string; title: string }[]).map((s) => `<div class="mb-2"><strong>${esc(s.title)}</strong> <button class="btn btn-sm btn-outline-green" data-ladd="${s.id}">${d.addLesson}</button><div data-less="${s.id}" class="mt-1"></div></div>`).join('') || `<p class="text-muted">${d.noSections}</p>`}</div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.upcoming}</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="asg-add">${d.newAssignment}</button></div>
      <div class="list-group list-group-flush">${(assignments as { id: string; title: string; due_at: string | null }[]).map((a) => `<div class="list-group-item">${esc(a.title)}<span class="text-muted"> · ${esc(a.due_at ?? d.noDueDate)}</span></div>`).join('') || `<div class="list-group-item text-muted">${d.none}</div>`}</div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.enrollments}</h3></div><div class="card-body" id="enr">${d.loading}</div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.exercises}</h3></div><div class="card-body" id="exlist">${d.loading}</div></div></div></div>`;
    for (const s of sections as { id: string }[]) {
      const box = el.querySelector(`[data-less="${s.id}"]`) as HTMLElement;
      const lessons = (await call<{ id: string; title: string; content_type: string }[]>(
        `/api/v1/courses/sections/${s.id}/lessons`
      ).catch(() => [])) as { id: string; title: string; content_type: string }[];
      box.innerHTML =
        lessons
          .map(
            (l) =>
              `<div class="small">• ${esc(l.title)} <span class="badge bg-blue">${esc(l.content_type)}</span></div>`
          )
          .join('') || `<div class="small text-muted">${d.noLessons}</div>`;
    }
    const enrBox = el.querySelector('#enr') as HTMLElement;
    const enr = (await call<{ student_name: string; progress_percent: number }[]>(
      `/api/v1/courses/${courseId}/enrollments`
    ).catch(() => [])) as { student_name: string; progress_percent: number }[];
    enrBox.innerHTML = enr.length
      ? enr
          .map(
            (x) =>
              `<div class="d-flex justify-content-between border-bottom py-1"><span>${esc(x.student_name)}</span><span>${Number(x.progress_percent)}%</span></div>`
          )
          .join('')
      : d.noEnrollments;
    await renderCourseExercises(el, courseId);
    (el.querySelector('#sec-add') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        const data = await modalForm(d.addSection, [
          { name: 'title', label: d.title, required: true },
        ]);
        if (!data) return;
        await call(`/api/v1/courses/${courseId}/sections`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast(d.added, 'success');
        await courseDetail(el, courseId);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    el.querySelectorAll('[data-ladd]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const data = await modalForm(d.addLesson, [
            { name: 'title', label: d.title, required: true },
            {
              name: 'content_type',
              label: d.type,
              options: ['text', 'video', 'document', 'image', 'external'].map((x) => ({
                value: x,
                label: x,
              })),
            },
            { name: 'body', label: d.body, type: 'textarea' },
          ]);
          if (!data) return;
          await call(`/api/v1/courses/sections/${(b as HTMLElement).dataset.ladd}/lessons`, {
            method: 'POST',
            body: JSON.stringify(data),
          });
          toast(d.added, 'success');
          await courseDetail(el, courseId);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
    (el.querySelector('#asg-add') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        const data = await modalForm(d.newAssignment, [
          { name: 'title', label: d.title, required: true },
          { name: 'description', label: d.instructions, type: 'textarea' },
          { name: 'due_at', label: d.dueDateOpt },
          { name: 'max_score', label: d.maxScore, type: 'number', value: '100' },
        ]);
        if (!data) return;
        await call('/api/v1/assignments', {
          method: 'POST',
          body: JSON.stringify({
            course_id: courseId,
            ...data,
            max_score: Number(data.max_score),
            due_at: data.due_at || undefined,
          }),
        });
        toast(d.created, 'success');
        await courseDetail(el, courseId);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function grading(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) {
      el.innerHTML = '<div class="alert alert-warning">No organization.</div>';
      return;
    }
    const q = (await call<{
      submissions: {
        id: string;
        student_name: string;
        assignment_title: string;
        status: string;
        body: string;
      }[];
      attempts: { id: string; student_name: string; quiz_title: string; score: number | null }[];
    }>('/api/v1/grading/queue', {}, { organization_id: orgId })) as {
      submissions: {
        id: string;
        student_name: string;
        assignment_title: string;
        status: string;
        body: string;
      }[];
      attempts: { id: string; student_name: string; quiz_title: string; score: number | null }[];
    };
    el.innerHTML = `<div class="card mb-3"><div class="card-header"><h3 class="card-title">${d.pending} (${q.submissions.length})</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>${d.student}</th><th>${d.assignment}</th><th>${d.status}</th><th></th></tr></thead>
      <tbody>${
        q.submissions
          .map(
            (
              s
            ) => `<tr><td>${esc(s.student_name)}</td><td>${esc(s.assignment_title)}</td><td><span class="badge bg-yellow">${esc(s.status)}</span></td>
      <td><button class="btn btn-sm btn-primary" data-grade="${s.id}">${d.reviewGrade}</button></td></tr>`
          )
          .join('') || `<tr><td colspan="4">${d.caughtUp}</td></tr>`
      }</tbody></table></div></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">${d.recentAttempts}</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>${d.student}</th><th>${d.quiz}</th><th>${d.score}</th><th></th></tr></thead>
      <tbody>${
        q.attempts
          .slice(0, 20)
          .map(
            (a) =>
              `<tr><td>${esc(a.student_name)}</td><td>${esc(a.quiz_title)}</td><td>${a.score ?? '—'}</td><td><button class="btn btn-sm btn-outline-primary" data-review="${a.id}">${d.review}</button></td></tr>
               <tr><td colspan="4" class="p-0 border-0"><div data-answers="${a.id}"></div></td></tr>`
          )
          .join('') || `<tr><td colspan="4">${d.none}</td></tr>`
      }</tbody></table></div></div></div>`;
    el.querySelectorAll('[data-review]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = (b as HTMLElement).dataset.review ?? '';
        const box = el.querySelector(`[data-answers="${id}"]`) as HTMLElement;
        if (!box) return;
        if (box.dataset.loaded) {
          box.innerHTML = '';
          delete box.dataset.loaded;
          return;
        }
        try {
          const answers = (await call<
            {
              question_id: string;
              prompt: string;
              type: string;
              points: number;
              option_label: string | null;
              answer_text: string | null;
              is_correct: number | null;
              points_awarded: number;
            }[]
          >(`/api/v1/quiz-attempts/${id}/answers`)) as {
            question_id: string;
            prompt: string;
            type: string;
            points: number;
            option_label: string | null;
            answer_text: string | null;
            is_correct: number | null;
            points_awarded: number;
          }[];
          box.dataset.loaded = '1';
          box.innerHTML = `<div class="p-2 bg-light border rounded">${
            answers
              .map(
                (a) => `<div class="mb-2"><strong>${esc(a.prompt.slice(0, 160))}</strong>
            <span class="badge bg-blue">${esc(a.type)}</span>
            <div class="small">Answer: ${esc(a.option_label ?? (a.answer_text ?? '—').slice(0, 500))}</div>
            <div class="small text-muted">Awarded: ${Number(a.points_awarded)}/${Number(a.points)}${a.is_correct === 1 ? ' ✓' : a.is_correct === 0 ? ' ✗' : ' (pending)'}</div>
            <form data-manual="${a.question_id}:${id}" class="d-flex gap-1 mt-1">
            <input type="number" name="points" min="0" max="${a.points}" step="0.5" class="form-control form-control-sm w-auto" placeholder="${d.score}" required>
            <button class="btn btn-sm btn-outline-primary">${d.grade}</button></form></div>`
              )
              .join('') || `<span class="text-muted">${d.empty}</span>`
          }</div>`;
          box.querySelectorAll('[data-manual]').forEach((f) =>
            (f as HTMLFormElement).addEventListener('submit', async (e) => {
              e.preventDefault();
              try {
                const [qid, aid] = ((f as HTMLElement).dataset.manual ?? '').split(':');
                const pts = Number(new FormData(f as HTMLFormElement).get('points'));
                await call(`/api/v1/quiz-attempts/${aid}/grade`, {
                  method: 'POST',
                  body: JSON.stringify({ question_id: qid, points_awarded: pts }),
                });
                toast(d.save, 'success');
                delete box.dataset.loaded;
                (b as HTMLElement).click();
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Failed', 'danger');
              }
            })
          );
        } catch (err) {
          box.innerHTML = `<div class="alert alert-danger">${esc(err instanceof Error ? err.message : 'Failed')}</div>`;
        }
      })
    );
    el.querySelectorAll('[data-grade]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const id = (b as HTMLElement).dataset.grade ?? '';
          const sub = q.submissions.find((x) => x.id === id);
          const data = await modalForm(`Grade — ${sub?.student_name ?? ''}`, [
            {
              name: 'info',
              label: `Submission: ${(sub?.body ?? '').slice(0, 500)}`,
              type: 'text',
              value: '',
            },
            { name: 'score', label: d.score, type: 'number', required: true },
            { name: 'feedback', label: d.feedback, type: 'textarea' },
          ]);
          if (!data?.score) return;
          await call(`/api/v1/submissions/${id}/grade`, {
            method: 'POST',
            body: JSON.stringify({
              score: Number(data.score),
              feedback: data.feedback || undefined,
            }),
          });
          toast(d.graded, 'success');
          await grading(el);
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function studentsView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) {
      el.innerHTML = '<div class="alert alert-warning">No organization.</div>';
      return;
    }
    const courses = (await call<{ id: string; title: string }[]>(
      '/api/v1/instructor/courses',
      {},
      { organization_id: orgId }
    )) as { id: string; title: string }[];
    let html = '';
    for (const c of courses) {
      const enr = (await call<
        { student_id: string; student_name: string; progress_percent: number }[]
      >(`/api/v1/courses/${c.id}/enrollments`).catch(() => [])) as {
        student_id: string;
        student_name: string;
        progress_percent: number;
      }[];
      html += `<div class="card mb-3"><div class="card-header"><h3 class="card-title">${esc(c.title)} (${enr.length})</h3></div>
        <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th>${d.student}</th><th>${d.progress}</th><th></th></tr></thead><tbody>
        ${
          enr
            .map(
              (
                s
              ) => `<tr><td>${esc(s.student_name)}</td><td style="min-width:160px"><div class="progress"><div class="progress-bar" style="width:${Number(s.progress_percent)}%"></div></div></td>
        <td><button class="btn btn-sm btn-outline-primary" data-prog="${c.id}:${s.student_id}">${d.detail}</button></td></tr>`
            )
            .join('') || `<tr><td colspan="3">${d.noStudents}</td></tr>`
        }</tbody></table></div></div></div><div data-det></div>`;
    }
    el.innerHTML = html || `<div class="alert alert-info">${d.noCourses}</div>`;
    el.querySelectorAll('[data-prog]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const [cid, sid] = ((b as HTMLElement).dataset.prog ?? '').split(':');
          const rep = (await call<{
            progress?: { percent: number };
            lessons: { title: string; is_completed: number }[];
          }>(`/api/v1/courses/${cid}/progress`, {}, { student_id: sid })) as {
            progress?: { percent: number };
            lessons: { title: string; is_completed: number }[];
          };
          const box = (b as HTMLElement)
            .closest('.card')
            ?.parentElement?.querySelector('[data-det]') as HTMLElement | null;
          if (box)
            box.innerHTML = `<div class="alert alert-info">Progress ${Number(rep.progress?.percent ?? 0)}% — ${rep.lessons.filter((l) => l.is_completed).length}/${rep.lessons.length} lessons done.</div>`;
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed', 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function attendanceView(el: HTMLElement): Promise<void> {
  el.innerHTML = loading();
  try {
    const orgId = currentOrg();
    if (!orgId) {
      el.innerHTML = '<div class="alert alert-warning">No organization.</div>';
      return;
    }
    const courses = (await call<{ id: string; title: string }[]>(
      '/api/v1/instructor/courses',
      {},
      { organization_id: orgId }
    )) as { id: string; title: string }[];
    el.innerHTML = `<div class="card"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
      <div><label class="form-label" for="at-course">${d.course}</label><select id="at-course" class="form-select">${courses.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></div>
      <div><label class="form-label" for="at-title">${d.sessionTitle}</label><input id="at-title" class="form-control" placeholder="${d.sessionTitle}"></div>
      <div><label class="form-label" for="at-date">${d.date}</label><input id="at-date" type="date" class="form-control" value="${new Date().toISOString().slice(0, 10)}"></div>
      <button class="btn btn-primary" id="at-create">${d.createSession}</button></div></div><div id="at-list" class="mt-3"></div>`;
    const load = async () => {
      const box = el.querySelector('#at-list') as HTMLElement;
      const sessions = (await call<
        { id: string; title: string; session_date: string; course_id: string | null }[]
      >('/api/v1/attendance/sessions', {}, { organization_id: orgId })) as {
        id: string;
        title: string;
        session_date: string;
        course_id: string | null;
      }[];
      const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
      box.innerHTML =
        sessions
          .filter((s) => !s.course_id || s.course_id === cid)
          .map(
            (
              s
            ) => `<div class="card mb-2"><div class="card-body d-flex gap-2 align-items-center flex-wrap">
        <div><strong>${esc(s.title)}</strong><div class="text-muted small">${esc(s.session_date)}</div></div>
        <button class="btn btn-sm btn-primary ms-auto" data-take="${s.id}">${d.takeAttendance}</button></div>
        <div data-rec="${s.id}"></div></div>`
          )
          .join('') || `<div class="alert alert-info">${d.noSessions}</div>`;
    };
    (el.querySelector('#at-create') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
        await call('/api/v1/attendance/sessions', {
          method: 'POST',
          body: JSON.stringify({
            organization_id: orgId,
            course_id: cid,
            title: (el.querySelector('#at-title') as HTMLInputElement).value || d.sessionTitle,
            session_date: (el.querySelector('#at-date') as HTMLInputElement).value,
          }),
        });
        toast(d.sessionCreated, 'success');
        await load();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    (el.querySelector('#at-course') as HTMLSelectElement).addEventListener(
      'change',
      () => void load()
    );
    el.querySelector('#at-list')?.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest('[data-take]') as HTMLElement | null;
      if (!b?.dataset.take) return;
      try {
        const sessId = b.dataset.take;
        const cid = (el.querySelector('#at-course') as HTMLSelectElement).value;
        const enr = (await call<{ student_id: string; student_name: string }[]>(
          `/api/v1/courses/${cid}/enrollments`
        )) as { student_id: string; student_name: string }[];
        const box = el.querySelector(`[data-rec="${sessId}"]`) as HTMLElement;
        box.innerHTML = `<div class="card-body">${
          enr
            .map(
              (
                s
              ) => `<div class="d-flex gap-2 align-items-center mb-1"><span style="min-width:140px">${esc(s.student_name)}</span>
          <select class="form-select w-auto" data-s="${s.student_id}">${['present', 'absent', 'late', 'excused'].map((o) => `<option>${o}</option>`).join('')}</select></div>`
            )
            .join('') || d.noEnrolledStudents
        }
          ${enr.length ? '<button class="btn btn-primary mt-2" id="at-save">Save</button>' : ''}</div>`;
        box.querySelector('#at-save')?.addEventListener('click', async () => {
          try {
            const records = enr.map((s) => ({
              student_id: s.student_id,
              status: (box.querySelector(`[data-s="${s.student_id}"]`) as HTMLSelectElement).value,
            }));
            await call('/api/v1/attendance/records', {
              method: 'POST',
              body: JSON.stringify({ session_id: sessId, records }),
            });
            toast(`${d.recorded} ${records.length}`, 'success');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed', 'danger');
          }
        });
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'danger');
      }
    });
    await load();
  } catch (e) {
    el.innerHTML = errHtml(e);
  }
}

async function profile(el: HTMLElement): Promise<void> {
  const me = getMe();
  el.innerHTML = `<div class="card"><div class="card-body"><h3>${esc(me?.name)}</h3><p class="text-muted">${esc(me?.email)}</p>
    <form id="pw"><label class="form-label">${d.newPassword} (min 8)</label><input type="password" id="npw" class="form-control mb-2" required>
    <label class="form-label">${d.currentPassword}</label><input type="password" id="cpw" class="form-control mb-2" required>
    <button class="btn btn-primary">${d.changePassword}</button></form></div></div>`;
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
      toast(d.passwordChanged, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'danger');
    }
  });
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
  (document.getElementById('title') as HTMLElement).textContent =
    NAV.find((n) => n.hash === `#${route}`)?.label ?? d.dashboard;
  try {
    if (route === '/' || route === '') await dashboard(view);
    else if (route === '/courses') {
      const orgId = currentOrg();
      const courses = (await call<{ id: string; title: string; code: string }[]>(
        '/api/v1/instructor/courses',
        {},
        orgId ? { organization_id: orgId } : {}
      )) as { id: string; title: string; code: string }[];
      view.innerHTML = `<div class="row row-cards">${courses.map((c) => `<div class="col-md-4"><div class="card">      <div class="card-body"><h3>${esc(c.title)}</h3><p class="text-muted">${esc(c.code)}</p><a class="btn btn-primary" href="#/courses/${c.id}">${d.open}</a></div></div></div>`).join('')}</div>`;
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
// Navigations are serialized: a slow view must never overwrite a newer one
// (fire-and-forget hashchange handlers used to clobber #view mid-render).
let navChain: Promise<void> = Promise.resolve();
function navigate(): void {
  navChain = navChain.then(() => router());
}
window.addEventListener('hashchange', navigate);
navigate();

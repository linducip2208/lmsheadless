import {
  call,
  loadingHtml,
  errorHtml,
  toast,
  modalForm,
  confirmDialog,
  currentOrgId,
  t,
} from '../lib.js';

interface Quiz {
  id: string;
  title: string;
  passing_score: number;
  max_attempts: number;
  time_limit_minutes: number;
}
interface Question {
  id: string;
  type: string;
  prompt: string;
  points: number;
}

const TYPES = [
  'multiple_choice',
  'single_choice',
  'true_false',
  'short_answer',
  'essay',
  'matching',
  'ordering',
];

export async function renderQuizzes(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    <li class="nav-item" role="presentation"><button class="nav-link active" data-tab="quiz" role="tab">${d.quizzes}</button></li>
    <li class="nav-item" role="presentation"><button class="nav-link" data-tab="banks" role="tab">${d.questions}</button></li></ul>
    <div id="qz-body"></div>`;
  const body = el.querySelector('#qz-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      if ((b as HTMLElement).dataset.tab === 'banks') void renderBanks(body);
      else void renderQuizManager(body);
    })
  );
  await renderQuizManager(body);
}

async function renderQuizManager(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="q-course">${d.courses}</label><select id="q-course" class="form-select"></select></div>
    <button class="btn btn-primary" id="q-new">${d.new_} ${d.quizzes}</button></div></div>
    <div id="q-list"></div><div id="q-detail" class="mt-3"></div>`;
  const courseSel = el.querySelector('#q-course') as HTMLSelectElement;
  const list = el.querySelector('#q-list') as HTMLElement;
  const detail = el.querySelector('#q-detail') as HTMLElement;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>(
    '/api/v1/courses',
    {},
    orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }
  ).catch(() => [])) as { id: string; title: string }[];
  courseSel.innerHTML =
    courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('') ||
    `<option value="">${d.empty}</option>`;
  const load = async () => {
    const cid = courseSel.value;
    if (!cid) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = loadingHtml();
    try {
      const quizzes = (await call<Quiz[]>('/api/v1/quizzes', {}, { course_id: cid })) as Quiz[];
      list.innerHTML = quizzes.length
        ? `<div class="row row-cards">${quizzes
            .map(
              (q) => `<div class="col-md-6"><div class="card">
        <div class="card-body"><h3 class="card-title">${q.title}</h3>
        <div class="text-muted">${d.passingScore} ${q.passing_score} · ${q.max_attempts} · ${q.time_limit_minutes ? `${q.time_limit_minutes} min` : ''}</div>
        <div class="mt-2 d-flex gap-1"><button class="btn btn-sm btn-primary" data-quiz="${q.id}">${d.questions}</button>
        <button class="btn btn-sm btn-outline-primary" data-perf="${q.id}">${d.performance}</button></div></div></div></div>`
            )
            .join('')}</div>`
        : `<div class="alert alert-info">${d.empty}</div>`;
    } catch (e) {
      list.innerHTML = errorHtml(e);
    }
  };
  courseSel.addEventListener('change', () => {
    detail.innerHTML = '';
    void load();
  });
  (el.querySelector('#q-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!courseSel.value) return;
    const data = await modalForm(`${d.new_} ${d.quizzes}`, [
      { name: 'title', label: d.title, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
      { name: 'passing_score', label: d.passingScore, type: 'number', value: '70', required: true },
      { name: 'max_attempts', label: d.maxAttempts, type: 'number', value: '3' },
      { name: 'time_limit_minutes', label: d.timeLimit, type: 'number', value: '0' },
      { name: 'cooldown_minutes', label: d.cooldown, type: 'number', value: '0' },
      { name: 'shuffle_questions', label: d.shuffle, value: 'false' },
      {
        name: 'answer_release',
        label: d.scoreVisibility,
        options: [
          { value: 'after_submit', label: 'after_submit' },
          { value: 'never', label: 'never' },
        ],
      },
      { name: 'negative_marking', label: d.negativeMarking, value: 'false' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/quizzes', {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseSel.value,
          ...data,
          passing_score: Number(data.passing_score),
          max_attempts: Number(data.max_attempts),
          time_limit_minutes: Number(data.time_limit_minutes),
          cooldown_minutes: Number(data.cooldown_minutes),
          shuffle_questions: data.shuffle_questions === 'true',
          negative_marking: data.negative_marking === 'true',
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  list.addEventListener('click', async (e) => {
    const q = (e.target as HTMLElement).closest('[data-quiz]') as HTMLElement | null;
    const p = (e.target as HTMLElement).closest('[data-perf]') as HTMLElement | null;
    if (q?.dataset.quiz) await renderQuestions(detail, q.dataset.quiz);
    else if (p?.dataset.perf) await renderPerformance(detail, p.dataset.perf);
  });
  await load();
}

async function renderBanks(el: HTMLElement): Promise<void> {
  const d = t();
  const orgId = currentOrgId();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  el.innerHTML = `<button class="btn btn-primary mb-2" id="bank-new">${d.new_}</button><div id="bank-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#bank-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; name: string }[]>(
        '/api/v1/question-banks',
        {},
        { organization_id: orgId }
      )) as { id: string; name: string }[];
      box.innerHTML = items.length
        ? items
            .map(
              (b) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${b.name}</h3>
        <div class="d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-bq="${b.id}">${d.questions}</button>
        <button class="btn btn-sm btn-outline-green" data-badd="${b.id}">+ ${d.questions}</button></div>
        <div data-bd="${b.id}" class="mt-2"></div></div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#bank-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(d.questions, [
      { name: 'name', label: d.name, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
    ]);
    if (!data) return;
    await call('/api/v1/question-banks', {
      method: 'POST',
      body: JSON.stringify({ organization_id: orgId, ...data }),
    });
    toast(d.created, 'success');
    await load();
  });
  el.querySelector('#bank-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    try {
      if (btn.dataset.bq) {
        const qs = (await call<{ id: string; type: string; prompt: string; difficulty: string }[]>(
          `/api/v1/question-banks/${btn.dataset.bq}/questions`
        )) as {
          id: string;
          type: string;
          prompt: string;
          difficulty: string;
        }[];
        (el.querySelector(`[data-bd="${btn.dataset.bq}"]`) as HTMLElement).innerHTML =
          qs
            .map(
              (q) =>
                `<div class="small mb-1"><span class="badge bg-blue">${q.type}</span> <span class="badge bg-secondary">${q.difficulty}</span> ${q.prompt.slice(0, 120)} <button class="btn btn-sm btn-outline-green" data-copy="${btn.dataset.bq}:${q.id}">${d.create}</button></div>`
            )
            .join('') || `<p class="text-muted">${d.empty}</p>`;
      } else if (btn.dataset.badd) {
        const base = await modalForm(d.questions, [
          { name: 'type', label: d.type, options: TYPES.map((x) => ({ value: x, label: x })) },
          { name: 'prompt', label: d.prompt, type: 'textarea', required: true },
          { name: 'points', label: d.points, type: 'number', value: '10' },
          {
            name: 'difficulty',
            label: d.difficulty,
            options: ['easy', 'medium', 'hard'].map((x) => ({ value: x, label: x })),
          },
          { name: 'correct_answer', label: d.correctAnswer },
          { name: 'options', label: d.options, type: 'textarea' },
        ]);
        if (!base) return;
        const payload: Record<string, unknown> = { ...base, points: Number(base.points) };
        if (base.options) {
          payload.options = base.options
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .map((l: string) => {
              const correct = l.startsWith('*');
              const text = correct ? l.slice(1).trim() : l;
              const [label, match] = text.split('=').map((s: string) => s.trim());
              return { label, match_value: match || undefined, is_correct: correct };
            });
        }
        await call(`/api/v1/question-banks/${btn.dataset.badd}/questions`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(d.created, 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  el.querySelector('#bank-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null;
    if (!btn?.dataset.copy) return;
    const [bankId, qId] = btn.dataset.copy.split(':');
    const data = await modalForm(d.create, [
      { name: 'quiz_id', label: `${d.quizzes} ID`, required: true },
    ]);
    if (!data?.quiz_id) return;
    await call(`/api/v1/question-banks/${bankId}/questions/${qId}/copy-to/${data.quiz_id}`, {
      method: 'POST',
      body: '{}',
    });
    toast(d.saved, 'success');
  });
  await load();
}

async function questionOptionStep(type: string): Promise<Record<string, unknown> | null> {
  const d = t();
  if (type === 'multiple_choice' || type === 'single_choice') {
    const opts = await modalForm(d.options, [
      { name: 'options', label: '*', type: 'textarea', required: true },
    ]);
    if (!opts?.options) return null;
    return {
      options: opts.options
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((l: string) => ({
          label: l.startsWith('*') ? l.slice(1).trim() : l,
          is_correct: l.startsWith('*'),
        })),
    };
  }
  if (type === 'matching' || type === 'ordering') {
    const opts = await modalForm(d.options, [
      { name: 'options', label: 'LEFT = RIGHT', type: 'textarea', required: true },
    ]);
    if (!opts?.options) return null;
    return {
      options: opts.options
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((l: string) => {
          const [label, match] = l.split('=').map((s: string) => s.trim());
          return { label, match_value: match, is_correct: false };
        }),
    };
  }
  const ans = await modalForm(d.correctAnswer, [
    { name: 'correct_answer', label: d.correctAnswer, required: true },
  ]);
  return ans ? { correct_answer: ans.correct_answer } : null;
}

async function renderQuestions(el: HTMLElement, quizId: string): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const questions = (await call<
      (Question & { options?: { id: string; label: string; is_correct: number }[] })[]
    >(`/api/v1/quizzes/${quizId}/questions`)) as (Question & {
      options?: { id: string; label: string; is_correct: number }[];
    })[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.questions} (${questions.length})</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="q-add">${d.create}</button></div>
      <div class="list-group list-group-flush">${
        questions
          .map(
            (q, i) => `<div class="list-group-item">
        <div class="d-flex gap-2 align-items-center flex-wrap"><span class="badge bg-blue">${q.type}</span>
        <strong>${i + 1}. ${q.prompt.slice(0, 160)}</strong><span class="text-muted">${q.points}</span>
        <span class="ms-auto d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" data-up="${q.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-sm btn-outline-secondary" data-down="${q.id}" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-sm btn-outline-primary" data-edit="${q.id}">${d.edit}</button>
          <button class="btn btn-sm btn-outline-danger" data-del="${q.id}">${d.delete}</button>
        </span></div>
        ${q.options?.length ? `<div class="mt-1 small">${q.options.map((o) => `<span class="badge ${o.is_correct ? 'bg-green' : 'bg-secondary'} me-1">${o.label}</span>`).join('')}</div>` : ''}
      </div>`
          )
          .join('') || `<div class="list-group-item text-muted">${d.empty}</div>`
      }</div></div>`;
    (el.querySelector('#q-add') as HTMLButtonElement).addEventListener('click', async () => {
      const base = await modalForm(d.questions, [
        { name: 'type', label: d.type, options: TYPES.map((x) => ({ value: x, label: x })) },
        { name: 'prompt', label: d.prompt, type: 'textarea', required: true },
        { name: 'points', label: d.points, type: 'number', value: '10' },
        {
          name: 'difficulty',
          label: d.difficulty,
          options: ['easy', 'medium', 'hard'].map((x) => ({ value: x, label: x })),
        },
        { name: 'negative_points', label: d.negativeMarking, type: 'number', value: '0' },
        { name: 'explanation', label: d.explanation, type: 'textarea' },
      ]);
      if (!base) return;
      const extra = await questionOptionStep(String(base.type));
      if (
        extra === null &&
        (base.type === 'multiple_choice' ||
          base.type === 'single_choice' ||
          base.type === 'matching' ||
          base.type === 'ordering')
      ) {
        toast(d.error, 'warning');
        return;
      }
      try {
        await call(`/api/v1/quizzes/${quizId}/questions`, {
          method: 'POST',
          body: JSON.stringify({
            ...base,
            ...extra,
            points: Number(base.points),
            negative_points: Number(base.negative_points),
          }),
        });
        toast(d.created, 'success');
        await renderQuestions(el, quizId);
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    el.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = (b as HTMLElement).dataset.edit ?? '';
        const data = await modalForm(d.edit, [
          { name: 'prompt', label: d.prompt, type: 'textarea', required: true },
          { name: 'points', label: d.points, type: 'number', value: '10' },
        ]);
        if (!data) return;
        await call(`/api/v1/questions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...data, points: Number(data.points) }),
        });
        toast(d.saved, 'success');
        await renderQuestions(el, quizId);
      })
    );
    el.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog(d.confirmDelete, d.confirmDeleteBody, d.delete))) return;
        await call(`/api/v1/questions/${(b as HTMLElement).dataset.del}`, { method: 'DELETE' });
        toast(d.deleted, 'success');
        await renderQuestions(el, quizId);
      })
    );
    el.querySelectorAll('[data-up],[data-down]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ids = questions.map((x) => x.id);
        const cur = ((b as HTMLElement).dataset.up ?? (b as HTMLElement).dataset.down) as string;
        const idx = ids.indexOf(cur);
        const swap = (b as HTMLElement).dataset.up ? idx - 1 : idx + 1;
        if (idx < 0 || swap < 0 || swap >= ids.length) return;
        [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
        await call(`/api/v1/quizzes/${quizId}/questions/reorder`, {
          method: 'POST',
          body: JSON.stringify({ ordered_ids: ids }),
        });
        await renderQuestions(el, quizId);
      })
    );
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderPerformance(el: HTMLElement, quizId: string): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const p = (await call<Record<string, unknown>>(
      '/api/v1/reports/quiz-performance',
      {},
      { quiz_id: quizId }
    )) as {
      title: string;
      attempts: number;
      avg_score: number;
      pass_rate: number;
      per_question: { prompt: string; answered: number; correct_rate: number }[];
    };
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.performance}: ${p.title}</h3></div>
      <div class="card-body"><div class="row mb-3">
      ${[
        [d.attempts, p.attempts],
        [d.avgScore, p.avg_score],
        [d.passRate, `${p.pass_rate}%`],
      ]
        .map(
          ([l, v]) =>
            `<div class="col-4"><div class="subheader">${l}</div><div class="h2">${v}</div></div>`
        )
        .join('')}
      </div>${
        p.per_question
          .map(
            (
              q
            ) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${q.prompt}</span><span class="text-muted">${q.correct_rate}%</span></div>
      <div class="progress"><div class="progress-bar" style="width:${q.correct_rate}%"></div></div></div>`
          )
          .join('') || `<p class="text-muted">${d.empty}</p>`
      }</div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

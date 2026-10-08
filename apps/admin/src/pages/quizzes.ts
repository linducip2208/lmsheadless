import { call, loadingHtml, errorHtml, toast, modalForm, confirmDialog, currentOrgId } from '../lib.js';

interface Quiz { id: string; title: string; passing_score: number; max_attempts: number; time_limit_minutes: number }
interface Question { id: string; type: string; prompt: string; points: number }

export async function renderQuizzes(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="q-course">Course</label><select id="q-course" class="form-select"></select></div>
    <button class="btn btn-primary" id="q-new">New quiz</button></div></div>
    <div id="q-list"></div><div id="q-detail" class="mt-3"></div>`;
  const courseSel = el.querySelector('#q-course') as HTMLSelectElement;
  const list = el.querySelector('#q-list') as HTMLElement;
  const detail = el.querySelector('#q-detail') as HTMLElement;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>('/api/v1/courses', {}, orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }).catch(() => [])) as { id: string; title: string }[];
  courseSel.innerHTML = courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('') || '<option value="">No courses</option>';
  const load = async () => {
    const cid = courseSel.value;
    if (!cid) { list.innerHTML = ''; return; }
    list.innerHTML = loadingHtml();
    try {
      const quizzes = (await call<Quiz[]>('/api/v1/quizzes', {}, { course_id: cid })) as Quiz[];
      list.innerHTML = quizzes.length ? `<div class="row row-cards">${quizzes.map((q) => `<div class="col-md-6"><div class="card">
        <div class="card-body"><h3 class="card-title">${q.title}</h3>
        <div class="text-muted">Pass ${q.passing_score} · ${q.max_attempts} attempts${q.time_limit_minutes ? ` · ${q.time_limit_minutes} min limit` : ''}</div>
        <div class="mt-2 d-flex gap-1"><button class="btn btn-sm btn-primary" data-quiz="${q.id}">Questions</button>
        <button class="btn btn-sm btn-outline-primary" data-perf="${q.id}">Performance</button></div></div></div></div>`).join('')}</div>`
        : '<div class="alert alert-info">No quizzes in this course yet.</div>';
    } catch (e) { list.innerHTML = errorHtml(e); }
  };
  courseSel.addEventListener('change', () => { detail.innerHTML = ''; void load(); });
  (el.querySelector('#q-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!courseSel.value) { toast('Select a course first', 'warning'); return; }
    const data = await modalForm('New quiz', [
      { name: 'title', label: 'Title', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'passing_score', label: 'Passing score (0-100)', type: 'number', value: '70', required: true },
      { name: 'max_attempts', label: 'Max attempts', type: 'number', value: '3' },
      { name: 'time_limit_minutes', label: 'Time limit (minutes, 0 = none)', type: 'number', value: '0' },
      { name: 'shuffle_questions', label: 'Shuffle for students? (true/false)', value: 'false' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/quizzes', { method: 'POST', body: JSON.stringify({ course_id: courseSel.value, ...data, passing_score: Number(data.passing_score), max_attempts: Number(data.max_attempts), time_limit_minutes: Number(data.time_limit_minutes), shuffle_questions: data.shuffle_questions === 'true' }) });
      toast('Quiz created', 'success');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
  });
  list.addEventListener('click', async (e) => {
    const q = (e.target as HTMLElement).closest('[data-quiz]') as HTMLElement | null;
    const p = (e.target as HTMLElement).closest('[data-perf]') as HTMLElement | null;
    if (q?.dataset.quiz) await renderQuestions(detail, q.dataset.quiz);
    else if (p?.dataset.perf) await renderPerformance(detail, p.dataset.perf);
  });
  await load();
}

async function renderQuestions(el: HTMLElement, quizId: string): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const questions = (await call<(Question & { options?: { id: string; label: string; is_correct: number }[] })[]>(`/api/v1/quizzes/${quizId}/questions`)) as (Question & { options?: { id: string; label: string; is_correct: number }[] })[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Questions (${questions.length})</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="q-add">Add question</button></div>
      <div class="list-group list-group-flush">${questions.map((q, i) => `<div class="list-group-item">
        <div class="d-flex gap-2 align-items-center flex-wrap"><span class="badge bg-blue">${q.type}</span>
        <strong>${i + 1}. ${q.prompt.slice(0, 160)}</strong><span class="text-muted">${q.points} pts</span>
        <span class="ms-auto d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" data-up="${q.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-sm btn-outline-secondary" data-down="${q.id}" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-sm btn-outline-primary" data-edit="${q.id}">Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-del="${q.id}">Delete</button>
        </span></div>
        ${q.options?.length ? `<div class="mt-1 small">${q.options.map((o) => `<span class="badge ${o.is_correct ? 'bg-green' : 'bg-secondary'} me-1">${o.label}</span>`).join('')}</div>` : ''}
      </div>`).join('') || '<div class="list-group-item text-muted">No questions yet.</div>'}</div></div>`;
    (el.querySelector('#q-add') as HTMLButtonElement).addEventListener('click', async () => {
      const base = await modalForm('Add question', [
        { name: 'type', label: 'Type', options: [{ value: 'multiple_choice', label: 'Multiple choice' }, { value: 'true_false', label: 'True/False' }, { value: 'short_answer', label: 'Short answer' }] },
        { name: 'prompt', label: 'Question text', type: 'textarea', required: true },
        { name: 'points', label: 'Points', type: 'number', value: '10' },
      ]);
      if (!base) return;
      let payload: Record<string, unknown> = { ...base, points: Number(base.points) };
      if (base.type === 'multiple_choice') {
        const opts = await modalForm('Answer options (mark correct with *)', [
          { name: 'options', label: 'One per line, prefix correct with * (exactly one)', type: 'textarea', required: true },
        ]);
        if (!opts?.options) { toast('Options required', 'warning'); return; }
        const lines = opts.options.split('\n').map((s) => s.trim()).filter(Boolean);
        payload = { ...payload, options: lines.map((l) => ({ label: l.startsWith('*') ? l.slice(1).trim() : l, is_correct: l.startsWith('*') })) };
      } else if (base.type === 'true_false' || base.type === 'short_answer') {
        const ans = await modalForm('Correct answer', [{ name: 'correct_answer', label: base.type === 'true_false' ? 'true / false' : 'Expected answer', required: true }]);
        if (!ans) return;
        payload = { ...payload, correct_answer: ans.correct_answer };
      }
      try {
        await call(`/api/v1/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify(payload) });
        toast('Question added', 'success');
        await renderQuestions(el, quizId);
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    });
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const id = (b as HTMLElement).dataset.edit ?? '';
      const data = await modalForm('Edit question', [
        { name: 'prompt', label: 'Question text', type: 'textarea', required: true },
        { name: 'points', label: 'Points', type: 'number', value: '10' },
      ]);
      if (!data) return;
      await call(`/api/v1/questions/${id}`, { method: 'PATCH', body: JSON.stringify({ ...data, points: Number(data.points) }) });
      toast('Saved', 'success');
      await renderQuestions(el, quizId);
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete question?', 'Existing answers referencing it are removed.'))) return;
      await call(`/api/v1/questions/${(b as HTMLElement).dataset.del}`, { method: 'DELETE' });
      toast('Deleted', 'success');
      await renderQuestions(el, quizId);
    }));
    el.querySelectorAll('[data-up],[data-down]').forEach((b) => b.addEventListener('click', async () => {
      const ids = questions.map((x) => x.id);
      const cur = ((b as HTMLElement).dataset.up ?? (b as HTMLElement).dataset.down) as string;
      const idx = ids.indexOf(cur);
      const swap = (b as HTMLElement).dataset.up ? idx - 1 : idx + 1;
      if (idx < 0 || swap < 0 || swap >= ids.length) return;
      [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
      await call(`/api/v1/quizzes/${quizId}/questions/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: ids }) });
      await renderQuestions(el, quizId);
    }));
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderPerformance(el: HTMLElement, quizId: string): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const p = (await call<Record<string, unknown>>('/api/v1/reports/quiz-performance', {}, { quiz_id: quizId })) as {
      title: string; attempts: number; avg_score: number; pass_rate: number;
      per_question: { prompt: string; answered: number; correct_rate: number }[];
    };
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Performance: ${p.title}</h3></div>
      <div class="card-body"><div class="row mb-3">
      ${[['Attempts', p.attempts], ['Avg score', p.avg_score], ['Pass rate', `${p.pass_rate}%`]].map(([l, v]) => `<div class="col-4"><div class="subheader">${l}</div><div class="h2">${v}</div></div>`).join('')}
      </div>${p.per_question.map((q) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${q.prompt}</span><span class="text-muted">${q.correct_rate}% correct</span></div>
      <div class="progress"><div class="progress-bar" style="width:${q.correct_rate}%"></div></div></div>`).join('') || '<p class="text-muted">No attempts yet.</p>'}</div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

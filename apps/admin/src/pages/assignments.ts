import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId } from '../lib.js';

export async function renderAssignments(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="a-course">Course</label><select id="a-course" class="form-select"></select></div>
    <button class="btn btn-primary" id="a-new">New assignment</button></div></div>
    <div id="a-list"></div><div id="a-detail" class="mt-3"></div>`;
  const courseSel = el.querySelector('#a-course') as HTMLSelectElement;
  const list = el.querySelector('#a-list') as HTMLElement;
  const detail = el.querySelector('#a-detail') as HTMLElement;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>('/api/v1/courses', {}, orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }).catch(() => [])) as { id: string; title: string }[];
  courseSel.innerHTML = courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('') || '<option value="">No courses</option>';
  const load = async () => {
    if (!courseSel.value) { list.innerHTML = ''; return; }
    list.innerHTML = loadingHtml();
    try {
      const items = (await call<{ id: string; title: string; due_at: string | null; max_score: number }[]>('/api/v1/assignments', {}, { course_id: courseSel.value })) as {
        id: string; title: string; due_at: string | null; max_score: number;
      }[];
      list.innerHTML = items.length ? `<div class="row row-cards">${items.map((a) => `<div class="col-md-6"><div class="card">
        <div class="card-body"><h3 class="card-title">${a.title}</h3>
        <div class="text-muted">Due: ${a.due_at ?? '—'} · Max ${a.max_score}</div>
        <button class="btn btn-sm btn-primary mt-2" data-asg="${a.id}">Review submissions</button></div></div></div>`).join('')}</div>`
        : '<div class="alert alert-info">No assignments yet.</div>';
    } catch (e) { list.innerHTML = errorHtml(e); }
  };
  courseSel.addEventListener('change', () => { detail.innerHTML = ''; void load(); });
  (el.querySelector('#a-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!courseSel.value) { toast('Select a course first', 'warning'); return; }
    const data = await modalForm('New assignment', [
      { name: 'title', label: 'Title', required: true },
      { name: 'description', label: 'Instructions', type: 'textarea' },
      { name: 'due_at', label: 'Due date (ISO, optional)', type: 'text' },
      { name: 'max_score', label: 'Max score', type: 'number', value: '100' },
      { name: 'allow_resubmit', label: 'Allow resubmit? (true/false)', value: 'true' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/assignments', { method: 'POST', body: JSON.stringify({ course_id: courseSel.value, ...data, max_score: Number(data.max_score), allow_resubmit: data.allow_resubmit !== 'false', due_at: data.due_at || undefined }) });
      toast('Assignment created', 'success');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-asg]') as HTMLElement | null;
    if (b?.dataset.asg) void renderSubmissions(detail, b.dataset.asg);
  });
  await load();
}

async function renderSubmissions(el: HTMLElement, assignmentId: string): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    // Submissions are reviewed via grades/report context; fetch directly is teacher-scoped.
    // We reuse the submissions list through course context: query submissions of this assignment.
    const subs = (await call<{ id: string; student_id: string; status: string; score: number | null; body: string; submitted_at: string }[]>(
      `/api/v1/assignments/${assignmentId}/submissions`
    ).catch(() => [])) as { id: string; student_id: string; status: string; score: number | null; body: string; submitted_at: string }[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Submissions (${subs.length})</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr>
      <th scope="col">Student</th><th scope="col">Status</th><th scope="col">Score</th><th scope="col">Submitted</th><th scope="col"></th></tr></thead>
      <tbody>${subs.map((s) => `<tr><td class="text-truncate" style="max-width:220px">${s.student_id.slice(0, 8)}…</td>
      <td><span class="badge ${s.status === 'graded' ? 'bg-green' : 'bg-yellow'}">${s.status}</span></td>
      <td>${s.score ?? '—'}</td><td>${s.submitted_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
      <td><button class="btn btn-sm btn-outline-primary" data-grade="${s.id}">Grade</button></td></tr>`).join('') || '<tr><td colspan="5">No submissions yet.</td></tr>'}</tbody></table></div></div></div>`;
    el.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', async () => {
      const data = await modalForm('Grade submission', [
        { name: 'score', label: 'Score', type: 'number', required: true },
        { name: 'feedback', label: 'Feedback', type: 'textarea' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/submissions/${(b as HTMLElement).dataset.grade}/grade`, { method: 'POST', body: JSON.stringify({ score: Number(data.score), feedback: data.feedback || undefined }) });
        toast('Graded', 'success');
        await renderSubmissions(el, assignmentId);
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    }));
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

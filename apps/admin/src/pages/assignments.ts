import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId, t } from '../lib.js';

export async function renderAssignments(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="a-course">${d.courses}</label><select id="a-course" class="form-select"></select></div>
    <button class="btn btn-primary" id="a-new">${d.new_} ${d.assignments}</button></div></div>
    <div id="a-list"></div><div id="a-detail" class="mt-3"></div>`;
  const courseSel = el.querySelector('#a-course') as HTMLSelectElement;
  const list = el.querySelector('#a-list') as HTMLElement;
  const detail = el.querySelector('#a-detail') as HTMLElement;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>(
    '/api/v1/courses',
    {},
    orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }
  ).catch(() => [])) as { id: string; title: string }[];
  courseSel.innerHTML =
    courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('') ||
    '<option value="">No courses</option>';
  const load = async () => {
    if (!courseSel.value) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = loadingHtml();
    try {
      const items = (await call<
        { id: string; title: string; due_at: string | null; max_score: number }[]
      >('/api/v1/assignments', {}, { course_id: courseSel.value })) as {
        id: string;
        title: string;
        due_at: string | null;
        max_score: number;
      }[];
      list.innerHTML = items.length
        ? `<div class="row row-cards">${items
            .map(
              (a) => `<div class="col-md-6"><div class="card">
        <div class="card-body"><h3 class="card-title">${a.title}</h3>
        <div class="text-muted">${d.dueDate}: ${a.due_at ?? '—'} · ${d.maxScore} ${a.max_score}</div>
        <button class="btn btn-sm btn-primary mt-2" data-asg="${a.id}">${d.review}</button></div></div></div>`
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
  (el.querySelector('#a-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!courseSel.value) return;
    const data = await modalForm(`${d.new_} ${d.assignments}`, [
      { name: 'title', label: d.title, required: true },
      { name: 'description', label: d.instructions, type: 'textarea' },
      { name: 'due_at', label: d.dueDate, type: 'text' },
      { name: 'max_score', label: d.maxScore, type: 'number', value: '100' },
      { name: 'allow_resubmit', label: d.resubmit, value: 'true' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/assignments', {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseSel.value,
          ...data,
          max_score: Number(data.max_score),
          allow_resubmit: data.allow_resubmit !== 'false',
          due_at: data.due_at || undefined,
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-asg]') as HTMLElement | null;
    if (b?.dataset.asg) void renderSubmissions(detail, b.dataset.asg);
  });
  await load();
}

async function renderSubmissions(el: HTMLElement, assignmentId: string): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const subs = (await call<
      {
        id: string;
        student_id: string;
        status: string;
        score: number | null;
        body: string;
        submitted_at: string;
      }[]
    >(`/api/v1/assignments/${assignmentId}/submissions`).catch(() => [])) as {
      id: string;
      student_id: string;
      status: string;
      score: number | null;
      body: string;
      submitted_at: string;
    }[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.assignments} (${subs.length})</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr>
      <th scope="col">${d.students}</th><th scope="col">${d.status}</th><th scope="col">${d.total}</th><th scope="col">${d.date}</th><th scope="col"></th></tr></thead>
      <tbody>${
        subs
          .map(
            (
              s
            ) => `<tr><td class="text-truncate" style="max-width:220px">${s.student_id.slice(0, 8)}…</td>
      <td><span class="badge ${s.status === 'graded' ? 'bg-green' : 'bg-yellow'}">${s.status}</span></td>
      <td>${s.score ?? '—'}</td><td>${s.submitted_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
      <td><button class="btn btn-sm btn-outline-primary" data-grade="${s.id}">${d.grade}</button></td></tr>`
          )
          .join('') || `<tr><td colspan="5">${d.empty}</td></tr>`
      }</tbody></table></div></div></div>`;
    el.querySelectorAll('[data-grade]').forEach((b) =>
      b.addEventListener('click', async () => {
        const data = await modalForm(d.grade, [
          { name: 'score', label: d.total, type: 'number', required: true },
          { name: 'feedback', label: d.feedback, type: 'textarea' },
        ]);
        if (!data) return;
        try {
          await call(`/api/v1/submissions/${(b as HTMLElement).dataset.grade}/grade`, {
            method: 'POST',
            body: JSON.stringify({
              score: Number(data.score),
              feedback: data.feedback || undefined,
            }),
          });
          toast(d.saved, 'success');
          await renderSubmissions(el, assignmentId);
        } catch (e) {
          toast(e instanceof Error ? e.message : d.failed, 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId, t } from '../lib.js';

export async function renderGrades(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="g-course">${d.courses}</label><select id="g-course" class="form-select"></select></div>
    <div><label class="form-label" for="g-student">${d.users} ID</label><input id="g-student" class="form-control"></div>
    <button class="btn btn-primary" id="g-load">${d.view}</button>
    <button class="btn btn-outline-primary" id="g-new">${d.grade}</button></div></div>
    <div id="g-list"></div>`;
  const courseSel = el.querySelector('#g-course') as HTMLSelectElement;
  const studentInput = el.querySelector('#g-student') as HTMLInputElement;
  const list = el.querySelector('#g-list') as HTMLElement;
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
      const query: Record<string, string> = { course_id: courseSel.value };
      if (studentInput.value.trim()) query.student_id = studentInput.value.trim();
      const grades = (await call<
        {
          id: string;
          student_id: string;
          category: string;
          score: number;
          max_score: number;
          feedback: string | null;
        }[]
      >('/api/v1/grades', {}, query)) as {
        id: string;
        student_id: string;
        category: string;
        score: number;
        max_score: number;
        feedback: string | null;
      }[];
      list.innerHTML = grades.length
        ? `<div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table card-table">
        <thead><tr><th scope="col">${d.students}</th><th scope="col">${d.status}</th><th scope="col">${d.total}</th><th scope="col">${d.feedback}</th></tr></thead>
        <tbody>${grades
          .map(
            (
              g
            ) => `<tr><td class="text-truncate" style="max-width:200px">${g.student_id.slice(0, 8)}…</td>
        <td>${g.category}</td><td><strong>${g.score}</strong> / ${g.max_score}</td><td>${g.feedback ?? '—'}</td></tr>`
          )
          .join('')}</tbody></table></div></div></div>`
        : `<div class="alert alert-info">${d.empty}</div>`;
    } catch (e) {
      list.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#g-load') as HTMLButtonElement).addEventListener('click', () => void load());
  (el.querySelector('#g-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!courseSel.value) return;
    const data = await modalForm(d.grade, [
      { name: 'student_id', label: `${d.users} ID`, required: true },
      { name: 'category', label: d.status, value: 'general' },
      { name: 'score', label: d.total, type: 'number', required: true },
      { name: 'max_score', label: d.maxScore, type: 'number', value: '100' },
      { name: 'feedback', label: d.feedback, type: 'textarea' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/grades', {
        method: 'POST',
        body: JSON.stringify({
          course_id: courseSel.value,
          ...data,
          score: Number(data.score),
          max_score: Number(data.max_score),
          feedback: data.feedback || undefined,
        }),
      });
      toast(d.saved, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  await load();
}

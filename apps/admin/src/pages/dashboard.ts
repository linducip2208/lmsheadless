import { call, loadingHtml, errorHtml, currentOrgId } from '../lib.js';

export async function renderDashboard(el: HTMLElement): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const orgs = (await call<{ id: string; name: string }[]>('/api/v1/organizations')) as { id: string; name: string }[];
    const orgId = currentOrgId() ?? orgs[0]?.id;
    if (!orgId) {
      el.innerHTML = `<div class="alert alert-info">No organizations yet. Create one to get started.</div>`;
      return;
    }
    const summary = (await call<Record<string, number>>('/api/v1/reports/organization-summary', {}, { organization_id: orgId })) as Record<string, number>;
    const completion = (await call<{ course_id: string; title: string; enrolled: number; completed: number; completion_rate: number; avg_progress: number }[]>('/api/v1/reports/completion', {}, { organization_id: orgId })) as {
      course_id: string; title: string; enrolled: number; completed: number; completion_rate: number; avg_progress: number;
    }[];
    const cards: [string, string | number][] = [
      ['Students', summary.students ?? 0],
      ['Teachers', summary.teachers ?? 0],
      ['Courses', summary.courses ?? 0],
      ['Enrollments', summary.enrollments ?? 0],
      ['Avg progress', `${Math.round(Number(summary.avg_progress ?? 0))}%`],
      ['Avg quiz score', `${Math.round(Number(summary.avg_quiz_score ?? 0))}`],
    ];
    el.innerHTML = `
      <div class="row row-cards mb-3">
        ${cards.map(([l, v]) => `<div class="col-sm-6 col-lg-4"><div class="card"><div class="card-body"><div class="subheader">${l}</div><div class="h1 mb-0">${v}</div></div></div></div>`).join('')}
      </div>
      <div class="card"><div class="card-header"><h3 class="card-title">Course completion</h3></div>
      <div class="card-body">${completion.length ? completion.map((c) => `
        <div class="mb-3"><div class="d-flex justify-content-between"><strong>${c.title}</strong>
        <span class="text-muted">${c.completed}/${c.enrolled} completed · ${c.completion_rate}%</span></div>
        <div class="progress" role="progressbar" aria-label="${c.title} progress" aria-valuenow="${c.avg_progress}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width:${Math.min(100, c.avg_progress)}%"></div></div></div>`).join('') : '<p class="text-muted">No courses yet.</p>'}
      </div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

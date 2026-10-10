import { call, loadingHtml, errorHtml, currentOrgId, modalForm, t, esc } from '../lib.js';

export async function renderReports(el: HTMLElement): Promise<void> {
  const d = t();
  const orgId = currentOrgId();
  if (!orgId) {
    el.innerHTML = '<div class="alert alert-warning">Select an organization first.</div>';
    return;
  }
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap">
    <button class="btn btn-outline-primary" id="exp-grades">Export enrollments CSV</button>
    <button class="btn btn-outline-primary" id="exp-att">Export attendance CSV</button>
    <span class="text-muted small">Exports are injection-safe (formula cells neutralized).</span></div></div>
    <div id="rep-body">${loadingHtml()}</div>`;
  (el.querySelector('#exp-grades') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(d.exportEnrollments, [
      { name: 'course_id', label: d.courseId, required: true },
    ]);
    if (!data?.course_id) return;
    window.location.href = `/api/v1/reports/export?kind=enrollments&course_id=${encodeURIComponent(String(data.course_id))}&organization_id=${orgId}`;
  });
  (el.querySelector('#exp-att') as HTMLButtonElement).addEventListener('click', () => {
    window.location.href = `/api/v1/reports/export?kind=attendance&organization_id=${orgId}`;
  });
  const body = el.querySelector('#rep-body') as HTMLElement;
  try {
    const [summary, completion, attendance, teachers, engagement] = await Promise.all([
      call<Record<string, number>>(
        '/api/v1/reports/organization-summary',
        {},
        { organization_id: orgId }
      ),
      call<
        {
          title: string;
          enrolled: number;
          completed: number;
          completion_rate: number;
          avg_progress: number;
        }[]
      >('/api/v1/reports/completion', {}, { organization_id: orgId }),
      call<{
        sessions: number;
        students: { name: string; attendance_pct: number; recorded: number }[];
      }>('/api/v1/reports/attendance', {}, { organization_id: orgId }),
      call<{ name: string; courses: number; submissions_graded: number }[]>(
        '/api/v1/reports/teacher-activity',
        {},
        { organization_id: orgId }
      ),
      call<{
        by_day: { day: string; dau: number; actions: number }[];
        by_kind: { kind: string; n: number }[];
      }>('/api/v1/reports/engagement', {}, { organization_id: orgId, days: '14' }).catch(() => ({
        by_day: [],
        by_kind: [],
      })),
    ]);
    const bar = (pct: number) =>
      `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:${Math.min(100, pct)}%"></div></div>`;
    body.innerHTML = `<div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Overview</h3></div><div class="card-body">
      ${[
        ['Students', summary.students],
        ['Teachers', summary.teachers],
        ['Courses', summary.courses],
        ['Enrollments', summary.enrollments],
        ['Avg progress', `${Math.round(Number(summary.avg_progress ?? 0))}%`],
        ['Avg quiz score', Math.round(Number(summary.avg_quiz_score ?? 0))],
      ]
        .map(
          ([l, v]) =>
            `<div class="d-flex justify-content-between border-bottom py-1"><span>${l}</span><strong>${v}</strong></div>`
        )
        .join('')}
      </div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Engagement (14 days)</h3></div><div class="card-body">
      ${
        engagement.by_day
          .slice(-14)
          .map(
            (x) =>
              `<div class="d-flex justify-content-between border-bottom py-1"><span>${esc(x.day)}</span><span class="text-muted">${Number(x.dau)} users · ${Number(x.actions)} actions</span></div>`
          )
          .join('') || '<p class="text-muted">No activity yet.</p>'
      }
      <div class="mt-2 small">${engagement.by_kind
        .slice(0, 8)
        .map((k) => `<span class="badge bg-blue me-1">${esc(k.kind)} ${Number(k.n)}</span>`)
        .join('')}</div>
      </div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Teacher activity</h3></div><div class="card-body">
      ${teachers.map((t) => `<div class="d-flex justify-content-between border-bottom py-1"><span>${esc(t.name)}</span><span class="text-muted">${Number(t.courses)} courses · ${Number(t.submissions_graded)} graded</span></div>`).join('') || '<p class="text-muted">No teachers.</p>'}
      </div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Completion by course</h3></div><div class="card-body">
      ${completion.map((c) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${esc(c.title)}</span><span class="text-muted">${Number(c.completion_rate)}%</span></div>${bar(Number(c.completion_rate))}</div>`).join('') || '<p class="text-muted">No data.</p>'}
      </div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Attendance (${attendance.sessions} sessions)</h3></div><div class="card-body">
      ${
        attendance.students
          .slice(0, 20)
          .map(
            (s) =>
              `<div class="mb-2"><div class="d-flex justify-content-between"><span>${esc(s.name)}</span><span class="text-muted">${Number(s.attendance_pct)}%</span></div>${bar(Number(s.attendance_pct))}</div>`
          )
          .join('') || '<p class="text-muted">No data.</p>'
      }
      </div></div></div></div>`;
  } catch (e) {
    body.innerHTML = errorHtml(e);
  }
}

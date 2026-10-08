import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId } from '../lib.js';

export async function renderAttendance(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="card mb-3"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <button class="btn btn-primary" id="sess-new">New session</button>
    <span class="text-muted">Record present / absent / late / excused per student.</span></div></div>
    <div id="sess-list"></div><div id="sess-detail" class="mt-3"></div>`;
  const list = el.querySelector('#sess-list') as HTMLElement;
  const detail = el.querySelector('#sess-detail') as HTMLElement;
  const orgId = currentOrgId();
  if (!orgId) { el.innerHTML = '<div class="alert alert-warning">Select an organization first.</div>'; return; }
  const load = async () => {
    list.innerHTML = loadingHtml();
    try {
      const sessions = (await call<{ id: string; title: string; session_date: string; records: { student_id: string; status: string }[] }[]>('/api/v1/attendance/sessions', {}, { organization_id: orgId })) as {
        id: string; title: string; session_date: string; records: { student_id: string; status: string }[];
      }[];
      list.innerHTML = sessions.length ? `<div class="row row-cards">${sessions.map((s) => `<div class="col-md-6"><div class="card">
        <div class="card-body"><h3 class="card-title">${s.title}</h3>
        <div class="text-muted">${s.session_date} · ${s.records.length} records</div>
        <button class="btn btn-sm btn-primary mt-2" data-sess="${s.id}">Record attendance</button></div></div></div>`).join('')}</div>`
        : '<div class="alert alert-info">No sessions yet.</div>';
    } catch (e) { list.innerHTML = errorHtml(e); }
  };
  (el.querySelector('#sess-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm('New session', [
      { name: 'title', label: 'Title', required: true },
      { name: 'session_date', label: 'Date (YYYY-MM-DD)', value: new Date().toISOString().slice(0, 10), required: true },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/attendance/sessions', { method: 'POST', body: JSON.stringify({ organization_id: orgId, ...data }) });
      toast('Session created', 'success');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-sess]') as HTMLElement | null;
    if (b?.dataset.sess) void renderRecorder(detail, orgId, b.dataset.sess);
  });
  await load();
}

async function renderRecorder(el: HTMLElement, orgId: string, sessionId: string): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const students = (await call<{ id: string; name: string }[]>(`/api/v1/users`, {}, { organization_id: orgId, per_page: '100' }).catch(() => [])) as { id: string; name: string; email: string }[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Record attendance</h3>
      <button class="btn btn-sm btn-primary ms-auto" id="att-save">Save all</button></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr>
      <th scope="col">Student</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead><tbody>
      ${students.map((s) => `<tr><td>${s.name}<div class="text-muted small">${s.email}</div></td>
      <td><select class="form-select" data-st="${s.id}" aria-label="Status for ${s.name}">
        ${['present', 'absent', 'late', 'excused'].map((o) => `<option value="${o}">${o}</option>`).join('')}</select></td>
      <td><input class="form-control" data-note="${s.id}" placeholder="Optional note"></td></tr>`).join('') || '<tr><td colspan="3">No students.</td></tr>'}
      </tbody></table></div></div></div>`;
    (el.querySelector('#att-save') as HTMLButtonElement).addEventListener('click', async () => {
      const records = students.map((s) => ({
        student_id: s.id,
        status: (el.querySelector(`[data-st="${s.id}"]`) as HTMLSelectElement).value,
        note: (el.querySelector(`[data-note="${s.id}"]`) as HTMLInputElement).value || undefined,
      }));
      try {
        await call('/api/v1/attendance/records', { method: 'POST', body: JSON.stringify({ session_id: sessionId, records }) });
        toast(`Recorded ${records.length} entries`, 'success');
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

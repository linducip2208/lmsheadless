import { call, loadingHtml, errorHtml, toast, currentOrgId, t } from '../lib.js';

export async function renderScorm(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`; return; }
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><form id="sc-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="sc-file">SCORM 1.2 .zip</label><input id="sc-file" type="file" accept=".zip" class="form-control" required></div>
    <div><label class="form-label" for="sc-course">${d.courses} ID</label><input id="sc-course" class="form-control"></div>
    <button class="btn btn-primary">${d.upload}</button></form>
    <div id="sc-err"></div></div></div><div id="sc-list">${loadingHtml()}</div><div id="sc-detail" class="mt-3"></div>`;
  const load = async () => {
    const box = el.querySelector('#sc-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; title: string; package_version: number; entry_url: string }[]>('/api/v1/scorm/packages', {}, { organization_id: orgId })) as {
        id: string; title: string; package_version: number; entry_url: string;
      }[];
      box.innerHTML = items.length ? items.map((p) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${p.title} <span class="badge bg-blue">v${p.package_version}</span></h3>
        <p class="text-muted"><code>${p.entry_url}</code></p>
        <button class="btn btn-sm btn-outline-primary" data-att="${p.id}">${d.view}</button></div>
        <div data-a="${p.id}"></div></div>`).join('') : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) { box.innerHTML = errorHtml(e); }
  };
  (el.querySelector('#sc-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#sc-file') as HTMLInputElement;
    if (!input.files?.[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    form.append('organization_id', orgId);
    const course = (el.querySelector('#sc-course') as HTMLInputElement).value.trim();
    if (course) form.append('course_id', course);
    try {
      const token = localStorage.getItem('lms-token-fallback');
      const res = await fetch('/api/v1/scorm/upload', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form, credentials: 'same-origin' });
      const j = (await res.json()) as { success: boolean; error?: { message: string } };
      if (!j.success) throw new Error(j.error?.message ?? d.failed);
      toast(d.created, 'success');
      input.value = '';
      await load();
    } catch (err) {
      (el.querySelector('#sc-err') as HTMLElement).innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : d.failed}</div>`;
    }
  });
  el.querySelector('#sc-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-att]') as HTMLElement | null;
    if (!btn?.dataset.att) return;
    const box = el.querySelector(`[data-a="${btn.dataset.att}"]`) as HTMLElement;
    const rows = (await call<{ student_name: string; completion: string; success: string; score: number | null }[]>(`/api/v1/scorm/packages/${btn.dataset.att}/attempts`).catch(() => [])) as {
      student_name: string; completion: string; success: string; score: number | null;
    }[];
    box.innerHTML = `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.users}</th><th scope="col">${d.status}</th><th scope="col">${d.total}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r.student_name}</td><td>${r.completion}/${r.success}</td><td>${r.score ?? '—'}</td></tr>`).join('') || `<tr><td colspan="3">${d.empty}</td></tr>`}</tbody></table></div>`;
  });
  await load();
}

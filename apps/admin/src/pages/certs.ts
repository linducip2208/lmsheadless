import { call, loadingHtml, errorHtml, toast, currentOrgId } from '../lib.js';

export async function renderCerts(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="row row-cards">
    <div class="col-md-5"><div class="card"><div class="card-header"><h3 class="card-title">Issue certificate</h3></div>
    <div class="card-body"><form id="cert-form">
      <label class="form-label" for="cert-course">Course</label><select id="cert-course" class="form-select mb-2"></select>
      <label class="form-label" for="cert-student">Student ID</label><input id="cert-student" class="form-control mb-3" required>
      <button class="btn btn-primary w-100">Issue</button></form></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Verify</h3></div>
      <div class="card-body"><form id="verify-form" class="d-flex gap-2">
      <input id="verify-num" class="form-control" placeholder="CERT-..." required aria-label="Certificate number">
      <button class="btn btn-outline-primary">Check</button></form><div id="verify-out" class="mt-2"></div></div></div></div>
    <div class="col-md-7"><div class="card"><div class="card-header"><h3 class="card-title">Issued certificates</h3></div>
      <div class="card-body" id="cert-list">${loadingHtml()}</div></div></div></div>`;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>('/api/v1/courses', {}, orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }).catch(() => [])) as { id: string; title: string }[];
  (el.querySelector('#cert-course') as HTMLSelectElement).innerHTML = courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('');
  (el.querySelector('#cert-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = (await call<{ certificate_number: string }>('/api/v1/certificates/issue', { method: 'POST', body: JSON.stringify({ course_id: (el.querySelector('#cert-course') as HTMLSelectElement).value, student_id: (el.querySelector('#cert-student') as HTMLInputElement).value.trim() }) })) as { certificate_number: string };
      toast(`Issued: ${r.certificate_number}`, 'success');
      await loadList();
    } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
  });
  (el.querySelector('#verify-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = el.querySelector('#verify-out') as HTMLElement;
    const num = (el.querySelector('#verify-num') as HTMLInputElement).value.trim();
    try {
      const r = (await call(`/api/v1/certificates/verify/${encodeURIComponent(num)}`)) as { certificate: Record<string, string> };
      out.innerHTML = `<div class="alert alert-success">Valid — ${r.certificate.student_name} · ${r.certificate.course_title} · ${r.certificate.issued_at?.slice(0, 10) ?? ''}</div>`;
    } catch {
      out.innerHTML = '<div class="alert alert-danger">Not found.</div>';
    }
  });
  const loadList = async () => {
    const box = el.querySelector('#cert-list') as HTMLElement;
    try {
      const items = (await call<{ certificate_number: string; student_id: string; issued_at: string }[]>('/api/v1/certificates', {}, orgId ? { organization_id: orgId } : {})) as {
        certificate_number: string; student_id: string; issued_at: string;
      }[];
      box.innerHTML = items.length ? `<div class="list-group">${items.map((c) => `<div class="list-group-item"><code>${c.certificate_number}</code><div class="text-muted small">${c.issued_at?.slice(0, 10) ?? ''}</div></div>`).join('')}</div>` : '<p class="text-muted">None yet.</p>';
    } catch (e) { box.innerHTML = errorHtml(e); }
  };
  await loadList();
}

export async function renderFilesPage(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><form id="up-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="up-file">File (max 25MB)</label><input id="up-file" type="file" class="form-control" required></div>
    <button class="btn btn-primary">Upload</button></form><div class="text-muted small mt-1">Images, PDF, office docs, video. Executables and scripts are rejected.</div></div></div>
    <div class="card"><div class="card-header"><h3 class="card-title">Files</h3></div><div class="card-body" id="file-list">${loadingHtml()}</div></div>`;
  const load = async () => {
    const box = el.querySelector('#file-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; file_name: string; mime_type: string; size_bytes: number }[]>('/api/v1/files', {}, orgId ? { organization_id: orgId } : {})) as {
        id: string; file_name: string; mime_type: string; size_bytes: number;
      }[];
      box.innerHTML = items.length ? `<div class="list-group">${items.map((f) => `<div class="list-group-item d-flex gap-2 align-items-center">
        <div><strong>${f.file_name}</strong><div class="text-muted small">${f.mime_type} · ${(f.size_bytes / 1024).toFixed(1)} KB</div></div>
        <a class="btn btn-sm btn-outline-primary ms-auto" href="/api/v1/files/${f.id}/download">Download</a></div>`).join('')}</div>` : '<p class="text-muted">No files.</p>';
    } catch (e) { box.innerHTML = errorHtml(e); }
  };
  (el.querySelector('#up-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#up-file') as HTMLInputElement;
    if (!input.files?.[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    if (orgId) form.append('organization_id', orgId);
    try {
      // Multipart: bypass JSON client.
      const token = localStorage.getItem('lms-token-fallback');
      const res = await fetch('/api/v1/uploads', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form, credentials: 'same-origin' });
      const j = (await res.json()) as { success: boolean; error?: { message: string } };
      if (!j.success) throw new Error(j.error?.message ?? 'Upload failed');
      toast('Uploaded', 'success');
      input.value = '';
      await load();
    } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
  });
  await load();
}

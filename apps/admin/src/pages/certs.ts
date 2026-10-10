import {
  call,
  loadingHtml,
  errorHtml,
  toast,
  confirmDialog,
  currentOrgId,
  t,
  esc,
} from '../lib.js';

export async function renderCerts(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="row row-cards">
    <div class="col-md-5"><div class="card"><div class="card-header"><h3 class="card-title">${d.issue} ${d.certificates}</h3></div>
    <div class="card-body"><form id="cert-form">
      <label class="form-label" for="cert-course">${d.courses}</label><select id="cert-course" class="form-select mb-2"></select>
      <label class="form-label" for="cert-student">${d.users} ID</label><input id="cert-student" class="form-control mb-3" required>
      <button class="btn btn-primary w-100">${d.issue}</button></form></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.verify}</h3></div>
      <div class="card-body"><form id="verify-form" class="d-flex gap-2">
      <input id="verify-num" class="form-control" placeholder="CERT-..." required aria-label="CERT">
      <button class="btn btn-outline-primary">${d.verify}</button></form><div id="verify-out" class="mt-2"></div></div></div></div>
    <div class="col-md-7"><div class="card"><div class="card-header"><h3 class="card-title">${d.certificates}</h3></div>
      <div class="card-body" id="cert-list">${loadingHtml()}</div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.issue}</h3></div>
      <div class="card-body"><form id="bulk-form" class="d-flex gap-2">
      <input id="bulk-ids" class="form-control" placeholder="${d.users} IDs" required aria-label="IDs">
      <button class="btn btn-outline-primary">${d.issue}</button></form><div id="bulk-out" class="mt-2"></div></div></div></div></div>`;
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>(
    '/api/v1/courses',
    {},
    orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }
  ).catch(() => [])) as { id: string; title: string }[];
  (el.querySelector('#cert-course') as HTMLSelectElement).innerHTML = courses
    .map((c) => `<option value="${c.id}">${esc(c.title)}</option>`)
    .join('');
  (el.querySelector('#cert-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = (await call<{ certificate_number: string }>('/api/v1/certificates/issue', {
        method: 'POST',
        body: JSON.stringify({
          course_id: (el.querySelector('#cert-course') as HTMLSelectElement).value,
          student_id: (el.querySelector('#cert-student') as HTMLInputElement).value.trim(),
        }),
      })) as { certificate_number: string };
      toast(`Issued: ${r.certificate_number}`, 'success');
      await loadList();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed', 'danger');
    }
  });
  (el.querySelector('#verify-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = el.querySelector('#verify-out') as HTMLElement;
    const num = (el.querySelector('#verify-num') as HTMLInputElement).value.trim();
    try {
      const r = (await call(`/api/v1/certificates/verify/${encodeURIComponent(num)}`)) as {
        certificate: Record<string, string>;
      };
      out.innerHTML = `<div class="alert alert-success">Valid — ${esc(r.certificate.student_name)} · ${esc(r.certificate.course_title)} · ${esc(r.certificate.issued_at?.slice(0, 10) ?? '')}</div>`;
    } catch {
      out.innerHTML = '<div class="alert alert-danger">Not found.</div>';
    }
  });
  const loadList = async () => {
    const box = el.querySelector('#cert-list') as HTMLElement;
    try {
      const items = (await call<
        {
          id: string;
          certificate_number: string;
          student_id: string;
          issued_at: string;
          revoked_at: string | null;
        }[]
      >('/api/v1/certificates', {}, orgId ? { organization_id: orgId } : {})) as {
        id: string;
        certificate_number: string;
        student_id: string;
        issued_at: string;
        revoked_at: string | null;
      }[];
      box.innerHTML = items.length
        ? `<div class="list-group">${items
            .map(
              (c) => `<div class="list-group-item d-flex gap-2 align-items-center">
        <div><code>${esc(c.certificate_number)}</code><div class="text-muted small">${esc(c.issued_at?.slice(0, 10) ?? '')} ${c.revoked_at ? '· REVOKED' : ''}</div></div>
        ${!c.revoked_at ? `<button class="btn btn-sm btn-outline-danger ms-auto" data-revoke="${c.id}">${d.revoke}</button>` : ''}</div>`
            )
            .join('')}</div>`
        : `<p class="text-muted">${d.empty}</p>`;
      box.querySelectorAll('[data-revoke]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!(await confirmDialog(d.revoke, d.confirmDeleteBody, d.revoke, d.cancel))) return;
          await call(`/api/v1/certificates/${(b as HTMLElement).dataset.revoke}/revoke`, {
            method: 'POST',
            body: '{}',
          });
          toast(d.saved, 'success');
          await loadList();
        })
      );
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#bulk-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = (el.querySelector('#bulk-ids') as HTMLInputElement).value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const r = (await call<{ issued: number; skipped: number }>(
        '/api/v1/certificates/bulk-issue',
        {
          method: 'POST',
          body: JSON.stringify({
            course_id: (el.querySelector('#cert-course') as HTMLSelectElement).value,
            student_ids: ids,
          }),
        }
      )) as { issued: number; skipped: number };
      (el.querySelector('#bulk-out') as HTMLElement).innerHTML =
        `<div class="alert alert-success">Issued ${r.issued}, skipped ${r.skipped}.</div>`;
      await loadList();
    } catch (err) {
      (el.querySelector('#bulk-out') as HTMLElement).innerHTML = errorHtml(err);
    }
  });
  await loadList();
}

export async function renderFilesPage(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><form id="up-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label" for="up-file">${d.files} (25MB)</label><input id="up-file" type="file" class="form-control" required></div>
    <button class="btn btn-primary">${d.upload}</button></form></div></div>
    <div class="card"><div class="card-header"><h3 class="card-title">${d.files}</h3></div><div class="card-body" id="file-list">${loadingHtml()}</div></div>`;
  const load = async () => {
    const box = el.querySelector('#file-list') as HTMLElement;
    try {
      const items = (await call<
        { id: string; file_name: string; mime_type: string; size_bytes: number }[]
      >('/api/v1/files', {}, orgId ? { organization_id: orgId } : {})) as {
        id: string;
        file_name: string;
        mime_type: string;
        size_bytes: number;
      }[];
      box.innerHTML = items.length
        ? `<div class="list-group">${items
            .map(
              (f) => `<div class="list-group-item d-flex gap-2 align-items-center">
        <div><strong>${f.file_name}</strong><div class="text-muted small">${f.mime_type} · ${(f.size_bytes / 1024).toFixed(1)} KB</div></div>
        <a class="btn btn-sm btn-outline-primary ms-auto" href="/api/v1/files/${f.id}/download">${d.download}</a></div>`
            )
            .join('')}</div>`
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
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
      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
        credentials: 'same-origin',
      });
      const j = (await res.json()) as { success: boolean; error?: { message: string } };
      if (!j.success) throw new Error(j.error?.message ?? d.failed);
      toast(d.saved, 'success');
      input.value = '';
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

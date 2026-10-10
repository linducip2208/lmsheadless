import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId, t, esc } from '../lib.js';

export async function renderData(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  const tabs: [string, string][] = [
    ['imports', d.imports],
    ['ai', d.ai],
    ['exercises', d.exercises],
    ['email', d.email],
    ['invites', d.invites],
  ];
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    ${tabs.map(([k, label], i) => `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? ' active' : ''}" data-tab="${k}" role="tab">${label}</button></li>`).join('')}
    </ul><div id="d-body"></div>`;
  const body = el.querySelector('#d-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.tab ?? 'imports';
      if (tab === 'imports') void renderImports(body, orgId);
      else if (tab === 'ai') void renderAI(body, orgId);
      else if (tab === 'exercises') void renderExercises(body, orgId);
      else if (tab === 'email') void renderEmail(body, orgId);
      else void renderInvites(body, orgId);
    })
  );
  await renderImports(body, orgId);
}

async function renderImports(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><form id="im-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.status}</label><select id="im-kind" class="form-select"><option>users</option><option>enrollments</option><option>grades</option><option>attendance</option><option>courses</option></select></div>
    <div><label class="form-label">CSV</label><input id="im-file" type="file" accept=".csv" class="form-control" required></div>
    <label class="form-check"><input type="checkbox" id="im-dry" class="form-check-input" checked> Dry run</label>
    <button class="btn btn-primary">${d.verify}</button></form>
    <div id="im-out" class="mt-2"></div></div></div><div id="im-jobs"></div>`;
  const loadJobs = async () => {
    const box = el.querySelector('#im-jobs') as HTMLElement;
    const jobs = (await call<
      { id: string; kind: string; status: string; total_rows: number; processed_rows: number }[]
    >('/api/v1/imports', {}, { organization_id: orgId }).catch(() => [])) as {
      id: string;
      kind: string;
      status: string;
      total_rows: number;
      processed_rows: number;
    }[];
    box.innerHTML = jobs.length
      ? `<div class="card"><div class="card-header"><h3 class="card-title">${d.imports}</h3></div><div class="list-group list-group-flush">
      ${jobs
        .map(
          (
            j
          ) => `<div class="list-group-item d-flex gap-2"><span><strong>${j.kind}</strong> · <span class="badge ${j.status === 'done' ? 'bg-green' : j.status === 'partial' ? 'bg-yellow' : 'bg-blue'}">${j.status}</span> · ${j.processed_rows}/${j.total_rows}</span>
      <button class="btn btn-sm btn-outline-primary ms-auto" data-job="${j.id}">${d.view}</button></div><div data-jr="${j.id}"></div>`
        )
        .join('')}</div></div>`
      : '';
  };
  (el.querySelector('#im-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#im-file') as HTMLInputElement;
    if (!input.files?.[0]) return;
    const form = new FormData();
    form.append('kind', (el.querySelector('#im-kind') as HTMLSelectElement).value);
    form.append('organization_id', orgId);
    form.append(
      'dry_run',
      (el.querySelector('#im-dry') as HTMLInputElement).checked ? 'true' : 'false'
    );
    form.append('file', input.files[0]);
    const out = el.querySelector('#im-out') as HTMLElement;
    out.innerHTML = loadingHtml();
    try {
      const token = localStorage.getItem('lms-token-fallback');
      const res = await fetch('/api/v1/imports', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
        credentials: 'same-origin',
      });
      const j = (await res.json()) as {
        success: boolean;
        data?: {
          valid?: number;
          processed?: number;
          total?: number;
          errors?: { row: number; errors: string[] }[];
        };
        error?: { message: string };
      };
      if (!j.success || !j.data) throw new Error(j.error?.message ?? d.failed);
      out.innerHTML =
        `<div class="alert alert-info">${j.data.valid ?? j.data.processed} / ${j.data.total}. Errors: ${(j.data.errors ?? []).length}</div>` +
        (j.data.errors ?? [])
          .slice(0, 20)
          .map((x) => `<div class="small">Row ${Number(x.row)}: ${esc(x.errors.join('; '))}</div>`)
          .join('');
      await loadJobs();
    } catch (err) {
      out.innerHTML = errorHtml(err);
    }
  });
  el.querySelector('#im-jobs')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-job]') as HTMLElement | null;
    if (!btn?.dataset.job) return;
    const det = (await call<{
      error_report: { errors: { row: number; errors: string[] }[] } | null;
    }>(`/api/v1/imports/${btn.dataset.job}`)) as {
      error_report: { errors: { row: number; errors: string[] }[] } | null;
    };
    (el.querySelector(`[data-jr="${btn.dataset.job}"]`) as HTMLElement).innerHTML =
      (det.error_report?.errors ?? [])
        .slice(0, 30)
        .map((x) => `<div class="small">Row ${Number(x.row)}: ${esc(x.errors.join('; '))}</div>`)
        .join('') || `<div class="small text-muted">${d.empty}</div>`;
  });
  await loadJobs();
}

async function renderAI(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><h3 class="card-title">${d.ai} (BYOK)</h3>
    <form id="ai-cfg" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">Provider</label><select id="ai-p" class="form-select"><option value="disabled">disabled</option><option value="mock">mock</option><option value="openai-compatible">openai-compatible</option></select></div>
    <div><label class="form-label">Model</label><input id="ai-m" class="form-control"></div>
    <div><label class="form-label">URL</label><input id="ai-u" class="form-control" placeholder="https://..."></div>
    <div><label class="form-label">Key</label><input id="ai-k" type="password" class="form-control"></div>
    <div><label class="form-label">Limit</label><input id="ai-l" type="number" class="form-control" value="100"></div>
    <button class="btn btn-primary">${d.save}</button></form></div></div>
    <div class="card"><div class="card-header"><h3 class="card-title">${d.ai}</h3></div><div class="card-body">
    <form id="ai-job" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.status}</label><select id="ai-kind" class="form-select"><option>outline</option><option>lesson_draft</option><option>questions</option><option>summary</option></select></div>
    <div class="flex-fill"><label class="form-label">${d.title}</label><input id="ai-in" class="form-control" required></div>
    <button class="btn btn-primary">${d.create}</button></form><div id="ai-out" class="mt-2"></div></div></div>
    <div id="ai-jobs" class="mt-3"></div>`;
  const loadJobs = async () => {
    const box = el.querySelector('#ai-jobs') as HTMLElement;
    const jobs = (await call<{ id: string; kind: string; status: string }[]>(
      '/api/v1/ai/jobs',
      {},
      { organization_id: orgId }
    ).catch(() => [])) as { id: string; kind: string; status: string }[];
    box.innerHTML = jobs.length
      ? `<div class="card"><div class="card-header"><h3 class="card-title">${d.ai}</h3></div><div class="list-group list-group-flush">
      ${jobs
        .map(
          (
            j
          ) => `<div class="list-group-item d-flex gap-2"><span>${j.kind} · <span class="badge bg-blue">${j.status}</span></span>
      ${j.status === 'completed' ? `<button class="btn btn-sm btn-outline-green ms-auto" data-review="${j.id}">${d.approve}</button>` : ''}</div>`
        )
        .join('')}</div></div>`
      : '';
  };
  (el.querySelector('#ai-cfg') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          organization_id: orgId,
          provider: (el.querySelector('#ai-p') as HTMLSelectElement).value,
          model: (el.querySelector('#ai-m') as HTMLInputElement).value || undefined,
          base_url: (el.querySelector('#ai-u') as HTMLInputElement).value || undefined,
          api_key: (el.querySelector('#ai-k') as HTMLInputElement).value || undefined,
          monthly_limit: Number((el.querySelector('#ai-l') as HTMLInputElement).value),
        }),
      });
      toast(d.saved, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  (el.querySelector('#ai-job') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = el.querySelector('#ai-out') as HTMLElement;
    out.innerHTML = loadingHtml();
    try {
      const r = (await call<{ output?: string; note?: string }>('/api/v1/ai/jobs', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          kind: (el.querySelector('#ai-kind') as HTMLSelectElement).value,
          input_ref: (el.querySelector('#ai-in') as HTMLInputElement).value,
        }),
      })) as { output?: string; note?: string };
      out.innerHTML = `<div class="alert alert-warning">${esc(r.note ?? '')}</div><pre class="card card-body">${esc((r.output ?? '').slice(0, 4000))}</pre>`;
      await loadJobs();
    } catch (err) {
      out.innerHTML = errorHtml(err);
    }
  });
  el.querySelector('#ai-jobs')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-review]') as HTMLElement | null;
    if (!btn?.dataset.review) return;
    await call(`/api/v1/ai/jobs/${btn.dataset.review}/review`, {
      method: 'POST',
      body: JSON.stringify({ approve: true }),
    });
    toast(d.saved, 'success');
    await loadJobs();
  });
  await loadJobs();
}

async function renderExercises(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card"><div class="card-body"><form id="ex-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.courses} ID</label><input id="ex-c" class="form-control" required></div>
    <div><label class="form-label">${d.title}</label><input id="ex-t" class="form-control" required></div>
    <div class="flex-fill"><label class="form-label">${d.description}</label><textarea id="ex-s" class="form-control" required></textarea></div>
    <button class="btn btn-primary">${d.create}</button></form><div id="ex-out" class="mt-2"></div></div></div>`;
  (el.querySelector('#ex-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/exercises', {
        method: 'POST',
        body: JSON.stringify({
          course_id: (el.querySelector('#ex-c') as HTMLInputElement).value,
          title: (el.querySelector('#ex-t') as HTMLInputElement).value,
          statement: (el.querySelector('#ex-s') as HTMLTextAreaElement).value,
        }),
      });
      toast(d.created, 'success');
      (el.querySelector('#ex-form') as HTMLFormElement).reset();
    } catch (err) {
      (el.querySelector('#ex-out') as HTMLElement).innerHTML = errorHtml(err);
    }
  });
  void orgId;
}

async function renderEmail(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card mb-3"><div class="card-body"><h3 class="card-title">${d.email}</h3>
    <form id="em-form" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">To</label><input id="em-to" type="email" class="form-control" required></div>
    <div><label class="form-label">${d.title}</label><input id="em-sub" class="form-control" required></div>
    <div class="flex-fill"><label class="form-label">${d.description}</label><textarea id="em-body" class="form-control" required></textarea></div>
    <button class="btn btn-primary">${d.create}</button></form></div></div>
    <div id="em-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#em-list') as HTMLElement;
    try {
      const items = (await call<
        { id: string; to_email: string; subject: string; status: string }[]
      >('/api/v1/email/queue', {}, { organization_id: orgId })) as {
        id: string;
        to_email: string;
        subject: string;
        status: string;
      }[];
      box.innerHTML = items.length
        ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">To</th><th scope="col">${d.title}</th><th scope="col">${d.status}</th><th scope="col"></th></tr></thead><tbody>
        ${items
          .map(
            (
              m
            ) => `<tr><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td><td><span class="badge ${m.status === 'sent' ? 'bg-green' : 'bg-yellow'}">${esc(m.status)}</span></td>
        <td>${m.status !== 'sent' ? `<button class="btn btn-sm btn-outline-primary" data-send="${m.id}">${d.verify}</button>` : ''}</td></tr>`
          )
          .join('')}</tbody></table></div>`
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#em-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/email/queue', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          to: (el.querySelector('#em-to') as HTMLInputElement).value,
          subject: (el.querySelector('#em-sub') as HTMLInputElement).value,
          body: (el.querySelector('#em-body') as HTMLTextAreaElement).value,
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  el.querySelector('#em-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-send]') as HTMLElement | null;
    if (!btn?.dataset.send) return;
    try {
      await call(`/api/v1/email/queue/${btn.dataset.send}/send`, { method: 'POST', body: '{}' });
      toast(d.saved, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderInvites(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="row row-cards"><div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.invites}</h3></div>
    <div class="card-body"><form id="in-form">
    <label class="form-label">${d.email}</label><input id="in-email" type="email" class="form-control mb-2" required>
    <label class="form-label">${d.role}</label><select id="in-role" class="form-select mb-3"><option>student</option><option>teacher</option><option>parent</option><option>staff</option><option>organization_admin</option></select>
    <button class="btn btn-primary w-100">${d.create}</button></form><div id="in-out" class="mt-2"></div></div></div></div>
    <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Departments</h3></div>
    <div class="card-body"><form id="ou-form" class="d-flex gap-2">
    <input id="ou-name" class="form-control" placeholder="${d.name}" required><button class="btn btn-outline-primary">${d.create}</button></form>
    <div id="ou-list" class="mt-2"></div></div></div></div></div>`;
  (el.querySelector('#in-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = (await call<{ invite_url: string }>(`/api/v1/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          email: (el.querySelector('#in-email') as HTMLInputElement).value,
          role: (el.querySelector('#in-role') as HTMLSelectElement).value,
        }),
      })) as { invite_url: string };
      (el.querySelector('#in-out') as HTMLElement).innerHTML =
        `<div class="alert alert-success"><code>${esc(r.invite_url)}</code></div>`;
    } catch (err) {
      (el.querySelector('#in-out') as HTMLElement).innerHTML = errorHtml(err);
    }
  });
  const loadUnits = async () => {
    const box = el.querySelector('#ou-list') as HTMLElement;
    const units = (await call<{ id: string; name: string }[]>(
      '/api/v1/org-units',
      {},
      { organization_id: orgId }
    ).catch(() => [])) as { id: string; name: string }[];
    box.innerHTML =
      units
        .map(
          (u) => `<div class="d-flex gap-2 align-items-center mb-1"><span>${esc(u.name)}</span>
      <button class="btn btn-sm btn-outline-primary ms-auto" data-unit="${u.id}">${d.create}</button></div>`
        )
        .join('') || `<p class="text-muted">${d.empty}</p>`;
  };
  (el.querySelector('#ou-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/org-units', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          name: (el.querySelector('#ou-name') as HTMLInputElement).value,
        }),
      });
      toast(d.created, 'success');
      await loadUnits();
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  el.querySelector('#ou-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-unit]') as HTMLElement | null;
    if (!btn?.dataset.unit) return;
    try {
      const data = await modalForm(d.members, [
        { name: 'user_id', label: `${d.users} ID`, required: true },
      ]);
      if (!data) return;
      await call(`/api/v1/org-units/${btn.dataset.unit}/members`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      toast(d.created, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await loadUnits();
}

import { call, crud, loadingHtml, errorHtml, toast, modalForm, getMe } from '../lib.js';

export async function renderOrgs(el: HTMLElement): Promise<void> {
  const me = getMe();
  el.innerHTML = `<div id="org-list"></div><div id="org-detail" class="mt-3"></div>`;
  const list = el.querySelector('#org-list') as HTMLElement;
  const detail = el.querySelector('#org-detail') as HTMLElement;
  await crud(list, {
    endpoint: '/api/v1/organizations',
    cols: [
      { key: 'name', label: 'Name' },
      { key: 'slug', label: 'Slug' },
      {
        key: '__m', label: '', render: (_v, row) => `<button class="btn btn-sm btn-outline-primary" data-manage="${String(row.id)}">Manage</button>`,
      },
    ],
    createTitle: 'Create organization',
    createFields: me?.isSuperAdmin
      ? [
          { name: 'name', label: 'Name', required: true },
          { name: 'slug', label: 'Slug (lowercase, dashes)', required: true },
          { name: 'description', label: 'Description', type: 'textarea' },
        ]
      : undefined,
    onChanged: () => { detail.innerHTML = ''; },
  });
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-manage]') as HTMLElement | null;
    if (btn?.dataset.manage) void showOrgDetail(detail, btn.dataset.manage);
  });
}

async function showOrgDetail(el: HTMLElement, orgId: string): Promise<void> {
  el.innerHTML = `<div class="card"><div class="card-body">${loadingHtml()}</div></div>`;
  try {
    const [members, branding] = await Promise.all([
      call<{ id: string; email: string; name: string; role: string }[]>(`/api/v1/organizations/${orgId}/members`),
      call<Record<string, string>>(`/api/v1/organizations/${orgId}/branding`).catch((): Record<string, string> => ({})),
    ]);
    el.innerHTML = `<div class="row row-cards">
      <div class="col-md-7"><div class="card"><div class="card-header d-flex align-items-center">
        <h3 class="card-title">Members</h3><button class="btn btn-sm btn-primary ms-auto" id="add-member">Add member</button></div>
        <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead>
        <tbody>${members.map((m) => `<tr><td>${m.name}</td><td>${m.email}</td><td><span class="badge bg-blue">${m.role}</span></td></tr>`).join('') || '<tr><td colspan="3">No members.</td></tr>'}</tbody></table></div></div></div></div>
      <div class="col-md-5"><div class="card"><div class="card-header"><h3 class="card-title">Branding (white-label)</h3></div>
        <div class="card-body"><dl class="row">
        ${['app_name', 'primary_color', 'secondary_color', 'logo_url', 'footer_text', 'support_email'].map((k) => `<dt class="col-5">${k}</dt><dd class="col-7">${branding[k] ?? '—'}</dd>`).join('')}
        </dl><button class="btn btn-outline-primary" id="edit-brand">Edit branding</button></div></div></div></div>`;
    (el.querySelector('#add-member') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Add member', [
        { name: 'user_id', label: 'User ID', required: true },
        { name: 'role', label: 'Role (organization_admin/teacher/student/parent/staff)', required: true },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}/members`, { method: 'POST', body: JSON.stringify(data) });
        toast('Member added', 'success');
        await showOrgDetail(el, orgId);
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    });
    (el.querySelector('#edit-brand') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Edit branding', [
        { name: 'app_name', label: 'Application name', value: branding.app_name ?? '' },
        { name: 'primary_color', label: 'Primary color (#hex)', value: branding.primary_color ?? '#206bc4' },
        { name: 'secondary_color', label: 'Secondary color (#hex)', value: branding.secondary_color ?? '' },
        { name: 'logo_url', label: 'Logo URL', value: branding.logo_url ?? '' },
        { name: 'footer_text', label: 'Footer text', value: branding.footer_text ?? '' },
        { name: 'support_email', label: 'Support email', value: branding.support_email ?? '' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}`, { method: 'PUT', body: JSON.stringify({ settings: data }) });
        toast('Branding saved', 'success');
        await showOrgDetail(el, orgId);
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

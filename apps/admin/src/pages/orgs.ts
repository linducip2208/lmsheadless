import { call, crud, loadingHtml, errorHtml, toast, modalForm, getMe, t } from '../lib.js';

export async function renderOrgs(el: HTMLElement): Promise<void> {
  const me = getMe();
  const d = t();
  el.innerHTML = `<div id="org-list"></div><div id="org-detail" class="mt-3"></div>`;
  const list = el.querySelector('#org-list') as HTMLElement;
  const detail = el.querySelector('#org-detail') as HTMLElement;
  await crud(list, {
    endpoint: '/api/v1/organizations',
    cols: [
      { key: 'name', label: d.name },
      { key: 'slug', label: 'Slug' },
      {
        key: '__m',
        label: '',
        render: (_v, row) =>
          `<button class="btn btn-sm btn-outline-primary" data-manage="${String(row.id)}">${d.manage}</button>`,
      },
    ],
    createTitle: `${d.create} ${d.organizations}`,
    createFields: me?.isSuperAdmin
      ? [
          { name: 'name', label: d.name, required: true },
          { name: 'slug', label: 'Slug', required: true },
          { name: 'description', label: d.description, type: 'textarea' },
        ]
      : undefined,
    onChanged: () => {
      detail.innerHTML = '';
    },
  });
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-manage]') as HTMLElement | null;
    if (btn?.dataset.manage) void showOrgDetail(detail, btn.dataset.manage);
  });
}

async function showOrgDetail(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card"><div class="card-body">${loadingHtml()}</div></div>`;
  try {
    const [members, branding] = await Promise.all([
      call<{ id: string; email: string; name: string; role: string }[]>(
        `/api/v1/organizations/${orgId}/members`
      ),
      call<Record<string, string>>(`/api/v1/organizations/${orgId}/branding`).catch(
        (): Record<string, string> => ({})
      ),
    ]);
    el.innerHTML = `<div class="row row-cards">
      <div class="col-md-7"><div class="card"><div class="card-header d-flex align-items-center">
        <h3 class="card-title">${d.members}</h3><button class="btn btn-sm btn-primary ms-auto" id="add-member">${d.create}</button></div>
        <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.name}</th><th scope="col">${d.email}</th><th scope="col">${d.role}</th></tr></thead>
        <tbody>${members.map((m) => `<tr><td>${m.name}</td><td>${m.email}</td><td><span class="badge bg-blue">${m.role}</span></td></tr>`).join('') || `<tr><td colspan="3">${d.empty}</td></tr>`}</tbody></table></div></div></div></div>
      <div class="col-md-5"><div class="card"><div class="card-header"><h3 class="card-title">${d.branding}</h3></div>
        <div class="card-body"><dl class="row">
        ${['app_name', 'primary_color', 'secondary_color', 'logo_url', 'footer_text', 'support_email'].map((k) => `<dt class="col-5">${k}</dt><dd class="col-7">${branding[k] ?? '—'}</dd>`).join('')}
        </dl><button class="btn btn-outline-primary" id="edit-brand">${d.edit} ${d.branding}</button></div></div></div></div>`;
    (el.querySelector('#add-member') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(d.members, [
        { name: 'user_id', label: `${d.users} ID`, required: true },
        { name: 'role', label: d.role, required: true },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}/members`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast(d.created, 'success');
        await showOrgDetail(el, orgId);
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    (el.querySelector('#edit-brand') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(`${d.edit} ${d.branding}`, [
        { name: 'app_name', label: 'app_name', value: branding.app_name ?? '' },
        {
          name: 'primary_color',
          label: 'primary_color',
          value: branding.primary_color ?? '#206bc4',
        },
        {
          name: 'secondary_color',
          label: 'secondary_color',
          value: branding.secondary_color ?? '',
        },
        { name: 'logo_url', label: 'logo_url', value: branding.logo_url ?? '' },
        { name: 'footer_text', label: 'footer_text', value: branding.footer_text ?? '' },
        { name: 'support_email', label: 'support_email', value: branding.support_email ?? '' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}`, {
          method: 'PUT',
          body: JSON.stringify({ settings: data }),
        });
        toast(d.saved, 'success');
        await showOrgDetail(el, orgId);
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    const advBtn = document.createElement('button');
    advBtn.className = 'btn btn-outline-secondary mt-2';
    advBtn.textContent = d.settings;
    advBtn.addEventListener('click', async () => {
      const data = await modalForm(d.settings, [
        { name: 'currency', label: 'currency', value: branding.currency ?? 'IDR' },
        { name: 'tax_rate', label: 'tax_rate', value: branding.tax_rate ?? '0' },
        {
          name: 'commission_rate',
          label: 'commission_rate',
          value: branding.commission_rate ?? '70',
        },
        {
          name: 'affiliate_expiry_days',
          label: 'affiliate_expiry_days',
          value: branding.affiliate_expiry_days ?? '30',
        },
        {
          name: 'cert_validity_days',
          label: 'cert_validity_days',
          value: branding.cert_validity_days ?? '0',
        },
        {
          name: 'require_approval',
          label: 'require_approval',
          value: branding.require_approval ?? 'false',
        },
        { name: 'email_api_url', label: 'email_api_url' },
        { name: 'payment_midtrans_server_key', label: 'payment_midtrans_server_key' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}`, {
          method: 'PUT',
          body: JSON.stringify({ settings: data }),
        });
        toast(d.saved, 'success');
        await showOrgDetail(el, orgId);
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    el.querySelector('.col-md-5 .card-body')?.appendChild(advBtn);
    const domBtn = document.createElement('button');
    domBtn.className = 'btn btn-outline-secondary mt-2 ms-2';
    domBtn.textContent = d.manage;
    domBtn.addEventListener('click', async () => {
      const data = await modalForm(d.manage, [
        { name: 'hostname', label: 'hostname', required: true },
      ]);
      if (!data?.hostname) return;
      try {
        const r = (await call(`/api/v1/organizations/${orgId}/domain`, {
          method: 'POST',
          body: JSON.stringify(data),
        })) as {
          verification: { type: string; host: string; value: string };
          note: string;
        };
        toast(d.saved, 'success');
        alert(`DNS TXT:\n${r.verification.host}\n${r.verification.value}\n\n${r.note}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    el.querySelector('.col-md-5 .card-body')?.appendChild(domBtn);
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

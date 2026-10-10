import {
  call,
  loadingHtml,
  errorHtml,
  toast,
  modalForm,
  confirmDialog,
  getMe,
  currentOrgId,
  t,
} from '../lib.js';
import { subscribePush } from '@lms/ui';

export async function renderSettings(el: HTMLElement): Promise<void> {
  const me = getMe();
  const d = t();
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    <li class="nav-item" role="presentation"><button class="nav-link active" data-tab="acct" role="tab">${d.account}</button></li>
    <li class="nav-item" role="presentation"><button class="nav-link" data-tab="org" role="tab">${d.organizations}</button></li>
    ${me?.isSuperAdmin ? `<li class="nav-item" role="presentation"><button class="nav-link" data-tab="global" role="tab">${d.settings}</button></li><li class="nav-item" role="presentation"><button class="nav-link" data-tab="audit" role="tab">${d.auditLog}</button></li>` : ''}
    </ul><div id="set-body"></div>`;
  const body = el.querySelector('#set-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.tab ?? 'acct';
      if (tab === 'acct') void renderAccount(body);
      else if (tab === 'org') void renderOrgSettings(body);
      else if (tab === 'global') void renderGlobal(body);
      else void renderAudit(body);
    })
  );
  await renderAccount(body);
}

async function renderAccount(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const sessions = (await call<{ id: string; created_at: string; expires_at: string }[]>(
      '/api/v1/auth/sessions'
    )) as { id: string; created_at: string; expires_at: string }[];
    const prefs = (await call<Record<string, boolean>>(
      '/api/v1/notification-preferences'
    )) as Record<string, boolean>;
    el.innerHTML = `<div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.changePassword}</h3></div>
      <div class="card-body"><form id="pw-form">
      <label class="form-label" for="pw-cur">${d.password}</label><input id="pw-cur" type="password" class="form-control mb-2" required autocomplete="current-password">
      <label class="form-label" for="pw-new">${d.password}</label><input id="pw-new" type="password" class="form-control mb-3" required autocomplete="new-password">
      <button class="btn btn-primary w-100">${d.changePassword}</button></form></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.preferences}</h3></div>
      <div class="card-body" id="prefs">${Object.keys(prefs)
        .map(
          (k) =>
            `<label class="form-check"><input type="checkbox" class="form-check-input" data-pref="${k}" ${prefs[k] ? 'checked' : ''}>${k}</label>`
        )
        .join('')}
      <button class="btn btn-primary mt-2" id="prefs-save">${d.save}</button></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">${d.push}</h3></div>
      <div class="card-body">
      <button class="btn btn-outline-primary" id="push-sub">${d.enablePush}</button> <span id="push-status" class="text-muted small ms-2"></span></div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">${d.sessions} (${sessions.length})</h3>
      <button class="btn btn-sm btn-outline-danger ms-auto" id="sess-all">${d.revokeAll}</button></div>
      <div class="list-group list-group-flush">${
        sessions
          .map(
            (s) => `<div class="list-group-item d-flex align-items-center">
      <div><div>${s.created_at?.slice(0, 16).replace('T', ' ') ?? ''}</div><div class="text-muted small">${s.expires_at?.slice(0, 16).replace('T', ' ') ?? ''}</div></div>
      <button class="btn btn-sm btn-outline-danger ms-auto" data-revoke="${s.id}">${d.revoke}</button></div>`
          )
          .join('') || `<div class="list-group-item">${d.empty}</div>`
      }</div></div></div></div>`;
    (el.querySelector('#pw-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call('/api/v1/auth/password/change', {
          method: 'POST',
          body: JSON.stringify({
            current_password: (el.querySelector('#pw-cur') as HTMLInputElement).value,
            new_password: (el.querySelector('#pw-new') as HTMLInputElement).value,
          }),
        });
        toast(d.saved, 'success');
        (el.querySelector('#pw-form') as HTMLFormElement).reset();
      } catch (err) {
        toast(err instanceof Error ? err.message : d.failed, 'danger');
      }
    });
    (el.querySelector('#prefs-save') as HTMLButtonElement).addEventListener('click', async () => {
      const data: Record<string, boolean> = {};
      el.querySelectorAll('[data-pref]').forEach((c) => {
        data[(c as HTMLElement).dataset.pref ?? ''] = (c as HTMLInputElement).checked;
      });
      await call('/api/v1/notification-preferences', { method: 'PUT', body: JSON.stringify(data) });
      toast(d.saved, 'success');
    });
    el.querySelectorAll('[data-revoke]').forEach((b) =>
      b.addEventListener('click', async () => {
        await call(`/api/v1/auth/sessions/${(b as HTMLElement).dataset.revoke}`, {
          method: 'DELETE',
        });
        toast(d.saved, 'success');
        await renderAccount(el);
      })
    );
    (el.querySelector('#sess-all') as HTMLButtonElement).addEventListener('click', async () => {
      if (!(await confirmDialog(d.revokeAll, d.confirmDeleteBody, d.revoke, d.cancel))) return;
      await call('/api/v1/auth/sessions/revoke-all', { method: 'POST', body: '{}' });
      toast(d.saved, 'success');
      await renderAccount(el);
    });
    (el.querySelector('#push-sub') as HTMLButtonElement).addEventListener('click', async () => {
      const status = el.querySelector('#push-status') as HTMLElement;
      status.textContent = 'Requesting…';
      const result = await subscribePush();
      status.textContent = result === 'subscribed' ? d.saved : result;
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderOrgSettings(el: HTMLElement): Promise<void> {
  const d = t();
  const orgId = currentOrgId();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  el.innerHTML = loadingHtml();
  try {
    const branding = (await call<Record<string, string>>(
      `/api/v1/organizations/${orgId}/branding`
    )) as Record<string, string>;
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.organizations} ${d.branding}</h3></div>
      <div class="card-body"><dl class="row">${Object.entries(branding)
        .map(([k, v]) => `<dt class="col-sm-4">${k}</dt><dd class="col-sm-8">${v || '—'}</dd>`)
        .join('')}</dl>
      <button class="btn btn-primary" id="brand-edit">${d.edit}</button></div></div>`;
    (el.querySelector('#brand-edit') as HTMLButtonElement).addEventListener('click', async () => {
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
        { name: 'favicon_url', label: 'favicon_url', value: branding.favicon_url ?? '' },
        { name: 'footer_text', label: 'footer_text', value: branding.footer_text ?? '' },
        { name: 'support_email', label: 'support_email', value: branding.support_email ?? '' },
        { name: 'locale', label: d.locale, value: branding.locale ?? 'en' },
        { name: 'timezone', label: d.timezone, value: branding.timezone ?? 'Asia/Jakarta' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}`, {
          method: 'PUT',
          body: JSON.stringify({ settings: data }),
        });
        toast(d.saved, 'success');
        await renderOrgSettings(el);
      } catch (err) {
        toast(err instanceof Error ? err.message : d.failed, 'danger');
      }
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderGlobal(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const settings = (await call<Record<string, string>>('/api/v1/settings')) as Record<
      string,
      string
    >;
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.settings}</h3></div>
      <div class="card-body"><dl class="row">${Object.entries(settings)
        .map(([k, v]) => `<dt class="col-sm-4">${k}</dt><dd class="col-sm-8">${v}</dd>`)
        .join('')}</dl>
      <button class="btn btn-primary" id="g-edit">${d.edit}</button></div></div>`;
    (el.querySelector('#g-edit') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(d.settings, [
        { name: 'app_name', label: 'app_name', value: settings.app_name ?? 'LMS Headless' },
        {
          name: 'registration_enabled',
          label: 'registration_enabled',
          value: settings.registration_enabled ?? 'true',
        },
        {
          name: 'maintenance_mode',
          label: 'maintenance_mode',
          value: settings.maintenance_mode ?? 'false',
        },
        { name: 'support_email', label: 'support_email', value: settings.support_email ?? '' },
        { name: 'footer_text', label: 'footer_text', value: settings.footer_text ?? '' },
      ]);
      if (!data) return;
      await call('/api/v1/settings', { method: 'PUT', body: JSON.stringify(data) });
      toast(d.saved, 'success');
      await renderGlobal(el);
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderAudit(el: HTMLElement): Promise<void> {
  const d = t();
  const orgId = currentOrgId();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  el.innerHTML = loadingHtml();
  try {
    const logs = (await call<
      {
        id: string;
        actor_id: string | null;
        action: string;
        entity: string | null;
        entity_id: string | null;
        created_at: string;
      }[]
    >('/api/v1/audit-logs', {}, { organization_id: orgId, per_page: '50' })) as {
      id: string;
      actor_id: string | null;
      action: string;
      entity: string | null;
      entity_id: string | null;
      created_at: string;
    }[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.auditLog}</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr>
      <th scope="col">${d.date}</th><th scope="col">${d.status}</th><th scope="col">Entity</th><th scope="col">Actor</th></tr></thead>
      <tbody>${
        logs
          .map(
            (
              l
            ) => `<tr><td>${l.created_at?.slice(0, 19).replace('T', ' ') ?? ''}</td><td><code>${l.action}</code></td>
      <td>${l.entity ?? '—'} ${l.entity_id?.slice(0, 8) ?? ''}</td><td>${l.actor_id?.slice(0, 8) ?? 'system'}</td></tr>`
          )
          .join('') || `<tr><td colspan="4">${d.empty}</td></tr>`
      }</tbody></table></div></div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

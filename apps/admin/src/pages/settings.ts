import { call, loadingHtml, errorHtml, toast, modalForm, confirmDialog, getMe, currentOrgId } from '../lib.js';
import { subscribePush } from '@lms/ui';

export async function renderSettings(el: HTMLElement): Promise<void> {
  const me = getMe();
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    <li class="nav-item" role="presentation"><button class="nav-link active" data-tab="acct" role="tab">Account</button></li>
    <li class="nav-item" role="presentation"><button class="nav-link" data-tab="org" role="tab">Organization</button></li>
    ${me?.isSuperAdmin ? '<li class="nav-item" role="presentation"><button class="nav-link" data-tab="global" role="tab">Global</button></li><li class="nav-item" role="presentation"><button class="nav-link" data-tab="audit" role="tab">Audit log</button></li>' : ''}
    </ul><div id="set-body"></div>`;
  const body = el.querySelector('#set-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const tab = (b as HTMLElement).dataset.tab ?? 'acct';
    if (tab === 'acct') void renderAccount(body);
    else if (tab === 'org') void renderOrgSettings(body);
    else if (tab === 'global') void renderGlobal(body);
    else void renderAudit(body);
  }));
  await renderAccount(body);
}

async function renderAccount(el: HTMLElement): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const sessions = (await call<{ id: string; created_at: string; expires_at: string }[]>('/api/v1/auth/sessions')) as { id: string; created_at: string; expires_at: string }[];
    const prefs = (await call<Record<string, boolean>>('/api/v1/notification-preferences')) as Record<string, boolean>;
    el.innerHTML = `<div class="row row-cards">
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Change password</h3></div>
      <div class="card-body"><form id="pw-form">
      <label class="form-label" for="pw-cur">Current password</label><input id="pw-cur" type="password" class="form-control mb-2" required autocomplete="current-password">
      <label class="form-label" for="pw-new">New password (min 8 chars)</label><input id="pw-new" type="password" class="form-control mb-3" required autocomplete="new-password">
      <button class="btn btn-primary w-100">Change password</button></form>
      <p class="text-muted small mt-2">Changing your password revokes all other sessions.</p></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Notification preferences</h3></div>
      <div class="card-body" id="prefs">${Object.keys(prefs).map((k) => `<label class="form-check"><input type="checkbox" class="form-check-input" data-pref="${k}" ${prefs[k] ? 'checked' : ''}>${k}</label>`).join('')}
      <button class="btn btn-primary mt-2" id="prefs-save">Save preferences</button></div></div>
      <div class="card mt-3"><div class="card-header"><h3 class="card-title">Push notifications</h3></div>
      <div class="card-body"><p class="text-muted small">Requires the deployment to configure VAPID keys. Without keys, subscription is cleanly disabled — nothing is faked.</p>
      <button class="btn btn-outline-primary" id="push-sub">Enable push</button> <span id="push-status" class="text-muted small ms-2"></span></div></div></div>
      <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Active sessions (${sessions.length})</h3>
      <button class="btn btn-sm btn-outline-danger ms-auto" id="sess-all">Revoke all</button></div>
      <div class="list-group list-group-flush">${sessions.map((s) => `<div class="list-group-item d-flex align-items-center">
      <div><div>Since ${s.created_at?.slice(0, 16).replace('T', ' ') ?? ''}</div><div class="text-muted small">Expires ${s.expires_at?.slice(0, 16).replace('T', ' ') ?? ''}</div></div>
      <button class="btn btn-sm btn-outline-danger ms-auto" data-revoke="${s.id}">Revoke</button></div>`).join('') || '<div class="list-group-item">No active sessions.</div>'}</div></div></div></div>`;
    (el.querySelector('#pw-form') as HTMLFormElement).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await call('/api/v1/auth/password/change', { method: 'POST', body: JSON.stringify({ current_password: (el.querySelector('#pw-cur') as HTMLInputElement).value, new_password: (el.querySelector('#pw-new') as HTMLInputElement).value }) });
        toast('Password changed. Please log in again if asked.', 'success');
        (el.querySelector('#pw-form') as HTMLFormElement).reset();
      } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
    });
    (el.querySelector('#prefs-save') as HTMLButtonElement).addEventListener('click', async () => {
      const data: Record<string, boolean> = {};
      el.querySelectorAll('[data-pref]').forEach((c) => { data[(c as HTMLElement).dataset.pref ?? ''] = (c as HTMLInputElement).checked; });
      await call('/api/v1/notification-preferences', { method: 'PUT', body: JSON.stringify(data) });
      toast('Preferences saved', 'success');
    });
    el.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      await call(`/api/v1/auth/sessions/${(b as HTMLElement).dataset.revoke}`, { method: 'DELETE' });
      toast('Session revoked', 'success');
      await renderAccount(el);
    }));
    (el.querySelector('#sess-all') as HTMLButtonElement).addEventListener('click', async () => {
      if (!(await confirmDialog('Revoke all sessions?', 'You will stay logged in on this device via a fresh token.'))) return;
      await call('/api/v1/auth/sessions/revoke-all', { method: 'POST', body: '{}' });
      toast('All sessions revoked', 'success');
      await renderAccount(el);
    });
    (el.querySelector('#push-sub') as HTMLButtonElement).addEventListener('click', async () => {
      const status = el.querySelector('#push-status') as HTMLElement;
      status.textContent = 'Requesting…';
      const result = await subscribePush();
      status.textContent = result === 'subscribed' ? 'Push enabled for this device.' : result === 'no-keys' ? 'Push not configured on this server (no VAPID keys).' : result === 'unsupported' ? 'Push not supported in this browser.' : 'Permission denied.';
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderOrgSettings(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization selected.</div>'; return; }
  el.innerHTML = loadingHtml();
  try {
    const branding = (await call<Record<string, string>>(`/api/v1/organizations/${orgId}/branding`)) as Record<string, string>;
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Organization branding & settings</h3></div>
      <div class="card-body"><dl class="row">${Object.entries(branding).map(([k, v]) => `<dt class="col-sm-4">${k}</dt><dd class="col-sm-8">${v || '—'}</dd>`).join('')}</dl>
      <button class="btn btn-primary" id="brand-edit">Edit</button></div></div>`;
    (el.querySelector('#brand-edit') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Organization branding', [
        { name: 'app_name', label: 'Application name', value: branding.app_name ?? '' },
        { name: 'primary_color', label: 'Primary color', value: branding.primary_color ?? '#206bc4' },
        { name: 'secondary_color', label: 'Secondary color', value: branding.secondary_color ?? '' },
        { name: 'logo_url', label: 'Logo URL', value: branding.logo_url ?? '' },
        { name: 'favicon_url', label: 'Favicon URL', value: branding.favicon_url ?? '' },
        { name: 'footer_text', label: 'Footer text', value: branding.footer_text ?? '' },
        { name: 'support_email', label: 'Support email', value: branding.support_email ?? '' },
        { name: 'locale', label: 'Locale (en/id)', value: branding.locale ?? 'en' },
        { name: 'timezone', label: 'Timezone', value: branding.timezone ?? 'Asia/Jakarta' },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/organizations/${orgId}`, { method: 'PUT', body: JSON.stringify({ settings: data }) });
        toast('Saved', 'success');
        await renderOrgSettings(el);
      } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderGlobal(el: HTMLElement): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const settings = (await call<Record<string, string>>('/api/v1/settings')) as Record<string, string>;
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Global settings</h3></div>
      <div class="card-body"><dl class="row">${Object.entries(settings).map(([k, v]) => `<dt class="col-sm-4">${k}</dt><dd class="col-sm-8">${v}</dd>`).join('')}</dl>
      <button class="btn btn-primary" id="g-edit">Edit</button>
      <p class="text-muted small mt-2">Registration toggle, maintenance mode, defaults. The setup lock cannot be toggled.</p></div></div>`;
    (el.querySelector('#g-edit') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Global settings', [
        { name: 'app_name', label: 'Application name', value: settings.app_name ?? 'LMS Headless' },
        { name: 'registration_enabled', label: 'Registration enabled (true/false)', value: settings.registration_enabled ?? 'true' },
        { name: 'maintenance_mode', label: 'Maintenance mode (true/false)', value: settings.maintenance_mode ?? 'false' },
        { name: 'support_email', label: 'Support email', value: settings.support_email ?? '' },
        { name: 'footer_text', label: 'Footer text', value: settings.footer_text ?? '' },
      ]);
      if (!data) return;
      await call('/api/v1/settings', { method: 'PUT', body: JSON.stringify(data) });
      toast('Saved', 'success');
      await renderGlobal(el);
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderAudit(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  if (!orgId) { el.innerHTML = '<div class="alert alert-warning">No organization selected.</div>'; return; }
  el.innerHTML = loadingHtml();
  try {
    const logs = (await call<{ id: string; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; created_at: string }[]>('/api/v1/audit-logs', {}, { organization_id: orgId, per_page: '50' })) as {
      id: string; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; created_at: string;
    }[];
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Audit log</h3></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table"><thead><tr>
      <th scope="col">Time</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Actor</th></tr></thead>
      <tbody>${logs.map((l) => `<tr><td>${l.created_at?.slice(0, 19).replace('T', ' ') ?? ''}</td><td><code>${l.action}</code></td>
      <td>${l.entity ?? '—'} ${l.entity_id?.slice(0, 8) ?? ''}</td><td>${l.actor_id?.slice(0, 8) ?? 'system'}</td></tr>`).join('') || '<tr><td colspan="4">No events yet.</td></tr>'}</tbody></table></div></div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

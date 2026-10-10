import { call, loadingHtml, errorHtml, toast, t } from '../lib.js';

export async function renderSystem(el: HTMLElement): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const s = (await call<Record<string, unknown>>('/api/v1/system/status')) as Record<
      string,
      unknown
    >;
    const row = (k: string, v: unknown, good: boolean) =>
      `<div class="d-flex justify-content-between border-bottom py-1"><span>${k}</span><strong><span class="badge ${good ? 'bg-green' : 'bg-yellow'}">${String(v)}</span></strong></div>`;
    el.innerHTML = `<div class="row row-cards"><div class="col-md-6"><div class="card">
      <div class="card-header"><h3 class="card-title">System</h3></div><div class="card-body">
      ${row('database', s.database, s.database === 'ok')}
      ${row('tables', s.tables, true)}
      ${row('storage', s.storage_driver, true)}
      ${row('maintenance', s.maintenance_mode, s.maintenance_mode !== true)}
      ${row('registration', s.registration_enabled, true)}
      ${row('setup', s.setup_completed, s.setup_completed === true)}
      </div></div></div>
      <div class="col-md-6"><div class="card">
      <div class="card-header"><h3 class="card-title">Integrations</h3></div><div class="card-body">
      ${row('email', s.email_configured ? 'configured' : 'not configured', !!s.email_configured)}
      ${row('payments', s.payments_configured ? 'configured' : 'not configured', !!s.payments_configured)}
      ${row('push', s.push_configured ? 'configured' : 'not configured', !!s.push_configured)}
      ${row('ai_organizations', s.ai_organizations, true)}
      </div></div></div></div>
      <p class="text-muted small mt-2">Unconfigured integrations report honestly and their features stay inert until keys are set. See docs/deployment.md.</p>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

export async function renderAlerts(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="al-run">Run rules</button><div id="al-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#al-list') as HTMLElement;
    const orgId = localStorage.getItem('admin-org');
    if (!orgId) {
      box.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
      return;
    }
    try {
      const items = (await call<
        { id: string; kind: string; message: string; created_at: string }[]
      >('/api/v1/alerts', {}, { organization_id: orgId })) as {
        id: string;
        kind: string;
        message: string;
        created_at: string;
      }[];
      box.innerHTML = items.length
        ? items
            .map(
              (
                a
              ) => `<div class="card mb-2"><div class="card-body d-flex gap-2 align-items-center flex-wrap">
        <div><span class="badge bg-yellow">${a.kind}</span><div class="small text-muted">${a.message} · ${a.created_at?.slice(0, 16).replace('T', ' ') ?? ''}</div></div>
        <button class="btn btn-sm btn-outline-primary ms-auto" data-dis="${a.id}">${d.dismiss ?? 'Dismiss'}</button></div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#al-run') as HTMLButtonElement).addEventListener('click', async () => {
    const orgId = localStorage.getItem('admin-org');
    if (!orgId) return;
    try {
      await call('/api/v1/alerts/rules', {}, { organization_id: orgId });
      toast(d.saved, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  el.querySelector('#al-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-dis]') as HTMLElement | null;
    if (!btn?.dataset.dis) return;
    const { modalForm } = await import('../lib.js');
    const data = await modalForm(d.dismiss ?? 'Dismiss', [
      { name: 'note', label: 'Note', type: 'textarea' },
    ]);
    try {
      await call(`/api/v1/alerts/${btn.dataset.dis}/dismiss`, {
        method: 'POST',
        body: JSON.stringify(data ?? {}),
      });
      toast(d.saved, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

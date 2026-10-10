import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId, t, esc } from '../lib.js';

export async function renderLive(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  el.innerHTML = `<button class="btn btn-primary mb-2" id="lv-new">${d.schedule}</button>
    <a class="btn btn-outline-secondary mb-2 ms-2" href="/api/v1/live-sessions.ics?organization_id=${orgId}">.ics</a>
    <div id="lv-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#lv-list') as HTMLElement;
    try {
      const items = (await call<
        {
          id: string;
          title: string;
          provider: string;
          starts_at: string;
          status: string;
          meeting_url: string | null;
        }[]
      >('/api/v1/live-sessions', {}, { organization_id: orgId })) as {
        id: string;
        title: string;
        provider: string;
        starts_at: string;
        status: string;
        meeting_url: string | null;
      }[];
      box.innerHTML = items.length
        ? items
            .map(
              (s) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${esc(s.title)}</h3>
        <p class="text-muted">${esc(s.starts_at?.slice(0, 16).replace('T', ' ') ?? '')} · ${esc(s.provider)} · <span class="badge ${s.status === 'scheduled' ? 'bg-green' : 'bg-red'}">${esc(s.status)}</span></p>
        ${s.meeting_url ? `<a href="${esc(s.meeting_url)}" target="_blank" rel="noopener">${d.view}</a>` : ''}
        <div class="mt-2 d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-att="${s.id}">${d.record}</button>
        ${s.status === 'scheduled' ? `<button class="btn btn-sm btn-outline-secondary" data-resched="${s.id}">${d.edit}</button><button class="btn btn-sm btn-outline-danger" data-cancel="${s.id}">${d.cancel}</button>` : ''}</div></div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#lv-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(d.schedule, [
      { name: 'title', label: d.title, required: true },
      { name: 'course_id', label: `${d.courses} ID` },
      {
        name: 'provider',
        label: d.status,
        options: [
          { value: 'jitsi', label: 'Jitsi' },
          { value: 'meet', label: 'Google Meet' },
          { value: 'zoom', label: 'Zoom' },
          { value: 'custom', label: 'Custom' },
        ],
      },
      { name: 'meeting_url', label: 'URL' },
      { name: 'starts_at', label: d.date, required: true },
      { name: 'ends_at', label: d.date, required: true },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/live-sessions', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ...data,
          course_id: data.course_id || undefined,
          meeting_url: data.meeting_url || undefined,
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  el.querySelector('#lv-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    try {
      if (btn.dataset.cancel) {
        await call(`/api/v1/live-sessions/${btn.dataset.cancel}/cancel`, {
          method: 'POST',
          body: '{}',
        });
        toast(d.saved, 'success');
        await load();
      } else if (btn.dataset.resched) {
        const data = await modalForm(d.edit, [
          { name: 'starts_at', label: d.date, required: true },
          { name: 'ends_at', label: d.date, required: true },
        ]);
        if (!data) return;
        await call(`/api/v1/live-sessions/${btn.dataset.resched}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        toast(d.saved, 'success');
        await load();
      } else if (btn.dataset.att) {
        const data = await modalForm(d.record, [
          { name: 'user_ids', label: `${d.users} IDs`, type: 'textarea', required: true },
        ]);
        if (!data) return;
        await call(`/api/v1/live-sessions/${btn.dataset.att}/attendance`, {
          method: 'POST',
          body: JSON.stringify({
            user_ids: data.user_ids
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          }),
        });
        toast(d.saved, 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

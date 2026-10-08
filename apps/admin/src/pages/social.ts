import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId } from '../lib.js';

export async function renderSocial(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    <li class="nav-item" role="presentation"><button class="nav-link active" data-tab="ann" role="tab">Announcements</button></li>
    <li class="nav-item" role="presentation"><button class="nav-link" data-tab="dis" role="tab">Discussions</button></li></ul>
    <div id="social-body"></div>`;
  const body = el.querySelector('#social-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    if ((b as HTMLElement).dataset.tab === 'ann') void renderAnnouncements(body, orgId ?? '');
    else void renderDiscussions(body);
  }));
  await renderAnnouncements(body, orgId ?? '');
}

async function renderAnnouncements(el: HTMLElement, orgId: string): Promise<void> {
  el.innerHTML = loadingHtml();
  if (!orgId) { el.innerHTML = '<div class="alert alert-warning">Select an organization first.</div>'; return; }
  try {
    const items = (await call<{ id: string; title: string; body: string; course_id: string | null; created_at: string }[]>('/api/v1/announcements', {}, { organization_id: orgId })) as {
      id: string; title: string; body: string; course_id: string | null; created_at: string;
    }[];
    el.innerHTML = `<div class="mb-2"><button class="btn btn-primary" id="ann-new">New announcement</button></div>
      ${items.map((a) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${a.title}</h3>
      <p class="text-muted">${a.body.slice(0, 500)}</p>
      <span class="text-muted small">${a.created_at?.slice(0, 16).replace('T', ' ') ?? ''}${a.course_id ? ` · course ${a.course_id.slice(0, 8)}` : ''}</span></div></div>`).join('') || '<div class="alert alert-info">No announcements.</div>'}`;
    (el.querySelector('#ann-new') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('New announcement', [
        { name: 'title', label: 'Title', required: true },
        { name: 'body', label: 'Body', type: 'textarea', required: true },
        { name: 'course_id', label: 'Course ID (optional)' },
      ]);
      if (!data) return;
      try {
        await call('/api/v1/announcements', { method: 'POST', body: JSON.stringify({ organization_id: orgId, ...data, course_id: data.course_id || undefined }) });
        toast('Published (members notified)', 'success');
        await renderAnnouncements(el, orgId);
      } catch (e) { toast(e instanceof Error ? e.message : 'Failed', 'danger'); }
    });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderDiscussions(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const courses = (await call<{ id: string; title: string }[]>('/api/v1/courses', {}, orgId ? { organization_id: orgId, per_page: '100' } : { per_page: '100' }).catch(() => [])) as { id: string; title: string }[];
  el.innerHTML = `<div class="mb-2 d-flex gap-2"><select id="d-course" class="form-select w-auto">${courses.map((c) => `<option value="${c.id}">${c.title}</option>`).join('')}</select>
    <button class="btn btn-primary" id="d-new">New thread</button></div><div id="d-list"></div>`;
  const sel = el.querySelector('#d-course') as HTMLSelectElement;
  const list = el.querySelector('#d-list') as HTMLElement;
  const load = async () => {
    if (!sel.value) { list.innerHTML = ''; return; }
    list.innerHTML = loadingHtml();
    try {
      const threads = (await call<{ id: string; title: string; body: string }[]>('/api/v1/discussions', {}, { course_id: sel.value })) as { id: string; title: string; body: string }[];
      list.innerHTML = threads.map((t) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${t.title}</h3>
        <p>${t.body.slice(0, 400)}</p><div data-replies="${t.id}"></div></div></div>`).join('') || '<div class="alert alert-info">No threads.</div>';
      for (const t of threads) {
        const box = list.querySelector(`[data-replies="${t.id}"]`) as HTMLElement;
        const replies = (await call<{ body: string }[]>(`/api/v1/discussions/${t.id}/replies`).catch(() => [])) as { body: string }[];
        box.innerHTML = replies.map((r) => `<div class="alert alert-info py-1">${r.body.slice(0, 300)}</div>`).join('');
      }
    } catch (e) { list.innerHTML = errorHtml(e); }
  };
  sel.addEventListener('change', () => void load());
  (el.querySelector('#d-new') as HTMLButtonElement).addEventListener('click', async () => {
    if (!sel.value) { toast('Select a course first', 'warning'); return; }
    const data = await modalForm('New thread', [
      { name: 'title', label: 'Title', required: true },
      { name: 'body', label: 'Message', type: 'textarea', required: true },
    ]);
    if (!data) return;
    await call('/api/v1/discussions', { method: 'POST', body: JSON.stringify({ course_id: sel.value, ...data }) });
    toast('Thread created', 'success');
    await load();
  });
  await load();
}

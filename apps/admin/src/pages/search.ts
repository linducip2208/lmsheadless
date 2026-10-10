import { call, loadingHtml, errorHtml, toast, currentOrgId, t, esc } from '../lib.js';

export async function renderSearch(el: HTMLElement, query: string): Promise<void> {
  const d = t();
  const orgId = currentOrgId();
  el.innerHTML = loadingHtml();
  if (!orgId || !query) {
    el.innerHTML = !orgId
      ? `<div class="alert alert-warning">${d.selectOrg}</div>`
      : `<p class="text-muted">${d.empty}</p>`;
    return;
  }
  try {
    const r = (await call<{
      courses: { id: string; title: string; code: string }[];
      lessons: { id: string; title: string; course_id: string }[];
      announcements: { id: string; title: string }[];
      users: { id: string; name: string; email: string }[];
    }>('/api/v1/search', {}, { q: query, organization_id: orgId })) as {
      courses: { id: string; title: string; code: string }[];
      lessons: { id: string; title: string; course_id: string }[];
      announcements: { id: string; title: string }[];
      users: { id: string; name: string; email: string }[];
    };
    const section = (title: string, items: string) =>
      `<div class="card mb-3"><div class="card-header"><h3 class="card-title">${title}</h3></div><div class="list-group list-group-flush">${items || `<div class="list-group-item text-muted">${d.empty}</div>`}</div></div>`;
    el.innerHTML =
      `<h2>${d.search}: “${esc(query.slice(0, 60))}”</h2>` +
      section(
        d.courses,
        r.courses
          .map(
            (c) =>
              `<a class="list-group-item list-group-item-action" href="#/courses/${c.id}"><strong>${esc(c.title)}</strong> <span class="text-muted">${esc(c.code)}</span></a>`
          )
          .join('')
      ) +
      section(
        d.lessons,
        r.lessons.map((l) => `<div class="list-group-item">${esc(l.title)}</div>`).join('')
      ) +
      section(
        d.users,
        r.users
          .map(
            (u) =>
              `<a class="list-group-item list-group-item-action" href="#/users/${encodeURIComponent(u.email)}"><strong>${esc(u.name)}</strong> <span class="text-muted">${esc(u.email)}</span></a>`
          )
          .join('')
      ) +
      section(
        d.announcements,
        r.announcements.map((a) => `<div class="list-group-item">${esc(a.title)}</div>`).join('')
      );
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

export async function renderNotifications(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.notifications}</h3>
    <button class="btn btn-sm btn-outline-primary ms-auto" id="notif-all">${d.markAllRead}</button></div>
    <div class="card-body" id="notif-list">${loadingHtml()}</div></div>`;
  const load = async () => {
    const box = el.querySelector('#notif-list') as HTMLElement;
    try {
      const items = (await call<
        { id: string; title: string; body: string; is_read: number; created_at: string }[]
      >('/api/v1/notifications')) as {
        id: string;
        title: string;
        body: string;
        is_read: number;
        created_at: string;
      }[];
      box.innerHTML = items.length
        ? items
            .map(
              (
                n
              ) => `<div class="alert ${n.is_read ? 'alert-info' : 'alert-success'} py-2"><strong>${esc(n.title)}</strong><br>${esc(n.body.slice(0, 500))}
          <div class="mt-1"><span class="text-muted small">${n.created_at?.slice(0, 16).replace('T', ' ') ?? ''}</span>
          ${n.is_read ? '' : ` <button class="btn btn-sm btn-outline-primary" data-read="${n.id}">${d.markRead}</button>`}</div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#notif-all') as HTMLButtonElement).addEventListener('click', async () => {
    await call('/api/v1/notifications/read-all', { method: 'POST', body: '{}' });
    toast(d.saved, 'success');
    await load();
    await refreshBadge();
  });
  el.querySelector('#notif-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-read]') as HTMLElement | null;
    if (!btn?.dataset.read) return;
    await call(`/api/v1/notifications/${btn.dataset.read}/read`, { method: 'POST', body: '{}' });
    await load();
    await refreshBadge();
  });
  await load();
}

async function refreshBadge(): Promise<void> {
  try {
    const r = (await call<{ unread: number }>('/api/v1/notifications/unread-count')) as {
      unread: number;
    };
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (r.unread > 0) {
      badge.textContent = String(Math.min(99, r.unread));
      badge.classList.remove('d-none');
    } else {
      badge.classList.add('d-none');
    }
  } catch {
    /* ignore */
  }
}

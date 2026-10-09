import { call, loadingHtml, errorHtml, toast, t } from '../lib.js';

export async function renderRoles(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const [roles, catalog] = await Promise.all([
      call<{ role: string; permissions: string[] }[]>('/api/v1/roles'),
      call<{ key: string; description: string }[]>('/api/v1/permissions'),
    ]);
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">${d.roles}</h3>
      <span class="ms-2 text-muted">Enforced server-side on every request</span></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table table-hover">
      <thead><tr><th scope="col">Permission</th>${roles.map((r) => `<th scope="col">${r.role}<br><button class="btn btn-sm btn-outline-primary mt-1" data-editrole="${r.role}">${d.edit}</button></th>`).join('')}</tr></thead>
      <tbody>${catalog.map((p) => `<tr><td><code>${p.key}</code><div class="text-muted small">${p.description}</div></td>${roles.map((r) => `<td>${r.permissions.includes(p.key) ? '<span class="badge bg-green" aria-label="allowed">✓</span>' : '<span class="text-muted" aria-label="denied">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div></div><div class="alert alert-info mt-2">Custom mapping is saved via <code>PUT /roles/:role/permissions</code> (super_admin only); unknown keys are rejected and enforcement reads the database.</div>`;
    el.querySelectorAll('[data-editrole]').forEach((b) =>
      b.addEventListener('click', async () => {
        const role = (b as HTMLElement).dataset.editrole ?? '';
        if (role === 'super_admin') {
          toast('super_admin is immutable', 'warning');
          return;
        }
        const current = roles.find((r) => r.role === role)?.permissions ?? [];
        const input = prompt(`Permissions for ${role} (comma separated):`, current.join(','));
        if (input === null) return;
        try {
          await call(`/api/v1/roles/${role}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({
              permissions: input
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }),
          });
          toast(d.saved, 'success');
          await renderRoles(el);
        } catch (e) {
          toast(e instanceof Error ? e.message : d.failed, 'danger');
        }
      })
    );
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

import { call, loadingHtml, errorHtml } from '../lib.js';

export async function renderRoles(el: HTMLElement): Promise<void> {
  el.innerHTML = loadingHtml();
  try {
    const [roles, catalog] = await Promise.all([
      call<{ role: string; permissions: string[] }[]>('/api/v1/roles'),
      call<{ key: string; description: string }[]>('/api/v1/permissions'),
    ]);
    el.innerHTML = `<div class="card"><div class="card-header"><h3 class="card-title">Roles & permissions</h3>
      <span class="ms-2 text-muted">Enforced server-side on every request</span></div>
      <div class="card-body p-0"><div class="table-responsive"><table class="table card-table table-hover">
      <thead><tr><th scope="col">Permission</th>${roles.map((r) => `<th scope="col">${r.role}</th>`).join('')}</tr></thead>
      <tbody>${catalog.map((p) => `<tr><td><code>${p.key}</code><div class="text-muted small">${p.description}</div></td>${roles.map((r) => `<td>${r.permissions.includes(p.key) ? '<span class="badge bg-green" aria-label="allowed">✓</span>' : '<span class="text-muted" aria-label="denied">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

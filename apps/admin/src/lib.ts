import { createClient, toast, modalForm, confirmDialog, formatDateTime, type ApiClient } from '@lms/ui';

export { toast, modalForm, confirmDialog, formatDateTime };
export type { ApiClient };
export type { Me } from '@lms/ui';

export const client: ApiClient = createClient({ orgKey: 'admin-org', loginRedirect: '#/login' });
export const { call, login, logout, ensureMe, getMe, myOrgs } = client;
export const currentOrgId = (): string | null => client.currentOrg();
export const setCurrentOrgId = (id: string): void => client.setCurrentOrg(id);

export function applyBranding(brand: Record<string, string>): void {
  if (brand.app_name) document.title = `${brand.app_name} Admin`;
  if (brand.primary_color) document.documentElement.style.setProperty('--tblr-primary', brand.primary_color);
}

export function loadingHtml(msg = 'Loading...'): string {
  return `<div class="d-flex align-items-center gap-2 py-4"><div class="spinner-border spinner-border-sm" role="status" aria-label="Loading"></div><span>${msg}</span></div>`;
}

export function emptyHtml(msg = 'No data yet.'): string {
  return `<div class="empty"><div class="empty-img"></div><p class="empty-title">${msg}</p></div>`;
}

export function errorHtml(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'Something went wrong.';
  return `<div class="alert alert-danger" role="alert">${msg}</div>`;
}

export function tableHtml(rows: Record<string, unknown>[], cols: { key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => string }[]): string {
  if (!rows.length) return emptyHtml();
  const td = (r: Record<string, unknown>, c: (typeof cols)[number]) => {
    const v = r[c.key];
    if (c.render) return c.render(v, r);
    return String(v ?? '—').slice(0, 140);
  };
  return `<div class="table-responsive"><table class="table table-vcenter card-table table-hover"><thead><tr>${cols.map((c) => `<th scope="col">${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${td(r, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export interface CrudConfig {
  endpoint: string;
  cols: { key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => string }[];
  query?: Record<string, string>;
  createTitle?: string;
  createFields?: Parameters<typeof modalForm>[1];
  editFields?: (row: Record<string, unknown>) => Parameters<typeof modalForm>[1];
  deletable?: (row: Record<string, unknown>) => boolean;
  onChanged?: () => void;
}

// Generic searchable table + create/edit/delete with toasts + confirms.
export async function crud(el: HTMLElement, cfg: CrudConfig): Promise<void> {
  el.innerHTML = `<div class="card"><div class="card-header d-flex gap-2 align-items-center flex-wrap">
    <input id="crud-q" class="form-control w-auto" type="search" placeholder="Search..." aria-label="Search">
    ${cfg.createFields ? `<button class="btn btn-primary ms-auto" id="crud-new">Create</button>` : ''}
    </div><div class="card-body p-0" id="crud-body">${loadingHtml()}</div></div>`;
  const body = el.querySelector('#crud-body') as HTMLElement;
  const load = async () => {
    const q = (el.querySelector('#crud-q') as HTMLInputElement | null)?.value ?? '';
    try {
      const res = (await call<unknown>(cfg.endpoint, {}, { ...(cfg.query ?? {}), ...(q ? { q } : {}) })) as
        | unknown[]
        | { items: unknown[] };
      const rows = (Array.isArray(res) ? res : res.items ?? []) as Record<string, unknown>[];
      const withActions = cfg.editFields || cfg.deletable;
      const cols = withActions ? [...cfg.cols, { key: '__a', label: '', render: (_v: unknown, row: Record<string, unknown>) => {
        const id = String(row.id ?? '');
        return `<span class="d-flex gap-1">${cfg.editFields ? `<button class="btn btn-sm btn-outline-primary" data-edit="${id}">Edit</button>` : ''}${cfg.deletable && cfg.deletable(row) ? `<button class="btn btn-sm btn-outline-danger" data-del="${id}">Delete</button>` : ''}</span>`;
      } }] : cfg.cols;
      body.innerHTML = tableHtml(rows, cols);
      body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
        const row = rows.find((x) => String(x.id) === (b as HTMLElement).dataset.edit) ?? {};
        const data = await modalForm('Edit', cfg.editFields?.(row) ?? []);
        if (!data) return;
        try {
          await call(`${cfg.endpoint}/${(b as HTMLElement).dataset.edit}`, { method: 'PATCH', body: JSON.stringify(data) });
          toast('Saved', 'success');
          cfg.onChanged?.();
          await load();
        } catch (e) { toast(e instanceof Error ? e.message : 'Save failed', 'danger'); }
      }));
      body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete?', 'This action cannot be undone.', 'Delete'))) return;
        try {
          await call(`${cfg.endpoint}/${(b as HTMLElement).dataset.del}`, { method: 'DELETE' });
          toast('Deleted', 'success');
          cfg.onChanged?.();
          await load();
        } catch (e) { toast(e instanceof Error ? e.message : 'Delete failed', 'danger'); }
      }));
    } catch (e) {
      body.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#crud-q') as HTMLInputElement | null)?.addEventListener('input', () => void load());
  el.querySelector('#crud-new')?.addEventListener('click', async () => {
    const data = await modalForm(cfg.createTitle ?? 'Create', cfg.createFields ?? []);
    if (!data) return;
    try {
      await call(cfg.endpoint, { method: 'POST', body: JSON.stringify(data) });
      toast('Created', 'success');
      cfg.onChanged?.();
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Create failed', 'danger'); }
  });
  await load();
}

export function fmt(iso: string | null | undefined, locale = 'en'): string {
  return formatDateTime(iso, locale);
}

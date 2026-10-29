import {
  createClient,
  toast,
  modalForm,
  confirmDialog,
  formatDateTime,
  getAccessToken,
  downloadFile,
  esc,
  type ApiClient,
} from '@lms/ui';
import { getDict, applyLocaleDir, type Dict } from './i18n.js';

export { toast, modalForm, confirmDialog, formatDateTime, getAccessToken, downloadFile, esc };
export type { ApiClient };
export type { Me } from '@lms/ui';

export function lang(): string {
  return localStorage.getItem('admin-locale') ?? 'en';
}

applyLocaleDir(lang());

export function t(): Dict {
  return getDict(lang());
}

export const client: ApiClient = createClient({ orgKey: 'admin-org', loginRedirect: '#/login' });
export const { call, login, logout, ensureMe, getMe, myOrgs } = client;
export const currentOrgId = (): string | null => client.currentOrg();
export const setCurrentOrgId = (id: string): void => client.setCurrentOrg(id);

export function applyBranding(brand: Record<string, string>): void {
  if (brand.app_name) document.title = `${brand.app_name} Admin`;
  if (brand.primary_color)
    document.documentElement.style.setProperty('--tblr-primary', brand.primary_color);
}

export function loadingHtml(msg?: string): string {
  const m = msg ?? t().loading;
  return `<div class="card lms-skeleton" role="status" aria-label="${esc(m)}"><div class="card-body"><div class="sk" style="width:38%"></div><div class="sk" style="width:92%"></div><div class="sk" style="width:81%"></div><div class="sk" style="width:64%"></div><span class="visually-hidden">${esc(m)}</span></div></div>`;
}

export function emptyHtml(msg?: string, hint?: string): string {
  return `<div class="lms-empty"><div class="lms-empty-ico" aria-hidden="true">◌</div><p class="empty-title">${msg ?? t().empty}</p>${hint ? `<p class="mb-0 small">${hint}</p>` : ''}</div>`;
}

/** Consistent enterprise page header. Purely presentational — no route/API change. */
export function pageHeader(opts: {
  title: string;
  desc?: string;
  actions?: string;
}): string {
  return `<div class="lms-page-head d-flex align-items-start gap-3 flex-wrap"><div class="flex-grow-1"><h2>${opts.title}</h2>${opts.desc ? `<p>${opts.desc}</p>` : ''}</div>${opts.actions ? `<div class="lms-actions">${opts.actions}</div>` : ''}</div>`;
}

/** Stat card with icon + contextual line. Values must come from real API data. */
export function statCard(opts: {
  label: string;
  value: string | number;
  context?: string;
  icon?: string;
}): string {
  return `<div class="col-sm-6 col-lg-4"><div class="card lms-stat"><div class="card-body d-flex gap-3 align-items-start"><div class="lms-stat-ico" aria-hidden="true">${opts.icon ?? '●'}</div><div><div class="subheader">${opts.label}</div><div class="h1 mb-0">${opts.value}</div>${opts.context ? `<small class="lms-context">${opts.context}</small>` : ''}</div></div></div></div>`;
}

export function errorHtml(e: unknown): string {
  // Server messages can echo request input (e.g. validation detail), so the
  // message is escaped at this single choke point.
  const msg = e instanceof Error ? e.message : t().error;
  return `<div class="alert alert-danger" role="alert">${esc(msg)}</div>`;
}

export function tableHtml(
  rows: Record<string, unknown>[],
  cols: {
    key: string;
    label: string;
    render?: (v: unknown, row: Record<string, unknown>) => string;
  }[]
): string {
  if (!rows.length) return emptyHtml();
  const td = (r: Record<string, unknown>, c: (typeof cols)[number]) => {
    const v = r[c.key];
    // Custom renderers produce intentional HTML; default cells are escaped.
    if (c.render) return c.render(v, r);
    return esc(String(v ?? '—').slice(0, 140));
  };
  return `<div class="table-responsive"><table class="table table-vcenter card-table table-hover mb-0"><thead><tr>${cols.map((c) => `<th scope="col">${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${td(r, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export interface CrudConfig {
  endpoint: string;
  cols: {
    key: string;
    label: string;
    render?: (v: unknown, row: Record<string, unknown>) => string;
  }[];
  query?: Record<string, string>;
  createTitle?: string;
  createFields?: Parameters<typeof modalForm>[1];
  editFields?: (row: Record<string, unknown>) => Parameters<typeof modalForm>[1];
  deletable?: (row: Record<string, unknown>) => boolean;
  onChanged?: () => void;
}

// Generic searchable table + create/edit/delete with toasts + confirms.
export async function crud(el: HTMLElement, cfg: CrudConfig): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card"><div class="card-header d-flex gap-2 align-items-center flex-wrap lms-toolbar">
    <input id="crud-q" class="form-control w-auto" type="search" placeholder="${d.search}" aria-label="${d.search}">
    <span class="lms-count" id="crud-count" aria-live="polite"></span>
    ${cfg.createFields ? `<button class="btn btn-primary ms-auto" id="crud-new"><span aria-hidden="true">+ </span>${d.create}</button>` : ''}
    </div><div class="card-body p-0" id="crud-body">${loadingHtml()}</div></div>`;
  const body = el.querySelector('#crud-body') as HTMLElement;
  const labels = { save: d.save, cancel: d.cancel };
  const load = async () => {
    const q = (el.querySelector('#crud-q') as HTMLInputElement | null)?.value ?? '';
    try {
      const res = (await call<unknown>(
        cfg.endpoint,
        {},
        { ...(cfg.query ?? {}), ...(q ? { q } : {}) }
      )) as unknown[] | { items: unknown[] };
      const rows = (Array.isArray(res) ? res : (res.items ?? [])) as Record<string, unknown>[];
      const withActions = cfg.editFields || cfg.deletable;
      const cols = withActions
        ? [
            ...cfg.cols,
            {
              key: '__a',
              label: '',
              render: (_v: unknown, row: Record<string, unknown>) => {
                const id = String(row.id ?? '');
                return `<span class="d-flex gap-1">${cfg.editFields ? `<button class="btn btn-sm btn-outline-primary" data-edit="${id}">${d.edit}</button>` : ''}${cfg.deletable && cfg.deletable(row) ? `<button class="btn btn-sm btn-outline-danger" data-del="${id}">${d.delete}</button>` : ''}</span>`;
              },
            },
          ]
        : cfg.cols;
      body.innerHTML = tableHtml(rows, cols);
      const count = el.querySelector('#crud-count');
      if (count) count.textContent = rows.length ? `${rows.length} ${d.total ?? 'items'}` : '';
      body.querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', async () => {
          const row = rows.find((x) => String(x.id) === (b as HTMLElement).dataset.edit) ?? {};
          const data = await modalForm(d.edit, cfg.editFields?.(row) ?? [], labels);
          if (!data) return;
          try {
            await call(`${cfg.endpoint}/${(b as HTMLElement).dataset.edit}`, {
              method: 'PATCH',
              body: JSON.stringify(data),
            });
            toast(d.saved, 'success');
            cfg.onChanged?.();
            await load();
          } catch (e) {
            toast(e instanceof Error ? e.message : d.failed, 'danger');
          }
        })
      );
      body.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!(await confirmDialog(d.confirmDelete, d.confirmDeleteBody, d.delete, d.cancel)))
            return;
          try {
            await call(`${cfg.endpoint}/${(b as HTMLElement).dataset.del}`, { method: 'DELETE' });
            toast(d.deleted, 'success');
            cfg.onChanged?.();
            await load();
          } catch (e) {
            toast(e instanceof Error ? e.message : d.failed, 'danger');
          }
        })
      );
    } catch (e) {
      body.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#crud-q') as HTMLInputElement | null)?.addEventListener(
    'input',
    () => void load()
  );
  el.querySelector('#crud-new')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const data = await modalForm(cfg.createTitle ?? d.create, cfg.createFields ?? [], labels);
      if (!data) return;
      try {
        await call(cfg.endpoint, { method: 'POST', body: JSON.stringify(data) });
        toast(d.created, 'success');
        cfg.onChanged?.();
        await load();
      } catch (err) {
        toast(err instanceof Error ? err.message : d.failed, 'danger');
      }
    } finally {
      btn.disabled = false;
    }
  });
  await load();
}
// NOTE: dates render as ISO slices in templates (locale-neutral by design);
// use formatDateTime from @lms/ui directly when localized output is needed.

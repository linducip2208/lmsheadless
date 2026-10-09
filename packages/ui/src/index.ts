// Shared frontend utilities: theme, API client, toasts, dialogs, offline queue.
// Imported as source by Vite apps (no build step needed).

export type Theme = 'light' | 'dark' | 'system';

export function getTheme(key: string): Theme {
  const v = localStorage.getItem(key);
  return v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
}

export function applyTheme(key: string): Theme {
  const theme = getTheme(key);
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  return theme;
}

export function setTheme(key: string, theme: Theme): void {
  localStorage.setItem(key, theme);
  applyTheme(key);
}

export function themeToggleHtml(key: string): string {
  const current = getTheme(key);
  return `<select class="form-select form-select-sm w-auto" data-theme-toggle="${key}" aria-label="Theme">
    ${(['system', 'light', 'dark'] as Theme[]).map((t) => `<option value="${t}"${t === current ? ' selected' : ''}>${t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</option>`).join('')}
  </select>`;
}

export function bindThemeToggles(key: string): void {
  document.querySelectorAll(`[data-theme-toggle="${key}"]`).forEach((el) => {
    el.addEventListener('change', (e) =>
      setTheme(key, (e.target as HTMLSelectElement).value as Theme)
    );
  });
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme(key));
}

// ---- API client ----
export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  meta?: { page?: number; perPage?: number; total?: number; totalPages?: number };
  error?: { code: string; message: string; details?: unknown };
}

let memoryToken: string | null = null;

export function setAccessToken(token: string | null, persist = false): void {
  memoryToken = token;
  // Access tokens live in memory. Refresh tokens live in httpOnly cookies
  // (cookie mode) or are held by native clients. localStorage is only a
  // fallback for environments without cookie support.
  if (persist && token) localStorage.setItem('lms-token-fallback', token);
  if (!token) localStorage.removeItem('lms-token-fallback');
}

export function getAccessToken(): string | null {
  return memoryToken ?? localStorage.getItem('lms-token-fallback');
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {},
  query?: Record<string, string>
): Promise<T> {
  const url = query ? `${path}?${new URLSearchParams(query).toString()}` : path;
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  };
  const hasBody = opts.body !== undefined;
  if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json';
  const token = getAccessToken();
  if (token && !headers['authorization']) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!json || json.success !== true) {
    const err = new Error(json?.error?.message ?? `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return json.data as T;
}

// ---- Authenticated client factory (one per app) ----
export interface Me {
  id: string;
  email: string;
  name: string;
  memberships: { organization_id: string; role: string }[];
  isSuperAdmin: boolean;
}

export interface ClientOptions {
  orgKey: string;
  loginRedirect?: string;
}

export function createClient(opts: ClientOptions) {
  let me: Me | null = null;

  async function call<T = unknown>(
    path: string,
    reqOpts: RequestInit = {},
    query?: Record<string, string>
  ): Promise<T> {
    try {
      return await api<T>(path, reqOpts, query);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401 && getAccessToken()) {
        try {
          const r = (await api<{ access_token: string }>('/api/v1/auth/refresh', {
            method: 'POST',
            body: '{}',
          })) as {
            access_token: string;
          };
          setAccessToken(r.access_token);
          return await api<T>(path, reqOpts, query);
        } catch {
          // fall through to login redirect
        }
      }
      if ((e as { status?: number }).status === 401) {
        setAccessToken(null);
        me = null;
        if (opts.loginRedirect !== undefined && location.hash !== opts.loginRedirect) {
          location.hash = opts.loginRedirect;
        }
      }
      throw e;
    }
  }

  async function login(email: string, password: string): Promise<Me> {
    const r = await api<{ access_token: string }>('/api/v1/auth/login?cookie=1', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(r.access_token);
    me = (await api<{ user: Me }>('/api/v1/auth/me')).user;
    return me;
  }

  async function logout(redirect = '#/login'): Promise<void> {
    try {
      await api('/api/v1/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* already logged out */
    }
    setAccessToken(null);
    me = null;
    location.hash = redirect;
  }

  async function ensureMe(): Promise<Me | null> {
    if (me) return me;
    try {
      me = (await api<{ user: Me }>('/api/v1/auth/me')).user;
      return me;
    } catch {
      try {
        const r = await api<{ access_token: string }>('/api/v1/auth/refresh', {
          method: 'POST',
          body: '{}',
        });
        setAccessToken(r.access_token);
        me = (await api<{ user: Me }>('/api/v1/auth/me')).user;
        return me;
      } catch {
        return null;
      }
    }
  }

  function getMe(): Me | null {
    return me;
  }

  function currentOrg(): string | null {
    return localStorage.getItem(opts.orgKey);
  }

  function setCurrentOrg(id: string): void {
    localStorage.setItem(opts.orgKey, id);
  }

  async function myOrgs(): Promise<{ id: string; name: string; slug: string }[]> {
    return call('/api/v1/organizations');
  }

  return { call, login, logout, ensureMe, getMe, currentOrg, setCurrentOrg, myOrgs };
}

export type ApiClient = ReturnType<typeof createClient>;

// ---- Toasts ----
export function toast(
  message: string,
  kind: 'success' | 'danger' | 'info' | 'warning' = 'info'
): void {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `alert alert-${kind} alert-dismissible mb-2`;
  el.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.className = 'btn-close';
  btn.setAttribute('aria-label', 'Close');
  btn.addEventListener('click', () => el.remove());
  el.append(text, btn);
  container.appendChild(el);
  window.setTimeout(() => el.remove(), 5000);
}

// ---- Confirm dialog + modal ----
export function confirmDialog(
  title: string,
  message: string,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel'
): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal modal-blur fade show d-block';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', title);
    wrap.innerHTML = `<div class="modal-dialog modal-sm modal-dialog-centered" role="document">
      <div class="modal-content"><div class="modal-body">
      <div class="modal-title">${title}</div><div class="text-muted"></div></div>
      <div class="modal-footer"><button class="btn btn-link link-secondary me-auto" data-x>Cancel</button>
      <button class="btn btn-danger" data-ok>${confirmLabel}</button></div></div></div>`;
    (wrap.querySelector('.text-muted') as HTMLElement).textContent = message;
    (wrap.querySelector('[data-x]') as HTMLButtonElement).textContent = cancelLabel;
    const done = (v: boolean) => {
      wrap.remove();
      resolve(v);
    };
    (wrap.querySelector('[data-ok]') as HTMLButtonElement).addEventListener('click', () =>
      done(true)
    );
    (wrap.querySelector('[data-x]') as HTMLButtonElement).addEventListener('click', () =>
      done(false)
    );
    (wrap.querySelector('[data-ok]') as HTMLButtonElement).focus();
    document.body.appendChild(wrap);
  });
}

export function modalForm(
  title: string,
  fields: {
    name: string;
    label: string;
    type?: string;
    value?: string;
    options?: { value: string; label: string }[];
    required?: boolean;
  }[],
  labels: { save?: string; cancel?: string } = {}
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal modal-blur fade show d-block';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `<div class="modal-dialog modal-dialog-centered" role="document"><form class="modal-content">
      <div class="modal-header"><h5 class="modal-title"></h5><button type="button" class="btn-close" data-x aria-label="Close"></button></div>
      <div class="modal-body"></div>
      <div class="modal-footer"><button type="button" class="btn btn-link link-secondary me-auto" data-x>${labels.cancel ?? 'Cancel'}</button>
      <button type="submit" class="btn btn-primary">${labels.save ?? 'Save'}</button></div></form></div>`;
    (wrap.querySelector('.modal-title') as HTMLElement).textContent = title;
    const body = wrap.querySelector('.modal-body') as HTMLElement;
    for (const f of fields) {
      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = f.label;
      let input: HTMLElement;
      if (f.options) {
        const sel = document.createElement('select');
        sel.className = 'form-select mb-2';
        sel.name = f.name;
        for (const o of f.options) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          if (o.value === f.value) opt.selected = true;
          sel.appendChild(opt);
        }
        input = sel;
      } else if (f.type === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'form-control mb-2';
        ta.name = f.name;
        ta.value = f.value ?? '';
        ta.rows = 4;
        input = ta;
      } else {
        const inp = document.createElement('input');
        inp.className = 'form-control mb-2';
        inp.name = f.name;
        inp.type = f.type ?? 'text';
        inp.value = f.value ?? '';
        if (f.required) inp.required = true;
        input = inp;
      }
      body.append(label, input);
    }
    const done = (v: Record<string, string> | null) => {
      wrap.remove();
      resolve(v);
    };
    wrap.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => done(null)));
    (wrap.querySelector('form') as HTMLFormElement).addEventListener('submit', (e) => {
      e.preventDefault();
      const data: Record<string, string> = {};
      new FormData(e.target as HTMLFormElement).forEach((v, k) => {
        data[k] = String(v);
      });
      done(data);
    });
    document.body.appendChild(wrap);
  });
}

// ---- Offline / sync queue ----
export interface PendingAction {
  id: string;
  method: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
}

const QUEUE_KEY = 'lms-pending-queue';

export function getQueue(): PendingAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as PendingAction[];
  } catch {
    return [];
  }
}

function saveQueue(q: PendingAction[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function enqueueOffline(method: string, path: string, body: unknown): PendingAction {
  const q = getQueue();
  const action: PendingAction = {
    id: crypto.randomUUID(),
    method,
    path,
    body,
    idempotencyKey: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
  };
  q.push(action);
  saveQueue(q);
  return action;
}

// Flush queue when online. Idempotency-Key prevents duplicate writes.
export async function flushQueue(
  onResult?: (action: PendingAction, ok: boolean) => void
): Promise<void> {
  if (!navigator.onLine) return;
  const q = getQueue();
  const remaining: PendingAction[] = [];
  for (const action of q) {
    try {
      await api(action.path, {
        method: action.method,
        body: JSON.stringify(action.body),
        headers: { 'Idempotency-Key': action.idempotencyKey },
      });
      onResult?.(action, true);
    } catch {
      action.attempts += 1;
      if (action.attempts < 5) remaining.push(action);
      onResult?.(action, false);
    }
  }
  saveQueue(remaining);
}

export function onlineIndicatorHtml(): string {
  return `<span id="online-indicator" class="badge ${navigator.onLine ? 'bg-green' : 'bg-red'}">${navigator.onLine ? 'Online' : 'Offline'}</span>`;
}

export function bindOnlineIndicator(): void {
  const update = () => {
    const el = document.getElementById('online-indicator');
    if (el) {
      el.className = `badge ${navigator.onLine ? 'bg-green' : 'bg-red'}`;
      el.textContent = navigator.onLine ? 'Online' : 'Offline';
    }
    if (navigator.onLine) void flushQueue();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

export function formatDateTime(
  iso: string | null | undefined,
  locale = 'en',
  timeZone?: string
): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---- PWA: update flow + push architecture ----
export function bindSwUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return;
    refreshed = true;
    window.location.reload();
  });
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is available and will apply on reload.', 'info');
          }
        });
      });
    })
    .catch(() => undefined);
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Push subscription architecture. Requires the deployment to configure a
// VAPID public key (GET /api/v1/push/config). Without keys this is a clean
// no-op that explains itself — delivery is never faked.
export async function subscribePush(): Promise<
  'subscribed' | 'unsupported' | 'no-keys' | 'denied'
> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  try {
    const cfg = (await api<{ enabled: boolean; public_key: string | null }>(
      '/api/v1/push/config'
    ).catch(() => ({ enabled: false, public_key: null }))) as {
      enabled: boolean;
      public_key: string | null;
    };
    if (!cfg.enabled || !cfg.public_key) return 'no-keys';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.public_key) as BufferSource,
    });
    await api('/api/v1/push/subscriptions', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    return 'subscribed';
  } catch {
    return 'denied';
  }
}

import { Hono } from 'hono';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { hashPassword, randomToken } from '../crypto.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { roleHasPermission, PERMISSIONS, ROLE_PERMISSIONS } from '../permissions.js';
import { audit } from '../auditlog.js';
import { getObject } from '../storage.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const platform = new Hono<{ Variables: AppVars }>();

function can(user: AuthUser | null, orgId: string, perm: string): boolean {
  const role = user ? (user.isSuperAdmin ? 'super_admin' : (orgRole(user, orgId) ?? '')) : '';
  return roleHasPermission(role, perm);
}

// ---------- First-run setup (locked after completion) ----------
platform.get('/api/v1/setup/status', async (c) => {
  const row = await queryFirst<{ value: string }>(c.get('db'), "SELECT value FROM settings WHERE key = 'setup_completed'");
  return ok(c, { setup_completed: row?.value === 'true' });
});

platform.post('/api/v1/setup', async (c) => {
  const db = c.get('db');
  const done = await queryFirst<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'setup_completed'");
  if (done?.value === 'true') return fail(c, 403, 'SETUP_LOCKED', 'Setup is already completed');
  const body = (await c.req.json().catch(() => null)) as {
    app_name?: string; org_name?: string; org_slug?: string;
    admin_email?: string; admin_password?: string; admin_name?: string;
    locale?: string; timezone?: string;
  } | null;
  if (!body?.org_name || !body?.admin_email || !body?.admin_password || body.admin_password.length < 8 || !body?.admin_name) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const email = body.admin_email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid email');
  const existing = await queryFirst(db, 'SELECT id FROM users WHERE email = ?', email);
  if (existing) return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  const now = nowIso();
  const orgId = newId();
  const slug = (body.org_slug ?? body.org_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 80) || `org-${Date.now().toString(36)}`;
  await execute(db, 'INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', orgId, body.org_name.slice(0, 150), slug, now, now);
  const adminId = newId();
  await execute(db, 'INSERT INTO users (id, email, password_hash, name, status, locale, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    adminId, email, await hashPassword(body.admin_password), body.admin_name.slice(0, 120), 'active',
    body.locale === 'id' ? 'id' : 'en', (body.timezone ?? 'Asia/Jakarta').slice(0, 64), now, now);
  await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(), orgId, adminId, 'super_admin', now, now);
  const settings: [string, string][] = [
    ['setup_completed', 'true'],
    ['app_name', (body.app_name ?? 'LMS Headless').slice(0, 120)],
    ['default_locale', body.locale === 'id' ? 'id' : 'en'],
    ['default_timezone', (body.timezone ?? 'Asia/Jakarta').slice(0, 64)],
    ['registration_enabled', 'true'],
  ];
  for (const [k, v] of settings) {
    await execute(db, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', k, v, now);
  }
  await audit(c, 'setup.completed', { entity: 'organization', entityId: orgId, organizationId: orgId });
  return created(c, { organization_id: orgId, admin_id: adminId });
});

// ---------- Global settings (super_admin) ----------
platform.get('/api/v1/settings', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuperAdmin) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll<{ key: string; value: string }>(c.get('db'), 'SELECT key, value FROM settings ORDER BY key ASC');
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.key === 'smtp_password' || r.key.includes('secret')) continue;
    out[r.key] = r.value;
  }
  return ok(c, out);
});

platform.put('/api/v1/settings', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuperAdmin) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const allowed = new Set(['app_name', 'default_locale', 'default_timezone', 'registration_enabled', 'maintenance_mode', 'default_per_page', 'max_upload_mb', 'support_email', 'support_url', 'footer_text', 'vapid_public_key']);
  const now = nowIso();
  let updated = 0;
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k) || typeof v !== 'string' || v.length > 2000) continue;
    if (k === 'setup_completed') continue; // lock cannot be toggled via API
    await execute(c.get('db'), 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', k, v, now);
    updated++;
  }
  await audit(c, 'settings.updated', { entity: 'settings', metadata: { updated } });
  return ok(c, { updated });
});

// ---------- Organization profile + branding ----------
const PUBLIC_BRANDING = ['app_name', 'logo_url', 'favicon_url', 'primary_color', 'secondary_color', 'footer_text', 'support_email', 'support_url', 'locale', 'timezone'];

function readOrgSettings(row: { settings?: string | null }): Record<string, string> {
  try {
    const parsed = JSON.parse((row.settings ?? '{}') as string) as unknown;
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v.slice(0, 2000);
      }
      return out;
    }
  } catch { /* fall through */ }
  return {};
}

// Public-safe branding for login pages / white-label shell. No private data.
platform.get('/api/v1/organizations/:id/branding', async (c) => {
  const row = await queryFirst<{ name: string; settings: string | null }>(c.get('db'), 'SELECT name, settings FROM organizations WHERE id = ? AND deleted_at IS NULL', c.req.param('id'));
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const settings = readOrgSettings(row);
  const branding: Record<string, string> = { app_name: settings.app_name ?? row.name };
  for (const k of PUBLIC_BRANDING) {
    if (settings[k]) branding[k] = settings[k];
  }
  if (!branding.primary_color) branding.primary_color = '#206bc4';
  return ok(c, branding);
});

platform.put('/api/v1/organizations/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!can(user, id, 'settings.manage')) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { name?: string; description?: string; settings?: Record<string, unknown> } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const row = await queryFirst<{ settings: string | null }>(db, 'SELECT settings FROM organizations WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const merged = readOrgSettings(row);
  if (body.settings && typeof body.settings === 'object') {
    for (const [k, v] of Object.entries(body.settings)) {
      if (typeof v === 'string' && v.length <= 2000 && /^[a-z0-9_]+$/.test(k)) merged[k] = v;
    }
  }
  const sets: string[] = ['settings = ?'];
  const params: (string | number | null)[] = [JSON.stringify(merged)];
  if (typeof body.name === 'string' && body.name.length >= 2 && body.name.length <= 150) { sets.push('name = ?'); params.push(body.name); }
  if (typeof body.description === 'string' && body.description.length <= 2000) { sets.push('description = ?'); params.push(body.description); }
  sets.push('updated_at = ?');
  params.push(nowIso(), id);
  await execute(db, `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`, ...params);
  await audit(c, 'organization.updated', { entity: 'organization', entityId: id, organizationId: id });
  return ok(c, { updated: true });
});

// ---------- Custom domain mapping (verified ownership required) ----------
platform.post('/api/v1/organizations/:id/domain', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!can(user, id, 'settings.manage')) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { hostname?: string } | null;
  const hostname = (body?.hostname ?? '').toLowerCase().trim();
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'Invalid hostname');
  }
  if (['localhost'].some((banned) => hostname === banned || hostname.endsWith('.localhost'))) {
    return fail(c, 400, 'VALIDATION_ERROR', 'Hostname not allowed');
  }
  const db = c.get('db');
  const row = await queryFirst<{ settings: string | null }>(db, 'SELECT settings FROM organizations WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const merged = readOrgSettings(row);
  merged.custom_domain = hostname;
  merged.domain_status = 'pending';
  if (!merged.domain_token) merged.domain_token = randomToken(16);
  await execute(db, 'UPDATE organizations SET settings = ?, updated_at = ? WHERE id = ?', JSON.stringify(merged), nowIso(), id);
  await audit(c, 'organization.domain_mapped', { entity: 'organization', entityId: id, organizationId: id, metadata: { hostname } });
  return created(c, {
    hostname,
    status: 'pending',
    verification: {
      type: 'TXT',
      host: `_lms-verify.${hostname}`,
      value: merged.domain_token,
    },
    note: 'Add the TXT record, then configure Cloudflare routing (see docs/white-label.md). The domain is NOT active until ownership and routing are verified.',
  });
});

// ---------- Roles & permissions ----------
platform.get('/api/v1/permissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuperAdmin) {
    // Org admins/teachers see the catalog (read-only reference for UI).
    if (!user.memberships.length) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const rows = await queryAll<{ key: string; description: string | null }>(c.get('db'), 'SELECT key, description FROM permissions ORDER BY key ASC');
  const data = rows.length ? rows : PERMISSIONS.map((p) => ({ key: p.key, description: p.description }));
  return ok(c, data);
});

platform.get('/api/v1/roles', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const roles = ['super_admin', 'organization_admin', 'teacher', 'student', 'parent', 'staff'];
  if (!user.isSuperAdmin && !user.memberships.some((m) => ['organization_admin', 'super_admin'].includes(m.role))) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const db = c.get('db');
  const out: { role: string; permissions: string[] }[] = [];
  for (const role of roles) {
    const rows = await queryAll<{ permission_id: string }>(db, 'SELECT permission_id FROM role_permissions WHERE role = ?', role);
    out.push({ role, permissions: rows.length ? rows.map((r) => r.permission_id) : (ROLE_PERMISSIONS[role] ?? []) });
  }
  return ok(c, out);
});

platform.get('/api/v1/users/me/permissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId) return ok(c, { is_super_admin: user.isSuperAdmin, memberships: user.memberships });
  const role = user.isSuperAdmin ? 'super_admin' : (orgRole(user, orgId) ?? '');
  const db = c.get('db');
  const rows = await queryAll<{ permission_id: string }>(db, 'SELECT permission_id FROM role_permissions WHERE role = ?', role);
  const permissions = rows.length ? rows.map((r) => r.permission_id) : (ROLE_PERMISSIONS[role] ?? []);
  return ok(c, { role, permissions, is_super_admin: user.isSuperAdmin });
});

// ---------- Audit logs ----------
platform.get('/api/v1/audit-logs', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !can(user, orgId, 'audit.view')) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20));
  const db = c.get('db');
  const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM audit_logs WHERE organization_id = ? OR organization_id IS NULL', orgId))?.n ?? 0;
  const rows = await queryAll(db, 'SELECT id, actor_id, action, entity, entity_id, created_at FROM audit_logs WHERE organization_id = ? OR organization_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?', orgId, perPage, (page - 1) * perPage);
  return ok(c, rows, paginationMeta(total, page, perPage));
});

// ---------- Files ----------
platform.get('/api/v1/files', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  const db = c.get('db');
  if (orgId) {
    if (!canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const rows = await queryAll(db, 'SELECT id, object_key, file_name, mime_type, size_bytes, purpose, created_at FROM files WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100', orgId);
    return ok(c, rows);
  }
  const rows = await queryAll(db, 'SELECT id, object_key, file_name, mime_type, size_bytes, purpose, created_at FROM files WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100', user.id);
  return ok(c, rows);
});

const SAFE_DOWNLOAD_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4', 'video/webm',
]);

platform.get('/api/v1/files/:id/download', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst<{ object_key: string; mime_type: string; file_name: string; owner_id: string; organization_id: string | null }>(
    c.get('db'), 'SELECT object_key, mime_type, file_name, owner_id, organization_id FROM files WHERE id = ?', c.req.param('id'));
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const allowed = row.owner_id === user.id || user.isSuperAdmin || (row.organization_id && canAccessOrg(user, row.organization_id));
  if (!allowed) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const obj = await getObject(c.get('env'), row.object_key);
  if (!obj) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const mime = SAFE_DOWNLOAD_MIME.has(row.mime_type) ? row.mime_type : 'application/octet-stream';
  c.header('Content-Type', mime);
  c.header('Content-Disposition', `attachment; filename="${row.file_name.replace(/"/g, '')}"`);
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(obj.body as ArrayBuffer, 200);
});

// ---------- Search (org-scoped, LIKE-based, D1/SQLite compatible) ----------
platform.get('/api/v1/search', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const orgId = url.searchParams.get('organization_id');
  if (!q || !orgId) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { q: 'required', organization_id: 'required' });
  if (!canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const db = c.get('db');
  const like = `%${q}%`;
  const courses = await queryAll(db, 'SELECT id, code, title, status FROM courses WHERE organization_id = ? AND deleted_at IS NULL AND (title LIKE ? OR code LIKE ?) LIMIT 10', orgId, like, like);
  const lessons = await queryAll(db, 'SELECT l.id, l.title, l.course_id FROM lessons l JOIN courses co ON co.id = l.course_id WHERE co.organization_id = ? AND l.title LIKE ? LIMIT 10', orgId, like);
  const announcements = await queryAll(db, 'SELECT id, title FROM announcements WHERE organization_id = ? AND title LIKE ? LIMIT 10', orgId, like);
  let users: unknown[] = [];
  if (can(user, orgId, 'users.view')) {
    users = await queryAll(db, 'SELECT u.id, u.name, u.email FROM users u JOIN organization_members om ON om.user_id = u.id WHERE om.organization_id = ? AND u.deleted_at IS NULL AND (u.name LIKE ? OR u.email LIKE ?) LIMIT 10', orgId, like, like);
  }
  return ok(c, { courses, lessons, announcements, users });
});

// ---------- Notifications: count, read-all, preferences ----------
platform.get('/api/v1/notifications/unread-count', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst<{ n: number }>(c.get('db'), 'SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0', user.id);
  return ok(c, { unread: row?.n ?? 0 });
});

platform.post('/api/v1/notifications/read-all', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  await execute(c.get('db'), 'UPDATE notifications SET is_read = 1 WHERE user_id = ?', user.id);
  return ok(c, { read_all: true });
});

platform.get('/api/v1/notification-preferences', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst<{ prefs: string }>(c.get('db'), 'SELECT prefs FROM notification_preferences WHERE user_id = ?', user.id);
  let prefs: Record<string, boolean> = { announcement: true, assignment: true, quiz: true, grade: true, certificate: true, attendance: true, system: true };
  try {
    if (row) prefs = { ...prefs, ...(JSON.parse(row.prefs) as Record<string, boolean>) };
  } catch { /* defaults */ }
  return ok(c, prefs);
});

platform.put('/api/v1/notification-preferences', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as Record<string, boolean> | null;
  if (!body || typeof body !== 'object') return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const allowed = new Set(['announcement', 'assignment', 'quiz', 'grade', 'certificate', 'attendance', 'system']);
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.has(k) && typeof v === 'boolean') clean[k] = v;
  }
  await execute(c.get('db'), 'INSERT INTO notification_preferences (user_id, prefs, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at', user.id, JSON.stringify(clean), nowIso());
  return ok(c, { updated: true });
});

// ---------- Push subscriptions (architecture; delivery needs VAPID keys) ----------
platform.get('/api/v1/push/config', async (c) => {
  const row = await queryFirst<{ value: string }>(c.get('db'), 'SELECT value FROM settings WHERE key = ?', 'vapid_public_key');
  const key = row?.value ?? '';
  return ok(c, { enabled: key.length > 20, public_key: key.length > 20 ? key : null });
});

platform.post('/api/v1/push/subscriptions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { endpoint?: string; keys?: unknown } | null;
  if (!body?.endpoint || typeof body.endpoint !== 'string' || body.endpoint.length > 2000 || !body.keys) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  await execute(c.get('db'), 'INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, endpoint) DO UPDATE SET keys = excluded.keys',
    newId(), user.id, body.endpoint, JSON.stringify(body.keys).slice(0, 2000), nowIso());
  return created(c, { subscribed: true });
});

platform.get('/api/v1/push/subscriptions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const rows = await queryAll(c.get('db'), 'SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?', user.id);
  return ok(c, rows);
});

export default platform;

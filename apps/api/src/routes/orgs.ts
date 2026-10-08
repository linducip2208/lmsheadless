import { Hono } from 'hono';
import { organizationSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const orgs = new Hono<{ Variables: AppVars }>();


orgs.get('/', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  if (user.isSuperAdmin) {
    const rows = await queryAll(db, 'SELECT * FROM organizations WHERE deleted_at IS NULL ORDER BY created_at DESC');
    return ok(c, rows);
  }
  const ids = user.memberships.map((m) => m.organization_id);
  if (ids.length === 0) return ok(c, []);
  const rows = await queryAll(db, `SELECT * FROM organizations WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return ok(c, rows);
});

orgs.post('/', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuperAdmin) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = organizationSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const exists = await queryFirst(db, 'SELECT id FROM organizations WHERE slug = ?', parsed.data.slug);
  if (exists) return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  const id = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO organizations (id, name, slug, description, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, parsed.data.name, parsed.data.slug, parsed.data.description ?? null, JSON.stringify(parsed.data.settings ?? {}), now, now);
  return created(c, { id });
});

orgs.get('/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const row = await queryFirst(c.get('db'), 'SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  return ok(c, row);
});

orgs.get('/:id/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'),
    'SELECT u.id, u.email, u.name, om.role FROM organization_members om JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? AND u.deleted_at IS NULL',
    id);
  return ok(c, rows);
});

orgs.post('/:id/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const role = orgRole(user, id);
  if (role !== 'super_admin' && role !== 'organization_admin') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  const allowed = ['organization_admin', 'teacher', 'student', 'parent', 'staff'];
  if (!body?.user_id || !body.role || !allowed.includes(body.role)) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at',
    newId(), id, body.user_id, body.role, now, now);
  return created(c, { added: true });
});

// ---- Academic: years / terms / classes / subjects (org-scoped) ----
function guard(user: AuthUser, orgId: string, write: boolean): string | null {
  const role = orgRole(user, orgId);
  if (!role) return 'TENANT_DENIED';
  if (write && !['super_admin', 'organization_admin', 'staff'].includes(role)) return 'FORBIDDEN';
  return null;
}

orgs.get('/:id/academic-years', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM academic_years WHERE organization_id = ? ORDER BY start_date DESC', id);
  return ok(c, rows);
});

orgs.post('/:id/academic-years', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const g = guard(user, id, true);
  if (g) return fail(c, 403, g, t(g === 'TENANT_DENIED' ? 'tenant_denied' : 'forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { name?: string; start_date?: string; end_date?: string; is_active?: number } | null;
  if (!body?.name || !body?.start_date || !body?.end_date) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO academic_years (id, organization_id, name, start_date, end_date, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, id, body.name.slice(0, 120), body.start_date, body.end_date, body.is_active ? 1 : 0, now, now);
  return created(c, { id: nid });
});

orgs.get('/:id/terms', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM terms WHERE organization_id = ? ORDER BY start_date DESC', id);
  return ok(c, rows);
});

orgs.post('/:id/terms', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const g = guard(user, id, true);
  if (g) return fail(c, 403, g, t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { academic_year_id?: string; name?: string; start_date?: string; end_date?: string } | null;
  if (!body?.academic_year_id || !body?.name || !body?.start_date || !body?.end_date) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO terms (id, academic_year_id, organization_id, name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, body.academic_year_id, id, body.name.slice(0, 120), body.start_date, body.end_date, now, now);
  return created(c, { id: nid });
});

orgs.get('/:id/classes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM classes WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', id);
  return ok(c, rows);
});

orgs.post('/:id/classes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const g = guard(user, id, true);
  if (g) return fail(c, 403, g, t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { name?: string; grade_level?: string; academic_year_id?: string; term_id?: string } | null;
  if (!body?.name) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO classes (id, organization_id, academic_year_id, term_id, name, grade_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, id, body.academic_year_id ?? null, body.term_id ?? null, body.name.slice(0, 150), body.grade_level ?? null, now, now);
  return created(c, { id: nid });
});

orgs.post('/classes/:classId/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cls = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM classes WHERE id = ?', c.req.param('classId'));
  if (!cls) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const g = guard(user, cls.organization_id, true);
  if (g) return fail(c, 403, g, t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  if (!body?.user_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  await execute(db, 'INSERT INTO class_members (id, class_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(class_id, user_id) DO UPDATE SET role = excluded.role',
    newId(), c.req.param('classId'), body.user_id, body.role ?? 'student', nowIso());
  return created(c, { added: true });
});

orgs.get('/:id/subjects', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  if (!canAccessOrg(user, id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20));
  const total = (await queryFirst<{ n: number }>(c.get('db'), 'SELECT COUNT(*) as n FROM subjects WHERE organization_id = ?', id))?.n ?? 0;
  const rows = await queryAll(c.get('db'), 'SELECT * FROM subjects WHERE organization_id = ? ORDER BY name ASC LIMIT ? OFFSET ?', id, perPage, (page - 1) * perPage);
  return ok(c, rows, paginationMeta(total, page, perPage));
});

orgs.post('/:id/subjects', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const id = c.req.param('id');
  const g = guard(user, id, true);
  if (g) return fail(c, 403, g, t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { code?: string; name?: string; description?: string } | null;
  if (!body?.code || !body?.name) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  try {
    await execute(c.get('db'), 'INSERT INTO subjects (id, organization_id, code, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      nid, id, body.code.slice(0, 40), body.name.slice(0, 150), body.description ?? null, now, now);
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { id: nid });
});

export default orgs;

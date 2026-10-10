import { Hono } from 'hono';
import { userCreateSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { hashPassword } from '../crypto.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const users = new Hono<{ Variables: AppVars }>();

users.get('/', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)
  );
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const orgId = url.searchParams.get('organization_id');
  const db = c.get('db');
  // Roster enumeration guard: students/parents have no legitimate need to
  // list the organization roster (no portal calls this for those roles).
  if (!user.isSuperAdmin) {
    const staffLike = user.memberships.some((m) => m.role !== 'student' && m.role !== 'parent');
    if (!staffLike) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  let where = 'deleted_at IS NULL';
  const params: (string | number)[] = [];
  if (q) {
    where += ' AND (name LIKE ? OR email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (orgId) {
    if (!canAccessOrg(user, orgId))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    where += ` AND id IN (SELECT user_id FROM organization_members WHERE organization_id = ?)`;
    params.push(orgId);
  } else if (!user.isSuperAdmin) {
    const orgIds = user.memberships.map((m) => m.organization_id);
    if (orgIds.length === 0) return ok(c, [], { ...paginationMeta(0, page, perPage) });
    where += ` AND id IN (SELECT user_id FROM organization_members WHERE organization_id IN (${orgIds.map(() => '?').join(',')}))`;
    params.push(...orgIds);
  }
  const total =
    (
      await queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) as n FROM users WHERE ${where}`,
        ...params
      )
    )?.n ?? 0;
  const rows = await queryAll(
    db,
    `SELECT id, email, name, status, locale, timezone, last_login_at, created_at FROM users WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage
  );
  return ok(c, rows, paginationMeta(total, page, perPage));
});

users.post('/', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const db = c.get('db');
  const orgId = parsed.data.organization_id;
  if (orgId) {
    const role = orgRole(user, orgId);
    if (!role || (role !== 'super_admin' && role !== 'organization_admin')) {
      return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  } else if (!user.isSuperAdmin) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const existing = await queryFirst(
    db,
    'SELECT id FROM users WHERE email = ?',
    parsed.data.email.toLowerCase()
  );
  if (existing) return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  // Prevent privilege escalation: only super_admin can create super_admin.
  if (parsed.data.role === 'super_admin' && !user.isSuperAdmin) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const id = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO users (id, email, password_hash, name, status, locale, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    parsed.data.email.toLowerCase(),
    await hashPassword(parsed.data.password),
    parsed.data.name,
    parsed.data.status ?? 'active',
    parsed.data.locale ?? 'en',
    parsed.data.timezone ?? 'Asia/Jakarta',
    now,
    now
  );
  if (orgId) {
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgId,
      id,
      parsed.data.role,
      now,
      now
    );
  }
  return created(c, { id });
});

users.get('/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const row = await queryFirst(
    db,
    'SELECT id, email, name, status, locale, timezone, last_login_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
    c.req.param('id')
  );
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!user.isSuperAdmin && (row as { id: string }).id !== user.id) {
    const memberOf = await queryAll<{ organization_id: string }>(
      db,
      'SELECT organization_id FROM organization_members WHERE user_id = ?',
      (row as { id: string }).id
    );
    // Shared membership is not enough: the caller must hold a teaching or
    // administrative role in a shared org (students/parents cannot pull
    // other users' profiles).
    const allowed = memberOf.some((m) => {
      const r = orgRole(user, m.organization_id);
      return !!r && r !== 'student' && r !== 'parent';
    });
    if (!allowed) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  }
  return ok(c, row);
});

users.patch('/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    name?: string;
    locale?: string;
    timezone?: string;
    status?: string;
  } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const target = c.req.param('id');
  if (target !== user.id && !user.isSuperAdmin) {
    // Allow org admins of a shared org to edit status only.
    const memberOf = await queryAll<{ organization_id: string }>(
      db,
      'SELECT organization_id FROM organization_members WHERE user_id = ?',
      target
    );
    const allowed = memberOf.some((m) =>
      ['organization_admin', 'super_admin'].includes(orgRole(user, m.organization_id) ?? '')
    );
    if (!allowed) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const sets: string[] = [];
  const params: (string | number)[] = [];
  // Mass-assignment guard: explicit allowlist only.
  if (typeof body.name === 'string' && body.name.length >= 1 && body.name.length <= 120) {
    sets.push('name = ?');
    params.push(body.name);
  }
  if (body.locale === 'en' || body.locale === 'id') {
    sets.push('locale = ?');
    params.push(body.locale);
  }
  if (typeof body.timezone === 'string' && body.timezone.length <= 64) {
    sets.push('timezone = ?');
    params.push(body.timezone);
  }
  if (
    typeof body.status === 'string' &&
    ['active', 'inactive', 'suspended'].includes(body.status) &&
    user.isSuperAdmin
  ) {
    sets.push('status = ?');
    params.push(body.status);
  }
  if (sets.length === 0)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), target);
  await execute(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

users.delete('/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  if (!user.isSuperAdmin) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(
    c.get('db'),
    'UPDATE users SET deleted_at = ? WHERE id = ?',
    nowIso(),
    c.req.param('id')
  );
  return ok(c, { deleted: true });
});

// Parent links: link a parent user to a student user within an org.
users.post('/:id/parent-links', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    student_id?: string;
    organization_id?: string;
  } | null;
  if (!body?.student_id || !body?.organization_id)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const role = orgRole(user, body.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  await execute(
    db,
    'INSERT OR IGNORE INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    c.req.param('id'),
    body.student_id,
    body.organization_id,
    nowIso()
  );
  return created(c, { linked: true });
});

users.get('/:id/linked-students', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const parentId = c.req.param('id');
  if (parentId !== user.id && !user.isSuperAdmin) {
    const r = orgRole(user, new URL(c.req.url).searchParams.get('organization_id') ?? '');
    if (r !== 'organization_admin' && r !== 'super_admin')
      return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const url = new URL(c.req.url);
  const scopedOrg = url.searchParams.get('organization_id');
  const rows = await queryAll(
    c.get('db'),
    `SELECT u.id, u.name, u.email FROM parent_links pl JOIN users u ON u.id = pl.student_id WHERE pl.parent_id = ?${scopedOrg ? ' AND pl.organization_id = ?' : ''}`,
    ...(scopedOrg ? [parentId, scopedOrg] : [parentId])
  );
  return ok(c, rows);
});

export default users;

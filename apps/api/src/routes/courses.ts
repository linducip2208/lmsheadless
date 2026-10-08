import { Hono } from 'hono';
import { courseSchema, enrollmentSchema, lessonSchema, sectionSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const courses = new Hono<{ Variables: AppVars }>();

async function courseOrg(db: Parameters<typeof queryFirst>[0], courseId: string): Promise<string | null> {
  const row = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ? AND deleted_at IS NULL', courseId);
  return row?.organization_id ?? null;
}

function canTeach(user: AuthUser, orgId: string): boolean {
  const r = orgRole(user, orgId);
  return r === 'super_admin' || r === 'organization_admin' || r === 'teacher' || r === 'staff';
}

courses.get('/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20));
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const orgId = url.searchParams.get('organization_id');
  const status = url.searchParams.get('status');
  const db = c.get('db');
  let where = 'deleted_at IS NULL';
  const params: (string | number)[] = [];
  if (orgId) {
    if (!canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    where += ' AND organization_id = ?';
    params.push(orgId);
  } else if (!user.isSuperAdmin) {
    const ids = user.memberships.map((m) => m.organization_id);
    if (ids.length === 0) return ok(c, [], paginationMeta(0, page, perPage));
    where += ` AND organization_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (q) { where += ' AND (title LIKE ? OR code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (status && ['draft', 'published', 'archived'].includes(status)) { where += ' AND status = ?'; params.push(status); }
  const total = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM courses WHERE ${where}`, ...params))?.n ?? 0;
  const rows = await queryAll(db, `SELECT * FROM courses WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage);
  return ok(c, rows, paginationMeta(total, page, perPage));
});

courses.post('/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = courseSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const id = newId();
  const now = nowIso();
  try {
    await execute(c.get('db'), 'INSERT INTO courses (id, organization_id, category_id, code, title, description, status, thumbnail_url, price, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, parsed.data.organization_id, parsed.data.category_id ?? null, parsed.data.code, parsed.data.title,
      parsed.data.description ?? null, parsed.data.status ?? 'draft', parsed.data.thumbnail_url ?? null, parsed.data.price ?? 0, user.id, now, now);
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { id });
});

courses.get('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst(c.get('db'), 'SELECT * FROM courses WHERE id = ? AND deleted_at IS NULL', c.req.param('id'));
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = (row as { organization_id: string }).organization_id;
  if (!canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  return ok(c, row);
});

courses.patch('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const allowed: Record<string, (v: unknown) => string | number | null> = {    title: (v) => (typeof v === 'string' && v.length >= 2 && v.length <= 200 ? v : ''),
    description: (v) => (typeof v === 'string' ? String(v).slice(0, 10000) : ''),
    status: (v) => (v === 'draft' || v === 'published' || v === 'archived' ? (v as string) : ''),
    thumbnail_url: (v) => (typeof v === 'string' ? v.slice(0, 1000) : ''),
    price: (v) => (typeof v === 'number' && v >= 0 ? v : ''),
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, fn] of Object.entries(allowed)) {
    if (body[k] !== undefined) {
      const v = fn(body[k]);
      if (v === '') return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { field: k });
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('id'));
  await execute(db, `UPDATE courses SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

courses.delete('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  const role = orgId ? orgRole(user, orgId) : null;
  if (!orgId || (role !== 'super_admin' && role !== 'organization_admin')) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'UPDATE courses SET deleted_at = ? WHERE id = ?', nowIso(), c.req.param('id'));
  return ok(c, { deleted: true });
});

// Sections
courses.get('/courses/:id/sections', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT * FROM course_sections WHERE course_id = ? ORDER BY position ASC', c.req.param('id'));
  return ok(c, rows);
});

courses.post('/courses/:id/sections', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = sectionSchema.safeParse({ ...(body as object ?? {}), course_id: c.req.param('id') });
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO course_sections (id, course_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    nid, c.req.param('id'), parsed.data.title, parsed.data.position ?? 0, now, now);
  return created(c, { id: nid });
});

// Lessons
courses.get('/courses/sections/:sectionId/lessons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM course_sections WHERE id = ?', c.req.param('sectionId'));
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT * FROM lessons WHERE section_id = ? ORDER BY position ASC', c.req.param('sectionId'));
  return ok(c, rows);
});

courses.post('/courses/sections/:sectionId/lessons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM course_sections WHERE id = ?', c.req.param('sectionId'));
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = lessonSchema.safeParse({ ...(body as object ?? {}), section_id: c.req.param('sectionId') });
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (parsed.data.video_url && !/^https?:\/\//.test(parsed.data.video_url)) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { video_url: 'Must be http(s) URL' });
  }
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO lessons (id, section_id, course_id, title, content_type, body, video_url, resource_url, position, duration_minutes, is_free_preview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, c.req.param('sectionId'), sec.course_id, parsed.data.title, parsed.data.content_type, parsed.data.body ?? null,
    parsed.data.video_url ?? null, parsed.data.resource_url ?? null, parsed.data.position ?? 0, parsed.data.duration_minutes ?? 0,
    parsed.data.is_free_preview ? 1 : 0, now, now);
  return created(c, { id: nid });
});

// Enrollment
courses.post('/enrollments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = enrollmentSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const studentId = parsed.data.student_id ?? user.id;
  // Students can only enroll themselves; staff can enroll anyone in their org.
  if (studentId !== user.id && !canTeach(user, orgId) && orgRole(user, orgId) !== 'organization_admin') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  if (!canAccessOrg(user, orgId) && studentId === user.id) {
    // Auto-join org on self-enrollment? Require membership: create it as student.
    await execute(db, 'INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), orgId, user.id, 'student', nowIso(), nowIso());
  } else if (!canAccessOrg(user, orgId)) {
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  }
  const existing = await queryFirst(db, 'SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?', parsed.data.course_id, studentId);
  if (existing) return fail(c, 409, 'CONFLICT', t('enrolled', c.get('lang')));
  const now = nowIso();
  await execute(db, 'INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(), parsed.data.course_id, studentId, parsed.data.status ?? 'active', now, now, now);
  return created(c, { enrolled: true });
});

courses.get('/courses/:id/enrollments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student') {
    const rows = await queryAll(db, 'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ?', c.req.param('id'), user.id);
    return ok(c, rows);
  }
  const rows = await queryAll(db, 'SELECT e.*, u.name as student_name FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ?', c.req.param('id'));
  return ok(c, rows);
});

// Lesson completion + course progress
courses.post('/lessons/:lessonId/complete', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ id: string; course_id: string }>(db, 'SELECT id, course_id FROM lessons WHERE id = ?', c.req.param('lessonId'));
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const enr = await queryFirst(db, 'SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?', lesson.course_id, user.id);
  if (!enr && !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  await execute(db, 'INSERT INTO lesson_progress (id, lesson_id, student_id, course_id, is_completed, completed_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(lesson_id, student_id) DO UPDATE SET is_completed = 1, completed_at = excluded.completed_at, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at',
    newId(), lesson.id, user.id, lesson.course_id, now, now, now, now);
  // Recompute course progress
  const total = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM lessons WHERE course_id = ?', lesson.course_id))?.n ?? 0;
  const done = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE l.course_id = ? AND lp.student_id = ? AND lp.is_completed = 1', lesson.course_id, user.id))?.n ?? 0;
  const percent = total === 0 ? 0 : Math.round((done / total) * 10000) / 100;
  await execute(db, 'INSERT INTO course_progress (id, course_id, student_id, percent, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(course_id, student_id) DO UPDATE SET percent = excluded.percent, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at',
    newId(), lesson.course_id, user.id, percent, now, now, now);
  await execute(db, 'UPDATE enrollments SET progress_percent = ?, updated_at = ? WHERE course_id = ? AND student_id = ?', percent, now, lesson.course_id, user.id);
  if (percent >= 100) {
    const certNum = `CERT-${new Date().getUTCFullYear()}-${user.id.slice(0, 8).toUpperCase()}-${lesson.course_id.slice(0, 8).toUpperCase()}`;
    await execute(db, 'INSERT OR IGNORE INTO certificates (id, organization_id, course_id, student_id, certificate_number, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(), orgId, lesson.course_id, user.id, certNum, now, now);
  }
  return ok(c, { completed: true, progress_percent: percent });
});

courses.get('/courses/:id/progress', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const studentId = new URL(c.req.url).searchParams.get('student_id') ?? user.id;
  if (studentId !== user.id) {
    const role = orgRole(user, orgId);
    if (role === 'student') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    if (role === 'parent') {
      const link = await queryFirst(db, 'SELECT id FROM parent_links WHERE parent_id = ? AND student_id = ?', user.id, studentId);
      if (!link) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  }
  const cp = await queryFirst(db, 'SELECT * FROM course_progress WHERE course_id = ? AND student_id = ?', c.req.param('id'), studentId);
  const lessons = await queryAll(db, 'SELECT l.id, l.title, COALESCE(lp.is_completed, 0) as is_completed FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = ? WHERE l.course_id = ? ORDER BY l.position ASC', studentId, c.req.param('id'));
  return ok(c, { progress: cp, lessons });
});

export default courses;

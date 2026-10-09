import { Hono } from 'hono';
import { tagSchema, prerequisiteSchema, dripSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach, isPrivileged, slugify, toCsv } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const authoring = new Hono<{ Variables: AppVars }>();

// ---------- Tags ----------
authoring.get('/course-tags', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM course_tags WHERE organization_id = ? ORDER BY name ASC', orgId);
  return ok(c, rows);
});

authoring.post('/course-tags', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = tagSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  try {
    await execute(c.get('db'), 'INSERT INTO course_tags (id, organization_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)',
      nid, parsed.data.organization_id, parsed.data.name.slice(0, 80), slugify(parsed.data.name, `tag-${Date.now().toString(36)}`), now);
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { id: nid });
});

authoring.put('/courses/:id/tags', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { tag_ids?: string[] } | null;
  if (!body?.tag_ids || !Array.isArray(body.tag_ids) || body.tag_ids.length > 50) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  // Only tags from the same org can be linked (tenant guard).
  const valid = await queryAll<{ id: string }>(db, `SELECT id FROM course_tags WHERE organization_id = ? AND id IN (${body.tag_ids.map(() => '?').join(',') || "'__none__'"})`, orgId, ...body.tag_ids.filter((x) => typeof x === 'string'));
  await execute(db, 'DELETE FROM course_tag_links WHERE course_id = ?', c.req.param('id'));
  for (const tag of valid) {
    await execute(db, 'INSERT OR IGNORE INTO course_tag_links (course_id, tag_id) VALUES (?, ?)', c.req.param('id'), tag.id);
  }
  return ok(c, { tags: valid.length });
});

// ---------- Prerequisites ----------
authoring.post('/courses/:id/prerequisites', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = prerequisiteSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (parsed.data.requires_course_id === c.req.param('id')) return fail(c, 400, 'VALIDATION_ERROR', 'A course cannot require itself');
  const reqOrg = await courseOrg(db, parsed.data.requires_course_id);
  if (reqOrg !== orgId) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  await execute(db, 'INSERT OR IGNORE INTO course_prerequisites (course_id, requires_course_id) VALUES (?, ?)', c.req.param('id'), parsed.data.requires_course_id);
  return created(c, { added: true });
});

authoring.get('/courses/:id/prerequisites', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT co.id, co.title, co.code FROM course_prerequisites cp JOIN courses co ON co.id = cp.requires_course_id WHERE cp.course_id = ?', c.req.param('id'));
  return ok(c, rows);
});

authoring.delete('/courses/:id/prerequisites/:reqId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'DELETE FROM course_prerequisites WHERE course_id = ? AND requires_course_id = ?', c.req.param('id'), c.req.param('reqId'));
  return ok(c, { deleted: true });
});

authoring.post('/lessons/:lessonId/prerequisites', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM lessons WHERE id = ?', c.req.param('lessonId'));
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { requires_lesson_id?: string } | null;
  if (!body?.requires_lesson_id || body.requires_lesson_id === c.req.param('lessonId')) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const other = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM lessons WHERE id = ?', body.requires_lesson_id);
  if (!other) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const otherOrg = await courseOrg(db, other.course_id);
  if (otherOrg !== orgId) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  await execute(db, 'INSERT OR IGNORE INTO lesson_prerequisites (lesson_id, requires_lesson_id) VALUES (?, ?)', c.req.param('lessonId'), body.requires_lesson_id);
  return created(c, { added: true });
});

// ---------- Drip ----------
authoring.get('/courses/:id/drip', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT d.*, l.title as lesson_title FROM drip_rules d JOIN lessons l ON l.id = d.lesson_id WHERE d.course_id = ?', c.req.param('id'));
  return ok(c, rows);
});

authoring.post('/courses/:id/drip', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = dripSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (parsed.data.days_after_enrollment === undefined && !parsed.data.unlock_at) {
    return fail(c, 400, 'VALIDATION_ERROR', 'Provide days_after_enrollment or unlock_at');
  }
  const lesson = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM lessons WHERE id = ?', parsed.data.lesson_id);
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const lessonOrg = await courseOrg(db, lesson.course_id);
  if (lessonOrg !== orgId || lesson.course_id !== c.req.param('id')) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  await execute(db, 'INSERT INTO drip_rules (id, course_id, lesson_id, days_after_enrollment, unlock_at, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(lesson_id) DO UPDATE SET days_after_enrollment = excluded.days_after_enrollment, unlock_at = excluded.unlock_at',
    newId(), c.req.param('id'), parsed.data.lesson_id, parsed.data.days_after_enrollment ?? null, parsed.data.unlock_at ?? null, now);
  return created(c, { saved: true });
});

authoring.delete('/courses/:id/drip/:lessonId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'DELETE FROM drip_rules WHERE course_id = ? AND lesson_id = ?', c.req.param('id'), c.req.param('lessonId'));
  return ok(c, { deleted: true });
});

// ---------- Instructor notes (private; never in student payloads) ----------
authoring.get('/lessons/:lessonId/notes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM lessons WHERE id = ?', c.req.param('lessonId'));
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT n.*, u.name as author_name FROM instructor_notes n JOIN users u ON u.id = n.author_id WHERE n.lesson_id = ? ORDER BY n.created_at DESC', c.req.param('lessonId'));
  return ok(c, rows);
});

authoring.post('/lessons/:lessonId/notes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM lessons WHERE id = ?', c.req.param('lessonId'));
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { body?: string } | null;
  if (!body?.body || body.body.length > 20000) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO instructor_notes (id, lesson_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', nid, c.req.param('lessonId'), user.id, body.body, now, now);
  return created(c, { id: nid });
});

// ---------- Waitlist ----------
authoring.post('/courses/:id/waitlist', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  await execute(db, 'INSERT OR IGNORE INTO waitlists (id, course_id, student_id, created_at) VALUES (?, ?, ?, ?)', newId(), c.req.param('id'), user.id, nowIso());
  return created(c, { waiting: true });
});

authoring.get('/courses/:id/waitlist', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT w.*, u.name as student_name FROM waitlists w JOIN users u ON u.id = w.student_id WHERE w.course_id = ? ORDER BY w.created_at ASC', c.req.param('id'));
  return ok(c, rows);
});

authoring.post('/courses/:id/waitlist/:entryId/promote', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const entry = await queryFirst<{ student_id: string; status: string }>(db, 'SELECT student_id, status FROM waitlists WHERE id = ? AND course_id = ?', c.req.param('entryId'), c.req.param('id'));
  if (!entry) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const now = nowIso();
  await execute(db, 'INSERT OR IGNORE INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), c.req.param('id'), entry.student_id, 'active', now, now, now);
  await execute(db, "UPDATE waitlists SET status = 'promoted' WHERE id = ?", c.req.param('entryId'));
  await audit(c, 'waitlist.promoted', { entity: 'waitlist', entityId: c.req.param('entryId'), organizationId: orgId });
  return ok(c, { promoted: true });
});

// ---------- Duplicate ----------
authoring.post('/courses/:id/duplicate', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const src = await queryFirst<Record<string, string | number | null>>(db, 'SELECT * FROM courses WHERE id = ? AND deleted_at IS NULL', c.req.param('id'));
  if (!src) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = src.organization_id as string;
  if (!canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { code?: string; title?: string } | null;
  const now = nowIso();
  const newCourseId = newId();
  const code = (body?.code ?? `${src.code}-COPY`).slice(0, 40);
  try {
    await execute(db, 'INSERT INTO courses (id, organization_id, category_id, code, title, description, status, price, created_by, created_at, updated_at, slug, visibility, enrollment_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newCourseId, orgId, (src.category_id as string | null) ?? null, code, (body?.title ?? `${src.title} (Copy)`).slice(0, 200),
      (src.description as string | null) ?? null, 'draft', (src.price as number | null) ?? 0, user.id, now, now, null, (src.visibility as string | null) ?? 'private', (src.enrollment_mode as string | null) ?? 'open');
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  // Deep copy structure (sections → lessons). Enrollments/progress stay behind.
  const sections = await queryAll<{ id: string; title: string; position: number }>(db, 'SELECT id, title, position FROM course_sections WHERE course_id = ? ORDER BY position ASC', c.req.param('id'));
  for (const sec of sections) {
    const newSecId = newId();
    await execute(db, 'INSERT INTO course_sections (id, course_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newSecId, newCourseId, sec.title, sec.position, now, now);
    const lessons = await queryAll<Record<string, string | number | null>>(db, 'SELECT * FROM lessons WHERE section_id = ? ORDER BY position ASC', sec.id);
    for (const les of lessons) {
      await execute(db, 'INSERT INTO lessons (id, section_id, course_id, title, content_type, body, video_url, resource_url, position, duration_minutes, is_free_preview, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(), newSecId, newCourseId, les.title as string, (les.content_type as string) ?? 'text', (les.body as string | null) ?? null,
        (les.video_url as string | null) ?? null, (les.resource_url as string | null) ?? null, (les.position as number | null) ?? 0,
        (les.duration_minutes as number | null) ?? 0, (les.is_free_preview as number | null) ?? 0, 'draft', now, now);
    }
  }
  await audit(c, 'course.duplicated', { entity: 'course', entityId: newCourseId, organizationId: orgId, metadata: { from: c.req.param('id') } });
  return created(c, { id: newCourseId });
});

// ---------- Versions ----------
authoring.get('/courses/:id/versions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT id, version, created_by, created_at FROM course_versions WHERE course_id = ? ORDER BY version DESC', c.req.param('id'));
  return ok(c, rows);
});

export async function snapshotCourse(db: Parameters<typeof queryFirst>[0], courseId: string, actorId: string): Promise<number> {
  const course = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM courses WHERE id = ?', courseId);
  const sections = await queryAll(db, 'SELECT * FROM course_sections WHERE course_id = ? ORDER BY position ASC', courseId);
  const lessons = await queryAll(db, 'SELECT * FROM lessons WHERE course_id = ? ORDER BY position ASC', courseId);
  const current = (await queryFirst<{ v: number | null }>(db, 'SELECT MAX(version) as v FROM course_versions WHERE course_id = ?', courseId))?.v ?? 0;
  const version = current + 1;
  await execute(db, 'INSERT INTO course_versions (id, course_id, version, snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(), courseId, version, JSON.stringify({ course, sections, lessons }).slice(0, 500000), actorId, nowIso());
  return version;
}

authoring.post('/courses/:id/versions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const version = await snapshotCourse(db, c.req.param('id'), user.id);
  return created(c, { version });
});

// ---------- CSV course export (injection-safe) ----------
authoring.get('/courses/export', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const courses = await queryAll<{ code: string; title: string; status: string; price: number }>(c.get('db'), 'SELECT code, title, status, price FROM courses WHERE organization_id = ? AND deleted_at IS NULL ORDER BY title ASC', orgId);
  const csv = toCsv(['code', 'title', 'status', 'price'], courses.map((x) => [x.code, x.title, x.status, x.price]));
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="courses.csv"');
  return c.body(csv, 200);
});

// ---------- Publish approvals + scheduled publishing ----------
authoring.post('/courses/:id/request-approval', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'UPDATE courses SET review_status = ? WHERE id = ?', 'pending', c.req.param('id'));
  await execute(db, 'INSERT INTO publish_approvals (id, organization_id, course_id, requested_by, created_at) VALUES (?, ?, ?, ?, ?)', newId(), orgId, c.req.param('id'), user.id, nowIso());
  await audit(c, 'publish.requested', { entity: 'course', entityId: c.req.param('id'), organizationId: orgId });
  return created(c, { requested: true });
});

authoring.get('/publish-approvals', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), "SELECT pa.*, co.title as course_title, u.name as requested_by_name FROM publish_approvals pa JOIN courses co ON co.id = pa.course_id JOIN users u ON u.id = pa.requested_by WHERE pa.organization_id = ? AND pa.status = 'pending' ORDER BY pa.created_at ASC", orgId);
  return ok(c, rows);
});

authoring.post('/publish-approvals/:id/approve', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const ap = await queryFirst<{ organization_id: string; course_id: string; status: string }>(db, 'SELECT organization_id, course_id, status FROM publish_approvals WHERE id = ?', c.req.param('id'));
  if (!ap) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!isPrivileged(user, ap.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (ap.status !== 'pending') return fail(c, 400, 'VALIDATION_ERROR', 'Already decided');
  const now = nowIso();
  await execute(db, 'UPDATE publish_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', 'approved', user.id, now, c.req.param('id'));
  await execute(db, "UPDATE courses SET status = 'published', review_status = 'approved', updated_at = ? WHERE id = ?", now, ap.course_id);
  await snapshotCourse(db, ap.course_id, user.id);
  await audit(c, 'course.published', { entity: 'course', entityId: ap.course_id, organizationId: ap.organization_id });
  return ok(c, { approved: true });
});

authoring.post('/publish-approvals/:id/reject', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const ap = await queryFirst<{ organization_id: string; status: string }>(db, 'SELECT organization_id, status FROM publish_approvals WHERE id = ?', c.req.param('id'));
  if (!ap) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!isPrivileged(user, ap.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (ap.status !== 'pending') return fail(c, 400, 'VALIDATION_ERROR', 'Already decided');
  const body = (await c.req.json().catch(() => null)) as { note?: string } | null;
  await execute(db, 'UPDATE publish_approvals SET status = ?, decided_by = ?, decided_at = ?, note = ? WHERE id = ?', 'rejected', user.id, nowIso(), body?.note?.slice(0, 2000) ?? null, c.req.param('id'));
  return ok(c, { rejected: true });
});

// Publish courses whose publish_at has arrived (call from cron/scheduler or admin action).
authoring.post('/courses/publish-due', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const due = await queryAll<{ id: string }>(db, "SELECT id FROM courses WHERE organization_id = ? AND status = 'draft' AND publish_at IS NOT NULL AND publish_at <= ? AND deleted_at IS NULL", orgId, nowIso());
  let published = 0;
  for (const course of due) {
    const pending = await queryFirst(db, "SELECT id FROM publish_approvals WHERE course_id = ? AND status = 'pending'", course.id);
    if (pending) continue; // approval workflow takes precedence
    await execute(db, "UPDATE courses SET status = 'published', updated_at = ? WHERE id = ?", nowIso(), course.id);
    await snapshotCourse(db, course.id, user.id);
    published++;
  }
  await audit(c, 'courses.publish_due', { organizationId: orgId, metadata: { published } });
  return ok(c, { published });
});

export default authoring;

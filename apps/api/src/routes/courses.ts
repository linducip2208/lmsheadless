import { Hono } from 'hono';
import { courseSchema, enrollmentSchema, lessonSchema, sectionSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { logActivity } from './growth.js';
import { isPrivileged } from '../access.js';
import { snapshotCourse } from './authoring.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const courses = new Hono<{ Variables: AppVars }>();

async function courseOrg(
  db: Parameters<typeof queryFirst>[0],
  courseId: string
): Promise<string | null> {
  const row = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ? AND deleted_at IS NULL',
    courseId
  );
  return row?.organization_id ?? null;
}

function canTeach(user: AuthUser, orgId: string): boolean {
  const r = orgRole(user, orgId);
  return r === 'super_admin' || r === 'organization_admin' || r === 'teacher' || r === 'staff';
}

// Courses assigned to the current instructor (teachers see their own work).
courses.get('/instructor/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  const assigned = await queryAll(
    db,
    'SELECT co.* FROM courses co JOIN course_instructors ci ON ci.course_id = co.id WHERE ci.user_id = ? AND co.deleted_at IS NULL ORDER BY co.created_at DESC',
    user.id
  );
  if (assigned.length || !orgId) return ok(c, assigned);
  // Fallback: org admins see all org courses here.
  const role = orgRole(user, orgId);
  if (role === 'super_admin' || role === 'organization_admin') {
    const all = await queryAll(
      db,
      'SELECT * FROM courses WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      orgId
    );
    return ok(c, all);
  }
  return ok(c, assigned);
});

courses.get('/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)
  );
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const orgId = url.searchParams.get('organization_id');
  const status = url.searchParams.get('status');
  const db = c.get('db');
  let where = 'deleted_at IS NULL';
  const params: (string | number)[] = [];
  if (orgId) {
    if (!canAccessOrg(user, orgId))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    where += ' AND organization_id = ?';
    params.push(orgId);
  } else if (!user.isSuperAdmin) {
    const ids = user.memberships.map((m) => m.organization_id);
    if (ids.length === 0) return ok(c, [], paginationMeta(0, page, perPage));
    where += ` AND organization_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  if (q) {
    where += ' AND (title LIKE ? OR code LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (status && ['draft', 'published', 'archived'].includes(status)) {
    where += ' AND status = ?';
    params.push(status);
  }
  const total =
    (
      await queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) as n FROM courses WHERE ${where}`,
        ...params
      )
    )?.n ?? 0;
  const rows = await queryAll(
    db,
    `SELECT * FROM courses WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage
  );
  return ok(c, rows, paginationMeta(total, page, perPage));
});

courses.post('/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = courseSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  if (!canTeach(user, parsed.data.organization_id))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const id = newId();
  const now = nowIso();
  const slug =
    (
      parsed.data.slug ??
      parsed.data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    ).slice(0, 120) || `course-${Date.now().toString(36)}`;
  try {
    await execute(
      c.get('db'),
      'INSERT INTO courses (id, organization_id, category_id, code, title, description, status, thumbnail_url, price, created_by, created_at, updated_at, slug, visibility, start_at, end_at, enrollment_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      parsed.data.organization_id,
      parsed.data.category_id ?? null,
      parsed.data.code,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.status ?? 'draft',
      parsed.data.thumbnail_url ?? null,
      parsed.data.price ?? 0,
      user.id,
      now,
      now,
      slug,
      parsed.data.visibility ?? 'private',
      parsed.data.start_at ?? null,
      parsed.data.end_at ?? null,
      parsed.data.enrollment_mode ?? 'open'
    );
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  await audit(c, 'course.created', {
    entity: 'course',
    entityId: id,
    organizationId: parsed.data.organization_id,
  });
  return created(c, { id });
});

courses.get('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst(
    c.get('db'),
    'SELECT * FROM courses WHERE id = ? AND deleted_at IS NULL',
    c.req.param('id')
  );
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = (row as { organization_id: string }).organization_id;
  if (!canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  return ok(c, row);
});

courses.patch('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const allowed: Record<string, (v: unknown) => string | number | null> = {
    title: (v) => (typeof v === 'string' && v.length >= 2 && v.length <= 200 ? v : ''),
    description: (v) => (typeof v === 'string' ? String(v).slice(0, 10000) : ''),
    status: (v) => (v === 'draft' || v === 'published' || v === 'archived' ? (v as string) : ''),
    thumbnail_url: (v) => (typeof v === 'string' ? v.slice(0, 1000) : ''),
    price: (v) => (typeof v === 'number' && v >= 0 ? v : ''),
    slug: (v) => (typeof v === 'string' && /^[a-z0-9-]{2,120}$/.test(v) ? v : ''),
    visibility: (v) => (v === 'private' || v === 'public' || v === 'unlisted' ? (v as string) : ''),
    start_at: (v) => (typeof v === 'string' && v.length <= 64 ? v : ''),
    end_at: (v) => (typeof v === 'string' && v.length <= 64 ? v : ''),
    publish_at: (v) => (typeof v === 'string' && v.length <= 64 ? v : ''),
    enrollment_mode: (v) =>
      v === 'open' || v === 'approval' || v === 'closed' ? (v as string) : '',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, fn] of Object.entries(allowed)) {
    if (body[k] !== undefined) {
      const v = fn(body[k]);
      if (v === '')
        return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), {
          field: k,
        });
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('id'));
  await execute(db, `UPDATE courses SET ${sets.join(', ')} WHERE id = ?`, ...params);
  if (body.status === 'published') {
    // Approval workflow: teachers request, privileged roles publish directly.
    const settings = await queryFirst<{ settings: string | null }>(
      db,
      'SELECT settings FROM organizations WHERE id = ?',
      orgId
    );
    let requireApproval = false;
    try {
      requireApproval =
        (JSON.parse(settings?.settings ?? '{}') as { require_approval?: string })
          .require_approval === 'true';
    } catch {
      /* default off */
    }
    if (requireApproval && !isPrivileged(user, orgId)) {
      await execute(
        db,
        'UPDATE courses SET status = ?, review_status = ? WHERE id = ?',
        'draft',
        'pending',
        c.req.param('id')
      );
      await execute(
        db,
        'INSERT INTO publish_approvals (id, organization_id, course_id, requested_by, created_at) VALUES (?, ?, ?, ?, ?)',
        newId(),
        orgId,
        c.req.param('id'),
        user.id,
        nowIso()
      );
      await audit(c, 'publish.requested', {
        entity: 'course',
        entityId: c.req.param('id'),
        organizationId: orgId,
      });
      return ok(c, { updated: true, pending_approval: true });
    }
    await snapshotCourse(db, c.req.param('id'), user.id);
    await audit(c, 'course.published', {
      entity: 'course',
      entityId: c.req.param('id'),
      organizationId: orgId,
    });
  }
  return ok(c, { updated: true });
});

courses.delete('/courses/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  const role = orgId ? orgRole(user, orgId) : null;
  if (!orgId || (role !== 'super_admin' && role !== 'organization_admin'))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'UPDATE courses SET deleted_at = ? WHERE id = ?', nowIso(), c.req.param('id'));
  return ok(c, { deleted: true });
});

// Sections
courses.get('/courses/:id/sections', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(
    db,
    'SELECT * FROM course_sections WHERE course_id = ? ORDER BY position ASC LIMIT 1000',
    c.req.param('id')
  );
  return ok(c, rows);
});

courses.post('/courses/:id/sections', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = sectionSchema.safeParse({
    ...((body as object) ?? {}),
    course_id: c.req.param('id'),
  });
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO course_sections (id, course_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    nid,
    c.req.param('id'),
    parsed.data.title,
    parsed.data.position ?? 0,
    now,
    now
  );
  return created(c, { id: nid });
});

// Lessons
courses.get('/courses/sections/:sectionId/lessons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM course_sections WHERE id = ?',
    c.req.param('sectionId')
  );
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(
    db,
    'SELECT * FROM lessons WHERE section_id = ? ORDER BY position ASC LIMIT 1000',
    c.req.param('sectionId')
  );
  return ok(c, rows);
});

courses.post('/courses/sections/:sectionId/lessons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM course_sections WHERE id = ?',
    c.req.param('sectionId')
  );
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = lessonSchema.safeParse({
    ...((body as object) ?? {}),
    section_id: c.req.param('sectionId'),
  });
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  if (parsed.data.video_url && !/^https?:\/\//.test(parsed.data.video_url)) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), {
      video_url: 'Must be http(s) URL',
    });
  }
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO lessons (id, section_id, course_id, title, content_type, body, video_url, resource_url, position, duration_minutes, is_free_preview, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid,
    c.req.param('sectionId'),
    sec.course_id,
    parsed.data.title,
    parsed.data.content_type,
    parsed.data.body ?? null,
    parsed.data.video_url ?? null,
    parsed.data.resource_url ?? null,
    parsed.data.position ?? 0,
    parsed.data.duration_minutes ?? 0,
    parsed.data.is_free_preview ? 1 : 0,
    parsed.data.status ?? 'published',
    now,
    now
  );
  return created(c, { id: nid });
});

// Enrollment
courses.post('/enrollments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = enrollmentSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const studentId = parsed.data.student_id ?? user.id;
  // Students can only enroll themselves; staff can enroll anyone in their org.
  if (
    studentId !== user.id &&
    !canTeach(user, orgId) &&
    orgRole(user, orgId) !== 'organization_admin'
  ) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  if (!canAccessOrg(user, orgId) && studentId === user.id) {
    // Auto-join org on self-enrollment? Require membership: create it as student.
    await execute(
      db,
      'INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgId,
      user.id,
      'student',
      nowIso(),
      nowIso()
    );
  } else if (!canAccessOrg(user, orgId)) {
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  }
  const existing = await queryFirst(
    db,
    'SELECT id FROM enrollments WHERE course_id = ? AND student_id = ?',
    parsed.data.course_id,
    studentId
  );
  if (existing) return fail(c, 409, 'CONFLICT', t('enrolled', c.get('lang')));
  // Enrollment rules: windows, capacity, prerequisites, paid entitlement.
  const course = await queryFirst<{
    price: number;
    capacity: number | null;
    enrollment_start: string | null;
    enrollment_end: string | null;
  }>(
    db,
    'SELECT price, capacity, enrollment_start, enrollment_end FROM courses WHERE id = ?',
    parsed.data.course_id
  );
  const nowMs = Date.now();
  if (course?.enrollment_start && new Date(course.enrollment_start).getTime() > nowMs) {
    return fail(c, 400, 'ENROLLMENT_CLOSED', 'Enrollment has not opened yet');
  }
  if (course?.enrollment_end && new Date(course.enrollment_end).getTime() < nowMs) {
    return fail(c, 400, 'ENROLLMENT_CLOSED', 'Enrollment window has ended');
  }
  if (course?.capacity) {
    const count =
      (
        await queryFirst<{ n: number }>(
          db,
          "SELECT COUNT(*) as n FROM enrollments WHERE course_id = ? AND status = 'active'",
          parsed.data.course_id
        )
      )?.n ?? 0;
    if (count >= course.capacity) {
      return fail(c, 400, 'COURSE_FULL', 'Course is full; join the waitlist', { waitlist: true });
    }
  }
  const prereqs = await queryAll<{ requires_course_id: string }>(
    db,
    'SELECT requires_course_id FROM course_prerequisites WHERE course_id = ?',
    parsed.data.course_id
  );
  for (const p of prereqs) {
    const done = await queryFirst(
      db,
      "SELECT id FROM enrollments WHERE course_id = ? AND student_id = ? AND status = 'completed'",
      p.requires_course_id,
      studentId
    );
    if (!done) {
      return fail(c, 400, 'PREREQUISITE_NOT_MET', 'Complete the prerequisite course first', {
        requires_course_id: p.requires_course_id,
      });
    }
  }
  if ((course?.price ?? 0) > 0) {
    const ent = await queryFirst<{ expires_at: string | null }>(
      db,
      'SELECT expires_at FROM entitlements WHERE user_id = ? AND kind = ? AND reference_id = ?',
      studentId,
      'course',
      parsed.data.course_id
    );
    if (!ent || (ent.expires_at && new Date(ent.expires_at).getTime() < nowMs)) {
      return fail(
        c,
        402,
        'PAYMENT_REQUIRED',
        'This is a paid course; purchase or request an administrative grant first'
      );
    }
  }
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    parsed.data.course_id,
    studentId,
    parsed.data.status ?? 'active',
    now,
    now,
    now
  );
  await audit(c, 'enrollment.created', {
    entity: 'enrollment',
    organizationId: orgId,
    metadata: { course_id: parsed.data.course_id, student_id: studentId },
  });
  return created(c, { enrolled: true });
});

courses.get('/courses/:id/enrollments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student') {
    const rows = await queryAll(
      db,
      'SELECT * FROM enrollments WHERE course_id = ? AND student_id = ? LIMIT 200',
      c.req.param('id'),
      user.id
    );
    return ok(c, rows);
  }
  const rows = await queryAll(
    db,
    'SELECT e.*, u.name as student_name FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ? LIMIT 500',
    c.req.param('id')
  );
  return ok(c, rows);
});

// Lesson completion + course progress
courses.post('/lessons/:lessonId/complete', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ id: string; course_id: string }>(
    db,
    'SELECT id, course_id FROM lessons WHERE id = ?',
    c.req.param('lessonId')
  );
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const enr = await queryFirst<{ id: string; enrolled_at: string }>(
    db,
    'SELECT id, enrolled_at FROM enrollments WHERE course_id = ? AND student_id = ?',
    lesson.course_id,
    user.id
  );
  if (!enr && !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (enr) {
    // Paid access expiry.
    const course = await queryFirst<{ price: number }>(
      db,
      'SELECT price FROM courses WHERE id = ?',
      lesson.course_id
    );
    if ((course?.price ?? 0) > 0) {
      const ent = await queryFirst<{ expires_at: string | null }>(
        db,
        'SELECT expires_at FROM entitlements WHERE user_id = ? AND kind = ? AND reference_id = ?',
        user.id,
        'course',
        lesson.course_id
      );
      if (!ent || (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now())) {
        return fail(c, 403, 'ACCESS_EXPIRED', 'Course access has expired');
      }
    }
    // Lesson prerequisites must be completed first.
    const lpre = await queryAll<{ requires_lesson_id: string }>(
      db,
      'SELECT requires_lesson_id FROM lesson_prerequisites WHERE lesson_id = ?',
      lesson.id
    );
    for (const p of lpre) {
      const done = await queryFirst(
        db,
        'SELECT id FROM lesson_progress WHERE lesson_id = ? AND student_id = ? AND is_completed = 1',
        p.requires_lesson_id,
        user.id
      );
      if (!done)
        return fail(c, 400, 'PREREQUISITE_NOT_MET', 'Complete the prerequisite lesson first', {
          requires_lesson_id: p.requires_lesson_id,
        });
    }
    // Drip schedule.
    const drip = await queryFirst<{
      days_after_enrollment: number | null;
      unlock_at: string | null;
    }>(
      db,
      'SELECT days_after_enrollment, unlock_at FROM drip_rules WHERE lesson_id = ?',
      lesson.id
    );
    if (drip) {
      if (drip.unlock_at && new Date(drip.unlock_at).getTime() > Date.now()) {
        return fail(c, 400, 'LESSON_LOCKED', 'This lesson unlocks later', {
          unlock_at: drip.unlock_at,
        });
      }
      if (drip.days_after_enrollment !== null && enr.enrolled_at) {
        const unlock = new Date(enr.enrolled_at).getTime() + drip.days_after_enrollment * 86400000;
        if (unlock > Date.now()) {
          return fail(c, 400, 'LESSON_LOCKED', 'This lesson unlocks later', {
            unlock_at: new Date(unlock).toISOString(),
          });
        }
      }
    }
  }
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO lesson_progress (id, lesson_id, student_id, course_id, is_completed, completed_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(lesson_id, student_id) DO UPDATE SET is_completed = 1, completed_at = excluded.completed_at, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at',
    newId(),
    lesson.id,
    user.id,
    lesson.course_id,
    now,
    now,
    now,
    now
  );
  // Recompute course progress
  const total =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM lessons WHERE course_id = ?',
        lesson.course_id
      )
    )?.n ?? 0;
  const done =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE l.course_id = ? AND lp.student_id = ? AND lp.is_completed = 1',
        lesson.course_id,
        user.id
      )
    )?.n ?? 0;
  const percent = total === 0 ? 0 : Math.round((done / total) * 10000) / 100;
  await execute(
    db,
    'INSERT INTO course_progress (id, course_id, student_id, percent, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(course_id, student_id) DO UPDATE SET percent = excluded.percent, last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at',
    newId(),
    lesson.course_id,
    user.id,
    percent,
    now,
    now,
    now
  );
  await execute(
    db,
    'UPDATE enrollments SET progress_percent = ?, updated_at = ? WHERE course_id = ? AND student_id = ?',
    percent,
    now,
    lesson.course_id,
    user.id
  );
  await logActivity(db, {
    organization_id: orgId,
    user_id: user.id,
    kind: 'lesson.complete',
    entity: 'lesson',
    entity_id: lesson.id,
  });
  if (percent >= 100) {
    const existingCert = await queryFirst(
      db,
      'SELECT id FROM certificates WHERE course_id = ? AND student_id = ? AND revoked_at IS NULL',
      lesson.course_id,
      user.id
    );
    if (!existingCert) {
      const certNum = `CERT-${new Date().getUTCFullYear()}-${user.id.slice(0, 8).toUpperCase()}-${lesson.course_id.slice(0, 8).toUpperCase()}`;
      await execute(
        db,
        'INSERT INTO certificates (id, organization_id, course_id, student_id, certificate_number, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId(),
        orgId,
        lesson.course_id,
        user.id,
        certNum,
        now,
        now
      );
    }
  }
  return ok(c, { completed: true, progress_percent: percent });
});

courses.get('/courses/:id/progress', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const studentId = new URL(c.req.url).searchParams.get('student_id') ?? user.id;
  if (studentId !== user.id) {
    const role = orgRole(user, orgId);
    if (role === 'student') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    if (role === 'parent') {
      const link = await queryFirst(
        db,
        'SELECT id FROM parent_links WHERE parent_id = ? AND student_id = ?',
        user.id,
        studentId
      );
      if (!link) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  }
  const cp = await queryFirst(
    db,
    'SELECT * FROM course_progress WHERE course_id = ? AND student_id = ?',
    c.req.param('id'),
    studentId
  );
  const lessons = await queryAll(
    db,
    'SELECT l.id, l.title, COALESCE(lp.is_completed, 0) as is_completed FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = ? WHERE l.course_id = ? ORDER BY l.position ASC',
    studentId,
    c.req.param('id')
  );
  return ok(c, { progress: cp, lessons });
});

// ---- Section management (rename / reorder / delete) ----
courses.patch('/courses/sections/:sectionId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM course_sections WHERE id = ?',
    c.req.param('sectionId')
  );
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as {
    title?: string;
    position?: number;
  } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (typeof body.title === 'string' && body.title.length >= 1 && body.title.length <= 200) {
    sets.push('title = ?');
    params.push(body.title);
  }
  if (
    typeof body.position === 'number' &&
    Number.isInteger(body.position) &&
    body.position >= 0 &&
    body.position <= 10000
  ) {
    sets.push('position = ?');
    params.push(body.position);
  }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('sectionId'));
  await execute(db, `UPDATE course_sections SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

courses.delete('/courses/sections/:sectionId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM course_sections WHERE id = ?',
    c.req.param('sectionId')
  );
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'DELETE FROM course_sections WHERE id = ?', c.req.param('sectionId'));
  return ok(c, { deleted: true });
});

courses.post('/courses/:id/sections/reorder', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await courseOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { ordered_ids?: string[] } | null;
  if (!body?.ordered_ids || !Array.isArray(body.ordered_ids) || body.ordered_ids.length > 500) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const existing = await queryAll<{ id: string }>(
    db,
    'SELECT id FROM course_sections WHERE course_id = ?',
    c.req.param('id')
  );
  const valid = new Set(existing.map((s) => s.id));
  // Only accept IDs that belong to this course (prevents cross-course writes).
  const ordered = body.ordered_ids.filter((id) => typeof id === 'string' && valid.has(id));
  let pos = 0;
  for (const id of ordered) {
    await execute(
      db,
      'UPDATE course_sections SET position = ?, updated_at = ? WHERE id = ?',
      pos++,
      nowIso(),
      id
    );
  }
  return ok(c, { reordered: ordered.length });
});

// ---- Lesson management (edit / reorder / delete) ----
courses.patch('/lessons/:lessonId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM lessons WHERE id = ?',
    c.req.param('lessonId')
  );
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof body.title === 'string' && body.title.length >= 1 && body.title.length <= 200) {
    sets.push('title = ?');
    params.push(body.title);
  }
  if (typeof body.body === 'string' && body.body.length <= 50000) {
    sets.push('body = ?');
    params.push(body.body);
  }
  if (
    typeof body.video_url === 'string' &&
    body.video_url.length <= 2000 &&
    (body.video_url === '' || /^https?:\/\//.test(body.video_url))
  ) {
    sets.push('video_url = ?');
    params.push(body.video_url || null);
  }
  if (typeof body.resource_url === 'string' && body.resource_url.length <= 2000) {
    sets.push('resource_url = ?');
    params.push(body.resource_url || null);
  }
  if (body.status === 'draft' || body.status === 'published') {
    sets.push('status = ?');
    params.push(body.status);
  }
  if (
    typeof body.position === 'number' &&
    Number.isInteger(body.position) &&
    body.position >= 0 &&
    body.position <= 10000
  ) {
    sets.push('position = ?');
    params.push(body.position);
  }
  if (
    typeof body.duration_minutes === 'number' &&
    Number.isInteger(body.duration_minutes) &&
    body.duration_minutes >= 0
  ) {
    sets.push('duration_minutes = ?');
    params.push(body.duration_minutes);
  }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('lessonId'));
  await execute(db, `UPDATE lessons SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

courses.delete('/lessons/:lessonId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const lesson = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM lessons WHERE id = ?',
    c.req.param('lessonId')
  );
  if (!lesson) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, lesson.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'DELETE FROM lessons WHERE id = ?', c.req.param('lessonId'));
  return ok(c, { deleted: true });
});

courses.post('/courses/sections/:sectionId/lessons/reorder', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sec = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM course_sections WHERE id = ?',
    c.req.param('sectionId')
  );
  if (!sec) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, sec.course_id);
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { ordered_ids?: string[] } | null;
  if (!body?.ordered_ids || !Array.isArray(body.ordered_ids) || body.ordered_ids.length > 1000) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const existing = await queryAll<{ id: string }>(
    db,
    'SELECT id FROM lessons WHERE section_id = ?',
    c.req.param('sectionId')
  );
  const valid = new Set(existing.map((l) => l.id));
  const ordered = body.ordered_ids.filter((id) => typeof id === 'string' && valid.has(id));
  let pos = 0;
  for (const id of ordered) {
    await execute(
      db,
      'UPDATE lessons SET position = ?, updated_at = ? WHERE id = ?',
      pos++,
      nowIso(),
      id
    );
  }
  return ok(c, { reordered: ordered.length });
});

export default courses;

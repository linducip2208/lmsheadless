import { Hono } from 'hono';
import {
  announcementSchema,
  attendanceRecordSchema,
  replySchema,
  threadSchema,
} from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { orgSetting } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import { objectKey, putObject, validateUpload } from '../storage.js';
import { t } from '../i18n.js';

const ops = new Hono<{ Variables: AppVars }>();

// ---------- Attendance ----------
ops.post('/api/v1/attendance/sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    organization_id?: string;
    class_id?: string;
    course_id?: string;
    title?: string;
    session_date?: string;
  } | null;
  if (!body?.organization_id || !body?.title || !body?.session_date)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const role = orgRole(user, body.organization_id);
  if (
    role !== 'super_admin' &&
    role !== 'organization_admin' &&
    role !== 'teacher' &&
    role !== 'staff'
  ) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const nid = newId();
  const now = nowIso();
  await execute(
    c.get('db'),
    'INSERT INTO attendance_sessions (id, organization_id, class_id, course_id, title, session_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid,
    body.organization_id,
    body.class_id ?? null,
    body.course_id ?? null,
    body.title.slice(0, 200),
    body.session_date,
    user.id,
    now,
    now
  );
  return created(c, { id: nid });
});

ops.post('/api/v1/attendance/records', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = attendanceRecordSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const db = c.get('db');
  const sess = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM attendance_sessions WHERE id = ?',
    parsed.data.session_id
  );
  if (!sess) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const role = orgRole(user, sess.organization_id);
  if (
    role !== 'super_admin' &&
    role !== 'organization_admin' &&
    role !== 'teacher' &&
    role !== 'staff'
  ) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const now = nowIso();
  for (const r of parsed.data.records) {
    await execute(
      db,
      'INSERT INTO attendance_records (id, session_id, student_id, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at',
      newId(),
      parsed.data.session_id,
      r.student_id,
      r.status,
      r.note ?? null,
      now,
      now
    );
  }
  return created(c, { recorded: parsed.data.records.length });
});

ops.get('/api/v1/attendance/sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const sessions = await queryAll(
    c.get('db'),
    'SELECT * FROM attendance_sessions WHERE organization_id = ? ORDER BY session_date DESC',
    orgId
  );
  const out: unknown[] = [];
  for (const s of sessions) {
    const sid = (s as { id: string }).id;
    const records = await queryAll(
      c.get('db'),
      'SELECT * FROM attendance_records WHERE session_id = ?',
      sid
    );
    out.push({ ...s, records });
  }
  return ok(c, out);
});

// ---------- Certificates ----------
// Public verification (no auth): GET /api/v1/certificates/verify/:number
ops.get('/api/v1/certificates/verify/:number', async (c) => {
  const row = await queryFirst(
    c.get('db'),
    'SELECT cert.certificate_number, cert.issued_at, cert.expires_at, cert.revoked_at, u.name as student_name, co.title as course_title, o.name as organization_name FROM certificates cert JOIN users u ON u.id = cert.student_id JOIN courses co ON co.id = cert.course_id JOIN organizations o ON o.id = cert.organization_id WHERE cert.certificate_number = ?',
    c.req.param('number')
  );
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const rec = row as { revoked_at: string | null; expires_at: string | null };
  if (rec.revoked_at) {
    return ok(c, {
      valid: false,
      reason: 'revoked',
      certificate: { ...(row as object), revoked_at: undefined },
    });
  }
  const expired = rec.expires_at && new Date(rec.expires_at).getTime() < Date.now();
  return ok(c, { valid: !expired, ...(expired ? { reason: 'expired' } : {}), certificate: row });
});

ops.get('/api/v1/certificates', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const db = c.get('db');
  if (
    studentId !== user.id &&
    orgRole(user, url.searchParams.get('organization_id') ?? '') === 'student'
  ) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const rows = await queryAll(
    db,
    'SELECT * FROM certificates WHERE student_id = ? ORDER BY issued_at DESC LIMIT 200',
    studentId
  );
  // Tenant check: requester must share org or be owner/super.
  const filtered: unknown[] = [];
  for (const r of rows) {
    const rec = r as { organization_id: string; student_id: string };
    if (rec.student_id === user.id || user.isSuperAdmin || canAccessOrg(user, rec.organization_id))
      filtered.push(r);
  }
  return ok(c, filtered);
});

ops.post('/api/v1/certificates/issue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    course_id?: string;
    student_id?: string;
    template_id?: string;
  } | null;
  if (!body?.course_id || !body?.student_id)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    body.course_id
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, course.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  // Idempotent per student+course (no duplicate credentials on re-issue).
  const existing = await queryFirst<{ certificate_number: string }>(
    db,
    'SELECT certificate_number FROM certificates WHERE course_id = ? AND student_id = ? AND revoked_at IS NULL',
    body.course_id,
    body.student_id
  );
  if (existing) return ok(c, { certificate_number: existing.certificate_number, existing: true });
  const validityDays = Number(
    (await orgSetting(db, course.organization_id, 'cert_validity_days')) || 0
  );
  const expiresAt =
    validityDays > 0 ? new Date(Date.now() + validityDays * 86400000).toISOString() : null;
  const num = `CERT-${new Date().getUTCFullYear()}-${body.student_id.slice(0, 8).toUpperCase()}-${body.course_id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  await execute(
    db,
    'INSERT INTO certificates (id, organization_id, course_id, student_id, template_id, certificate_number, issued_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    course.organization_id,
    body.course_id,
    body.student_id,
    body.template_id ?? null,
    num,
    now,
    expiresAt,
    now
  );
  await audit(c, 'certificate.issued', {
    entity: 'certificate',
    organizationId: course.organization_id,
    metadata: { course_id: body.course_id, student_id: body.student_id },
  });
  return created(c, {
    certificate_number: num,
    verify_url: `/verify/${num}`,
    expires_at: expiresAt,
  });
});

ops.post('/api/v1/certificates/bulk-issue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    course_id?: string;
    student_ids?: string[];
  } | null;
  if (
    !body?.course_id ||
    !Array.isArray(body.student_ids) ||
    body.student_ids.length < 1 ||
    body.student_ids.length > 500
  ) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    body.course_id
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, course.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  let issued = 0;
  let skipped = 0;
  for (const sid of body.student_ids.filter((x) => typeof x === 'string')) {
    const member = await queryFirst(
      db,
      'SELECT user_id FROM organization_members WHERE organization_id = ? AND user_id = ?',
      course.organization_id,
      sid
    );
    if (!member) {
      skipped++;
      continue;
    }
    const existing = await queryFirst(
      db,
      'SELECT id FROM certificates WHERE course_id = ? AND student_id = ? AND revoked_at IS NULL',
      body.course_id,
      sid
    );
    if (existing) {
      skipped++;
      continue;
    }
    const num = `CERT-${new Date().getUTCFullYear()}-${sid.slice(0, 8).toUpperCase()}-${(body.course_id as string).slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}${issued}`;
    await execute(
      db,
      'INSERT INTO certificates (id, organization_id, course_id, student_id, certificate_number, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(),
      course.organization_id,
      body.course_id,
      sid,
      num,
      now,
      now
    );
    issued++;
  }
  await audit(c, 'certificates.bulk_issued', {
    entity: 'course',
    entityId: body.course_id,
    organizationId: course.organization_id,
    metadata: { issued, skipped },
  });
  return created(c, { issued, skipped });
});

ops.post('/api/v1/certificates/:id/revoke', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cert = await queryFirst<{ organization_id: string; revoked_at: string | null }>(
    db,
    'SELECT organization_id, revoked_at FROM certificates WHERE id = ?',
    c.req.param('id')
  );
  if (!cert) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const role = orgRole(user, cert.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (cert.revoked_at) return fail(c, 400, 'VALIDATION_ERROR', 'Already revoked');
  await execute(
    db,
    'UPDATE certificates SET revoked_at = ? WHERE id = ?',
    nowIso(),
    c.req.param('id')
  );
  await audit(c, 'certificate.revoked', {
    entity: 'certificate',
    entityId: c.req.param('id'),
    organizationId: cert.organization_id,
  });
  return ok(c, { revoked: true });
});

// ---------- Announcements / notifications ----------
ops.get('/api/v1/announcements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(
    c.get('db'),
    'SELECT * FROM announcements WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100',
    orgId
  );
  return ok(c, rows);
});

ops.post('/api/v1/announcements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = announcementSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const role = orgRole(user, parsed.data.organization_id);
  if (
    role !== 'super_admin' &&
    role !== 'organization_admin' &&
    role !== 'teacher' &&
    role !== 'staff'
  ) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const nid = newId();
  const now = nowIso();
  const db = c.get('db');
  await execute(
    db,
    'INSERT INTO announcements (id, organization_id, course_id, title, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid,
    parsed.data.organization_id,
    parsed.data.course_id ?? null,
    parsed.data.title,
    parsed.data.body,
    user.id,
    now,
    now
  );
  // Fan-out notifications to org members (bounded).
  const members = await queryAll<{ user_id: string }>(
    db,
    'SELECT user_id FROM organization_members WHERE organization_id = ? LIMIT 500',
    parsed.data.organization_id
  );
  for (const m of members) {
    await execute(
      db,
      'INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      m.user_id,
      parsed.data.title.slice(0, 200),
      `New announcement: ${parsed.data.title}`.slice(0, 1000),
      now
    );
  }
  await audit(c, 'announcement.published', {
    entity: 'announcement',
    entityId: nid,
    organizationId: parsed.data.organization_id,
  });
  return created(c, { id: nid });
});

ops.get('/api/v1/notifications', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const rows = await queryAll(
    c.get('db'),
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    user.id
  );
  return ok(c, rows);
});

ops.post('/api/v1/notifications/:id/read', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const row = await queryFirst<{ user_id: string }>(
    db,
    'SELECT user_id FROM notifications WHERE id = ?',
    c.req.param('id')
  );
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (row.user_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'UPDATE notifications SET is_read = 1 WHERE id = ?', c.req.param('id'));
  return ok(c, { read: true });
});

// ---------- Discussions ----------
ops.get('/api/v1/discussions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const courseId = new URL(c.req.url).searchParams.get('course_id');
  if (!courseId)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), {
      course_id: 'required',
    });
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    courseId
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const threads = await queryAll(
    db,
    'SELECT * FROM discussion_threads WHERE course_id = ? ORDER BY created_at DESC LIMIT 200',
    courseId
  );
  return ok(c, threads);
});

ops.post('/api/v1/discussions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = threadSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    parsed.data.course_id
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO discussion_threads (id, course_id, author_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nid,
    parsed.data.course_id,
    user.id,
    parsed.data.title,
    parsed.data.body,
    now,
    now
  );
  return created(c, { id: nid });
});

ops.get('/api/v1/discussions/:threadId/replies', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const thread = await queryFirst<{ course_id: string }>(
    db,
    'SELECT course_id FROM discussion_threads WHERE id = ?',
    c.req.param('threadId')
  );
  if (!thread) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    thread.course_id
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, course.organization_id);
  const showHidden = role !== 'student' && role !== 'parent';
  const rows = await queryAll(
    db,
    `SELECT * FROM discussion_replies WHERE thread_id = ? ${showHidden ? '' : 'AND is_hidden = 0'} ORDER BY created_at ASC LIMIT 500`,
    c.req.param('threadId')
  );
  return ok(c, rows);
});

ops.post('/api/v1/discussions/:threadId/replies', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = replySchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  const db = c.get('db');
  const thread = await queryFirst<{ course_id: string; is_locked: number }>(
    db,
    'SELECT course_id, is_locked FROM discussion_threads WHERE id = ?',
    c.req.param('threadId')
  );
  if (!thread) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (thread.is_locked) return fail(c, 400, 'THREAD_LOCKED', 'Thread is locked');
  const course = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ?',
    thread.course_id
  );
  if (!course || !canAccessOrg(user, course.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO discussion_replies (id, thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    nid,
    c.req.param('threadId'),
    user.id,
    parsed.data.body,
    now,
    now
  );
  return created(c, { id: nid });
});

// ---------- Reports ----------
ops.get('/api/v1/reports/organization-summary', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const students =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ? AND role = ?',
        orgId,
        'student'
      )
    )?.n ?? 0;
  const teachers =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ? AND role = ?',
        orgId,
        'teacher'
      )
    )?.n ?? 0;
  const courseCount =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM courses WHERE organization_id = ? AND deleted_at IS NULL',
        orgId
      )
    )?.n ?? 0;
  const enrollCount =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE co.organization_id = ?',
        orgId
      )
    )?.n ?? 0;
  const avgProgress =
    (
      await queryFirst<{ v: number | null }>(
        db,
        'SELECT AVG(progress_percent) as v FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE co.organization_id = ?',
        orgId
      )
    )?.v ?? 0;
  const quizAvg =
    (
      await queryFirst<{ v: number | null }>(
        db,
        'SELECT AVG(score) as v FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE q.organization_id = ?',
        orgId
      )
    )?.v ?? 0;
  return ok(c, {
    students,
    teachers,
    courses: courseCount,
    enrollments: enrollCount,
    avg_progress: avgProgress,
    avg_quiz_score: quizAvg,
  });
});

ops.get('/api/v1/reports/student-progress', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const db = c.get('db');
  if (studentId !== user.id) {
    const orgId = url.searchParams.get('organization_id');
    if (!orgId || !canAccessOrg(user, orgId))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
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
  const enrollments = await queryAll(
    db,
    'SELECT e.*, co.title as course_title FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE e.student_id = ?',
    studentId
  );
  const grades = await queryAll(
    db,
    'SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC LIMIT 100',
    studentId
  );
  const attempts = await queryAll(
    db,
    'SELECT qa.*, q.title as quiz_title FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.student_id = ? ORDER BY qa.created_at DESC LIMIT 100',
    studentId
  );
  // Upcoming work: open assignments + quizzes in enrolled, unfinished courses.
  const upcoming_assignments = await queryAll(
    db,
    `SELECT a.id, a.title, a.due_at, a.course_id, co.title as course_title FROM assignments a
     JOIN courses co ON co.id = a.course_id
     JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ? AND e.status = 'active'
     LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
     WHERE s.id IS NULL ORDER BY a.due_at ASC LIMIT 20`,
    studentId,
    studentId
  );
  const upcoming_quizzes = await queryAll(
    db,
    `SELECT q.id, q.title, q.course_id, co.title as course_title FROM quizzes q
     JOIN enrollments e ON e.course_id = q.course_id AND e.student_id = ? AND e.status = 'active'
     JOIN courses co ON co.id = q.course_id
     LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.student_id = ? AND qa.status IN ('submitted','graded')
     WHERE qa.id IS NULL ORDER BY q.created_at ASC LIMIT 20`,
    studentId,
    studentId
  );
  return ok(c, {
    enrollments,
    grades,
    quiz_attempts: attempts,
    upcoming_assignments,
    upcoming_quizzes,
  });
});

// ---------- Uploads ----------
ops.post('/api/v1/uploads', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  const prefix =
    String(form?.get('prefix') ?? 'general')
      .slice(0, 40)
      .replace(/[^a-z0-9-]/gi, '') || 'general';
  if (!(file instanceof File))
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), {
      file: 'required',
    });
  const err = validateUpload(file.name, file.type || 'application/octet-stream', file.size, 'any');
  if (err) return fail(c, 400, 'INVALID_FILE', err);
  const key = objectKey(prefix || 'general', file.name);
  const buf = await file.arrayBuffer();
  await putObject(c.get('env'), key, buf, file.type || 'application/octet-stream');
  const db = c.get('db');
  const orgId =
    typeof form?.get('organization_id') === 'string'
      ? String(form.get('organization_id')).slice(0, 64)
      : null;
  if (orgId && !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const fileId = newId();
  await execute(
    db,
    'INSERT INTO files (id, organization_id, owner_id, object_key, file_name, mime_type, size_bytes, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    fileId,
    orgId,
    user.id,
    key,
    file.name.slice(0, 255),
    file.type || 'application/octet-stream',
    file.size,
    prefix || 'general',
    nowIso()
  );
  return created(c, {
    id: fileId,
    key,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
});

// Completion per course: enrolled / completed / average progress.
ops.get('/api/v1/reports/completion', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const courses = await queryAll<{ id: string; title: string; code: string }>(
    db,
    'SELECT id, title, code FROM courses WHERE organization_id = ? AND deleted_at IS NULL ORDER BY title ASC LIMIT 500',
    orgId
  );
  // Single-pass aggregates (no per-course queries).
  const stats = await queryAll<{
    course_id: string;
    enrolled: number;
    completed: number;
    avg_p: number | null;
  }>(
    db,
    `SELECT course_id, COUNT(*) as enrolled,
     SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
     AVG(progress_percent) as avg_p
     FROM enrollments WHERE course_id IN (SELECT id FROM courses WHERE organization_id = ? AND deleted_at IS NULL)
     GROUP BY course_id`,
    orgId
  );
  const statMap = new Map(stats.map((s) => [s.course_id, s]));
  const out = courses.map((course) => {
    const s = statMap.get(course.id);
    const enrolled = s?.enrolled ?? 0;
    const completed = s?.completed ?? 0;
    return {
      course_id: course.id,
      title: course.title,
      code: course.code,
      enrolled,
      completed,
      completion_rate: enrolled ? Math.round((completed / enrolled) * 10000) / 100 : 0,
      avg_progress: Math.round(Number(s?.avg_p ?? 0) * 100) / 100,
    };
  });
  return ok(c, out);
});

// Quiz performance: attempts, average, pass rate, per-question correct rate.
ops.get('/api/v1/reports/quiz-performance', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const quizId = new URL(c.req.url).searchParams.get('quiz_id');
  if (!quizId)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), {
      quiz_id: 'required',
    });
  const db = c.get('db');
  const quiz = await queryFirst<{ organization_id: string; title: string; passing_score: number }>(
    db,
    'SELECT organization_id, title, passing_score FROM quizzes WHERE id = ?',
    quizId
  );
  if (!quiz || !canAccessOrg(user, quiz.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, quiz.organization_id);
  if (role === 'student' || role === 'parent')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const attempts =
    (
      await queryFirst<{ n: number }>(
        db,
        "SELECT COUNT(*) as n FROM quiz_attempts WHERE quiz_id = ? AND status IN ('submitted','graded')",
        quizId
      )
    )?.n ?? 0;
  const avg =
    (
      await queryFirst<{ v: number | null }>(
        db,
        "SELECT AVG(score) as v FROM quiz_attempts WHERE quiz_id = ? AND status IN ('submitted','graded')",
        quizId
      )
    )?.v ?? 0;
  const passed =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM quiz_attempts WHERE quiz_id = ? AND passed = 1',
        quizId
      )
    )?.n ?? 0;
  const questions = await queryAll<{ id: string; prompt: string }>(
    db,
    'SELECT id, prompt FROM questions WHERE quiz_id = ? ORDER BY position ASC',
    quizId
  );
  // Single aggregated pass over answers (no per-question queries).
  const answerStats = await queryAll<{ question_id: string; total: number; correct: number }>(
    db,
    `SELECT question_id, COUNT(*) as total, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct
     FROM quiz_answers WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?) GROUP BY question_id`,
    quizId
  );
  const statMap = new Map(answerStats.map((s) => [s.question_id, s]));
  const perQuestion = questions.map((q) => {
    const s = statMap.get(q.id);
    const total = s?.total ?? 0;
    const correct = s?.correct ?? 0;
    return {
      question_id: q.id,
      prompt: q.prompt.slice(0, 120),
      answered: total,
      correct_rate: total ? Math.round((correct / total) * 10000) / 100 : 0,
    };
  });
  return ok(c, {
    quiz_id: quizId,
    title: quiz.title,
    attempts,
    avg_score: Math.round(Number(avg) * 100) / 100,
    pass_rate: attempts ? Math.round((passed / attempts) * 10000) / 100 : 0,
    per_question: perQuestion,
  });
});

// Attendance summary: sessions + per-student percentages.
ops.get('/api/v1/reports/attendance', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent')
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const sessions =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM attendance_sessions WHERE organization_id = ?',
        orgId
      )
    )?.n ?? 0;
  // Single aggregated query over the org's records (no per-student queries).
  const rows = await queryAll<{ student_id: string; name: string; total: number; present: number }>(
    db,
    `SELECT r.student_id, u.name,
     COUNT(*) as total,
     SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END) as present
     FROM attendance_records r
     JOIN attendance_sessions se ON se.id = r.session_id
     JOIN users u ON u.id = r.student_id
     WHERE se.organization_id = ? GROUP BY r.student_id, u.name ORDER BY u.name ASC`,
    orgId
  );
  const out = rows.map((s) => ({
    student_id: s.student_id,
    name: s.name,
    recorded: s.total,
    attendance_pct: s.total ? Math.round((s.present / s.total) * 10000) / 100 : 0,
  }));
  return ok(c, { sessions, students: out });
});

// Teacher activity: courses taught, submissions graded, attempts graded.
ops.get('/api/v1/reports/teacher-activity', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (!['super_admin', 'organization_admin', 'staff'].includes(role ?? '')) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const db = c.get('db');
  // Single-pass aggregates (no per-teacher queries).
  const rows = await queryAll<{
    teacher_id: string;
    name: string;
    courses: number;
    graded: number;
  }>(
    db,
    `SELECT u.id as teacher_id, u.name,
     (SELECT COUNT(*) FROM course_instructors ci JOIN courses co ON co.id = ci.course_id WHERE ci.user_id = u.id AND co.organization_id = ?) as courses,
     (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.graded_by = u.id AND a.organization_id = ? AND s.status = 'graded') as graded
     FROM users u JOIN organization_members om ON om.user_id = u.id
     WHERE om.organization_id = ? AND om.role = 'teacher' AND u.deleted_at IS NULL ORDER BY u.name ASC`,
    orgId,
    orgId,
    orgId
  );
  const out = rows.map((tch) => ({
    teacher_id: tch.teacher_id,
    name: tch.name,
    courses: tch.courses,
    submissions_graded: tch.graded,
  }));
  return ok(c, out);
});

// Attendance summary for one student (self, teacher/admin, linked parent).
ops.get('/api/v1/attendance/student', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  if (studentId !== user.id) {
    const role = orgRole(user, orgId);
    if (role === 'student') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    if (role === 'parent') {
      const link = await queryFirst(
        c.get('db'),
        'SELECT id FROM parent_links WHERE parent_id = ? AND student_id = ?',
        user.id,
        studentId
      );
      if (!link) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  }
  const db = c.get('db');
  const records = await queryAll(
    db,
    'SELECT r.status, r.note, s.title, s.session_date FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id WHERE s.organization_id = ? AND r.student_id = ? ORDER BY s.session_date DESC LIMIT 200',
    orgId,
    studentId
  );
  const total = records.length;
  const present = records.filter(
    (r) =>
      (r as { status: string }).status === 'present' || (r as { status: string }).status === 'late'
  ).length;
  return ok(c, {
    records,
    total,
    attendance_pct: total ? Math.round((present / total) * 10000) / 100 : 0,
  });
});

export default ops;

import { Hono } from 'hono';
import { announcementSchema, attendanceRecordSchema, replySchema, threadSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import type { AppVars, AuthUser } from '../types.js';
import { objectKey, putObject, validateUpload } from '../storage.js';
import { t } from '../i18n.js';

const ops = new Hono<{ Variables: AppVars }>();

// ---------- Attendance ----------
ops.post('/api/v1/attendance/sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; class_id?: string; course_id?: string; title?: string; session_date?: string } | null;
  if (!body?.organization_id || !body?.title || !body?.session_date) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const role = orgRole(user, body.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher' && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO attendance_sessions (id, organization_id, class_id, course_id, title, session_date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, body.organization_id, body.class_id ?? null, body.course_id ?? null, body.title.slice(0, 200), body.session_date, user.id, now, now);
  return created(c, { id: nid });
});

ops.post('/api/v1/attendance/records', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = attendanceRecordSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const sess = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM attendance_sessions WHERE id = ?', parsed.data.session_id);
  if (!sess) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const role = orgRole(user, sess.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher' && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const now = nowIso();
  for (const r of parsed.data.records) {
    await execute(db, 'INSERT INTO attendance_records (id, session_id, student_id, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at',
      newId(), parsed.data.session_id, r.student_id, r.status, r.note ?? null, now, now);
  }
  return created(c, { recorded: parsed.data.records.length });
});

ops.get('/api/v1/attendance/sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const sessions = await queryAll(c.get('db'), 'SELECT * FROM attendance_sessions WHERE organization_id = ? ORDER BY session_date DESC', orgId);
  const out: unknown[] = [];
  for (const s of sessions) {
    const sid = (s as { id: string }).id;
    const records = await queryAll(c.get('db'), 'SELECT * FROM attendance_records WHERE session_id = ?', sid);
    out.push({ ...s, records });
  }
  return ok(c, out);
});

// ---------- Certificates ----------
// Public verification (no auth): GET /api/v1/certificates/verify/:number
ops.get('/api/v1/certificates/verify/:number', async (c) => {
  const row = await queryFirst(
    c.get('db'),
    'SELECT cert.certificate_number, cert.issued_at, u.name as student_name, co.title as course_title, o.name as organization_name FROM certificates cert JOIN users u ON u.id = cert.student_id JOIN courses co ON co.id = cert.course_id JOIN organizations o ON o.id = cert.organization_id WHERE cert.certificate_number = ?',
    c.req.param('number')
  );
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  return ok(c, { valid: true, certificate: row });
});

ops.get('/api/v1/certificates', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const db = c.get('db');
  if (studentId !== user.id && orgRole(user, url.searchParams.get('organization_id') ?? '') === 'student') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const rows = await queryAll(db, 'SELECT * FROM certificates WHERE student_id = ? ORDER BY issued_at DESC', studentId);
  // Tenant check: requester must share org or be owner/super.
  const filtered: unknown[] = [];
  for (const r of rows) {
    const rec = r as { organization_id: string; student_id: string };
    if (rec.student_id === user.id || user.isSuperAdmin || canAccessOrg(user, rec.organization_id)) filtered.push(r);
  }
  return ok(c, filtered);
});

ops.post('/api/v1/certificates/issue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { course_id?: string; student_id?: string; template_id?: string } | null;
  if (!body?.course_id || !body?.student_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ?', body.course_id);
  if (!course || !canAccessOrg(user, course.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, course.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  const num = `CERT-${new Date().getUTCFullYear()}-${body.student_id.slice(0, 8).toUpperCase()}-${body.course_id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  await execute(db, 'INSERT OR IGNORE INTO certificates (id, organization_id, course_id, student_id, template_id, certificate_number, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), course.organization_id, body.course_id, body.student_id, body.template_id ?? null, num, now, now);
  return created(c, { certificate_number: num });
});

// ---------- Announcements / notifications ----------
ops.get('/api/v1/announcements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM announcements WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100', orgId);
  return ok(c, rows);
});

ops.post('/api/v1/announcements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = announcementSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const role = orgRole(user, parsed.data.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin' && role !== 'teacher' && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const nid = newId();
  const now = nowIso();
  const db = c.get('db');
  await execute(db, 'INSERT INTO announcements (id, organization_id, course_id, title, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.organization_id, parsed.data.course_id ?? null, parsed.data.title, parsed.data.body, user.id, now, now);
  // Fan-out notifications to org members (bounded).
  const members = await queryAll<{ user_id: string }>(db, 'SELECT user_id FROM organization_members WHERE organization_id = ? LIMIT 500', parsed.data.organization_id);
  for (const m of members) {
    await execute(db, 'INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(), m.user_id, parsed.data.title.slice(0, 200), `New announcement: ${parsed.data.title}`.slice(0, 1000), now);
  }
  return created(c, { id: nid });
});

ops.get('/api/v1/notifications', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const rows = await queryAll(c.get('db'), 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', user.id);
  return ok(c, rows);
});

ops.post('/api/v1/notifications/:id/read', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const row = await queryFirst<{ user_id: string }>(db, 'SELECT user_id FROM notifications WHERE id = ?', c.req.param('id'));
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (row.user_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'UPDATE notifications SET is_read = 1 WHERE id = ?', c.req.param('id'));
  return ok(c, { read: true });
});

// ---------- Discussions ----------
ops.get('/api/v1/discussions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const courseId = new URL(c.req.url).searchParams.get('course_id');
  if (!courseId) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { course_id: 'required' });
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ?', courseId);
  if (!course || !canAccessOrg(user, course.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const threads = await queryAll(db, 'SELECT * FROM discussion_threads WHERE course_id = ? ORDER BY created_at DESC', courseId);
  return ok(c, threads);
});

ops.post('/api/v1/discussions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = threadSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const course = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ?', parsed.data.course_id);
  if (!course || !canAccessOrg(user, course.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO discussion_threads (id, course_id, author_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, user.id, parsed.data.title, parsed.data.body, now, now);
  return created(c, { id: nid });
});

ops.get('/api/v1/discussions/:threadId/replies', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const thread = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM discussion_threads WHERE id = ?', c.req.param('threadId'));
  if (!thread) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const course = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ?', thread.course_id);
  if (!course || !canAccessOrg(user, course.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, course.organization_id);
  const showHidden = role !== 'student' && role !== 'parent';
  const rows = await queryAll(db, `SELECT * FROM discussion_replies WHERE thread_id = ? ${showHidden ? '' : 'AND is_hidden = 0'} ORDER BY created_at ASC`, c.req.param('threadId'));
  return ok(c, rows);
});

ops.post('/api/v1/discussions/:threadId/replies', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const thread = await queryFirst<{ course_id: string; is_locked: number }>(db, 'SELECT course_id, is_locked FROM discussion_threads WHERE id = ?', c.req.param('threadId'));
  if (!thread) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (thread.is_locked) return fail(c, 400, 'THREAD_LOCKED', 'Thread is locked');
  const course = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ?', thread.course_id);
  if (!course || !canAccessOrg(user, course.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO discussion_replies (id, thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', nid, c.req.param('threadId'), user.id, parsed.data.body, now, now);
  return created(c, { id: nid });
});

// ---------- Reports ----------
ops.get('/api/v1/reports/organization-summary', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const students = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ? AND role = ?', orgId, 'student'))?.n ?? 0;
  const teachers = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM organization_members WHERE organization_id = ? AND role = ?', orgId, 'teacher'))?.n ?? 0;
  const courseCount = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM courses WHERE organization_id = ? AND deleted_at IS NULL', orgId))?.n ?? 0;
  const enrollCount = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE co.organization_id = ?', orgId))?.n ?? 0;
  const avgProgress = (await queryFirst<{ v: number | null }>(db, 'SELECT AVG(progress_percent) as v FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE co.organization_id = ?', orgId))?.v ?? 0;
  const quizAvg = (await queryFirst<{ v: number | null }>(db, 'SELECT AVG(score) as v FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE q.organization_id = ?', orgId))?.v ?? 0;
  return ok(c, { students, teachers, courses: courseCount, enrollments: enrollCount, avg_progress: avgProgress, avg_quiz_score: quizAvg });
});

ops.get('/api/v1/reports/student-progress', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const db = c.get('db');
  if (studentId !== user.id) {
    const orgId = url.searchParams.get('organization_id');
    if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const role = orgRole(user, orgId);
    if (role === 'student') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    if (role === 'parent') {
      const link = await queryFirst(db, 'SELECT id FROM parent_links WHERE parent_id = ? AND student_id = ?', user.id, studentId);
      if (!link) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  }
  const enrollments = await queryAll(db, 'SELECT e.*, co.title as course_title FROM enrollments e JOIN courses co ON co.id = e.course_id WHERE e.student_id = ?', studentId);
  const grades = await queryAll(db, 'SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC LIMIT 100', studentId);
  const attempts = await queryAll(db, 'SELECT qa.*, q.title as quiz_title FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.student_id = ? ORDER BY qa.created_at DESC LIMIT 100', studentId);
  return ok(c, { enrollments, grades, quiz_attempts: attempts });
});

// ---------- Uploads ----------
ops.post('/api/v1/uploads', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  const prefix = String(form?.get('prefix') ?? 'general').slice(0, 40).replace(/[^a-z0-9-]/gi, '') || 'general';
  if (!(file instanceof File)) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { file: 'required' });
  const err = validateUpload(file.name, file.type || 'application/octet-stream', file.size, 'any');
  if (err) return fail(c, 400, 'INVALID_FILE', err);
  const key = objectKey(prefix || 'general', file.name);
  const buf = await file.arrayBuffer();
  await putObject(c.get('env'), key, buf, file.type || 'application/octet-stream');
  const db = c.get('db');
  void db;
  void user;
  return created(c, { key, file_name: file.name, mime_type: file.type, size_bytes: file.size });
});

export default ops;

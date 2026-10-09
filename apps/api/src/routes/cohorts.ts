import { Hono } from 'hono';
import { cohortSchema, programSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach, isPrivileged } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const cohorts = new Hono<{ Variables: AppVars }>();

// ---------- Cohorts ----------
cohorts.post('/cohorts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = cohortSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO cohorts (id, organization_id, name, description, start_date, end_date, capacity, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.organization_id, parsed.data.name, parsed.data.description ?? null, parsed.data.start_date ?? null, parsed.data.end_date ?? null, parsed.data.capacity ?? null, user.id, now, now);
  return created(c, { id: nid });
});

cohorts.get('/cohorts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'parent') {
    // Parents see only cohorts containing their linked children.
    const links = await queryAll<{ student_id: string }>(db, 'SELECT student_id FROM parent_links WHERE parent_id = ? AND organization_id = ?', user.id, orgId);
    const ids = links.map((l) => l.student_id);
    if (!ids.length) return ok(c, []);
    const rows = await queryAll(db, `SELECT DISTINCT co.* FROM cohorts co JOIN cohort_members cm ON cm.cohort_id = co.id WHERE co.organization_id = ? AND cm.user_id IN (${ids.map(() => '?').join(',')})`, orgId, ...ids);
    return ok(c, rows);
  }
  if (role === 'student') {
    // Learners see only cohorts they belong to.
    const rows = await queryAll(c.get('db'), 'SELECT co.* FROM cohorts co JOIN cohort_members cm ON cm.cohort_id = co.id WHERE co.organization_id = ? AND cm.user_id = ?', orgId, user.id);
    return ok(c, rows);
  }
  const rows = await queryAll(c.get('db'), 'SELECT * FROM cohorts WHERE organization_id = ? ORDER BY created_at DESC', orgId);
  return ok(c, rows);
});

cohorts.post('/cohorts/:id/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cohort = await queryFirst<{ organization_id: string; capacity: number | null }>(db, 'SELECT organization_id, capacity FROM cohorts WHERE id = ?', c.req.param('id'));
  if (!cohort || !canTeach(user, cohort.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  if (!body?.user_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (cohort.capacity) {
    const count = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM cohort_members WHERE cohort_id = ?', c.req.param('id')))?.n ?? 0;
    const already = await queryFirst(db, 'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?', c.req.param('id'), body.user_id);
    if (!already && count >= cohort.capacity) return fail(c, 400, 'COHORT_FULL', 'Cohort has reached capacity');
  }
  await execute(db, 'INSERT INTO cohort_members (id, cohort_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cohort_id, user_id) DO UPDATE SET role = excluded.role',
    newId(), c.req.param('id'), body.user_id, body.role ?? 'student', nowIso());
  return created(c, { added: true });
});

cohorts.get('/cohorts/:id/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cohort = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM cohorts WHERE id = ?', c.req.param('id'));
  if (!cohort || !canAccessOrg(user, cohort.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT u.id, u.name, u.email, cm.role FROM cohort_members cm JOIN users u ON u.id = cm.user_id WHERE cm.cohort_id = ?', c.req.param('id'));
  return ok(c, rows);
});

cohorts.post('/cohorts/:id/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cohort = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM cohorts WHERE id = ?', c.req.param('id'));
  if (!cohort || !canTeach(user, cohort.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { course_id?: string } | null;
  if (!body?.course_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const courseOrgId = await courseOrg(db, body.course_id);
  if (courseOrgId !== cohort.organization_id) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  await execute(db, 'INSERT OR IGNORE INTO cohort_courses (cohort_id, course_id) VALUES (?, ?)', c.req.param('id'), body.course_id);
  return created(c, { added: true });
});

cohorts.get('/cohorts/:id/progress', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const cohort = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM cohorts WHERE id = ?', c.req.param('id'));
  if (!cohort || !canAccessOrg(user, cohort.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, cohort.organization_id);
  if (role === 'student' || role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const members = await queryAll<{ user_id: string; name: string }>(db, "SELECT cm.user_id, u.name FROM cohort_members cm JOIN users u ON u.id = cm.user_id WHERE cm.cohort_id = ? AND cm.role = 'student'", c.req.param('id'));
  const courses = await queryAll<{ course_id: string }>(db, 'SELECT course_id FROM cohort_courses WHERE cohort_id = ?', c.req.param('id'));
  const out: unknown[] = [];
  for (const m of members) {
    let sum = 0;
    for (const course of courses) {
      const p = await queryFirst<{ progress_percent: number | null }>(db, 'SELECT progress_percent FROM enrollments WHERE course_id = ? AND student_id = ?', course.course_id, m.user_id);
      sum += p?.progress_percent ?? 0;
    }
    out.push({ student_id: m.user_id, name: m.name, avg_progress: courses.length ? Math.round((sum / courses.length) * 100) / 100 : 0 });
  }
  return ok(c, { courses: courses.length, students: out });
});

// ---------- Programs / learning paths ----------
cohorts.post('/programs', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = programSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO programs (id, organization_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', nid, parsed.data.organization_id, parsed.data.name, parsed.data.description ?? null, now, now);
  return created(c, { id: nid });
});

cohorts.get('/programs', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM programs WHERE organization_id = ? ORDER BY created_at DESC', orgId);
  return ok(c, rows);
});

cohorts.post('/programs/:id/courses', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const program = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM programs WHERE id = ?', c.req.param('id'));
  if (!program || !canTeach(user, program.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { course_id?: string; position?: number; is_required?: boolean; prerequisite_program_course_id?: string } | null;
  if (!body?.course_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const courseOrgId = await courseOrg(db, body.course_id);
  if (courseOrgId !== program.organization_id) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  try {
    await execute(db, 'INSERT INTO program_courses (id, program_id, course_id, position, is_required, prerequisite_program_course_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(), c.req.param('id'), body.course_id, body.position ?? 0, body.is_required === false ? 0 : 1, body.prerequisite_program_course_id ?? null, nowIso());
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { added: true });
});

cohorts.get('/programs/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const program = await queryFirst<{ organization_id: string; name: string }>(db, 'SELECT organization_id, name FROM programs WHERE id = ?', c.req.param('id'));
  if (!program || !canAccessOrg(user, program.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const courses = await queryAll(db, 'SELECT pc.*, co.title as course_title FROM program_courses pc JOIN courses co ON co.id = pc.course_id WHERE pc.program_id = ? ORDER BY pc.position ASC', c.req.param('id'));
  // Learner view: annotate lock state per prerequisite chain.
  const annotated: unknown[] = [];
  const completed = new Set<string>();
  for (const pc of courses as { course_id: string; prerequisite_program_course_id: string | null }[]) {
    const enr = await queryFirst<{ status: string }>(db, 'SELECT status FROM enrollments WHERE course_id = ? AND student_id = ?', pc.course_id, user.id);
    const locked = pc.prerequisite_program_course_id
      ? !(await queryFirst(db, 'SELECT e.id FROM enrollments e JOIN program_courses pc2 ON pc2.course_id = e.course_id WHERE pc2.id = ? AND e.student_id = ? AND e.status = ?', pc.prerequisite_program_course_id, user.id, 'completed'))
      : false;
    if (enr?.status === 'completed') completed.add(pc.course_id);
    annotated.push({ ...(pc as object), enrollment_status: enr?.status ?? null, locked });
  }
  return ok(c, { program, courses: annotated });
});

// ---------- Competencies ----------
cohorts.post('/competencies', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; name?: string; description?: string } | null;
  if (!body?.organization_id || !body?.name) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!canTeach(user, body.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  await execute(c.get('db'), 'INSERT INTO competencies (id, organization_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)', nid, body.organization_id, body.name.slice(0, 150), body.description ?? null, nowIso());
  return created(c, { id: nid });
});

cohorts.post('/competencies/:id/assess', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const comp = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM competencies WHERE id = ?', c.req.param('id'));
  if (!comp || !canTeach(user, comp.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { student_id?: string; status?: string; note?: string } | null;
  if (!body?.student_id || !['achieved', 'pending', 'not_achieved'].includes(body.status ?? '')) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const now = nowIso();
  await execute(db, 'INSERT INTO competency_evidence (id, competency_id, student_id, status, note, reviewed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), c.req.param('id'), body.student_id, body.status ?? 'pending', body.note ?? null, user.id, now, now);
  if (body.status === 'achieved') {
    await audit(c, 'competency.achieved', { entity: 'competency', entityId: c.req.param('id'), organizationId: comp.organization_id, metadata: { student_id: body.student_id } });
  }
  return created(c, { recorded: true });
});

cohorts.get('/competencies/student', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  if (studentId !== user.id && !canTeach(user, orgId) && !isPrivileged(user, orgId)) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const rows = await queryAll(c.get('db'), 'SELECT ce.*, comp.name as competency_name FROM competency_evidence ce JOIN competencies comp ON comp.id = ce.competency_id WHERE ce.student_id = ? AND comp.organization_id = ? ORDER BY ce.created_at DESC', studentId, orgId);
  return ok(c, rows);
});

export default cohorts;

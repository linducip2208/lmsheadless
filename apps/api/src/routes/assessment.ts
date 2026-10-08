import { Hono } from 'hono';
import { assignmentSchema, gradeSchema, questionSchema, quizSchema, submissionGradeSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const assess = new Hono<{ Variables: AppVars }>();

async function quizOrg(db: Parameters<typeof queryFirst>[0], quizId: string): Promise<string | null> {
  const r = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM quizzes WHERE id = ?', quizId);
  return r?.organization_id ?? null;
}
async function courseOrg(db: Parameters<typeof queryFirst>[0], courseId: string): Promise<string | null> {
  const r = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM courses WHERE id = ? AND deleted_at IS NULL', courseId);
  return r?.organization_id ?? null;
}
function canTeach(user: AuthUser, orgId: string): boolean {
  const r = orgRole(user, orgId);
  return r === 'super_admin' || r === 'organization_admin' || r === 'teacher' || r === 'staff';
}

// ---- Quizzes ----
assess.post('/quizzes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = quizSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO quizzes (id, course_id, lesson_id, organization_id, title, description, passing_score, max_attempts, time_limit_minutes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, parsed.data.lesson_id ?? null, orgId, parsed.data.title, parsed.data.description ?? null,
    parsed.data.passing_score, parsed.data.max_attempts ?? 3, parsed.data.time_limit_minutes ?? 0, user.id, now, now);
  return created(c, { id: nid });
});

assess.get('/quizzes', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const courseId = url.searchParams.get('course_id');
  const db = c.get('db');
  if (!courseId) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { course_id: 'required' });
  const orgId = await courseOrg(db, courseId);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT * FROM quizzes WHERE course_id = ? ORDER BY created_at DESC', courseId);
  return ok(c, rows);
});

assess.post('/quizzes/:id/questions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await quizOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = questionSchema.safeParse({ ...(body as object ?? {}), quiz_id: c.req.param('id') });
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (parsed.data.type === 'multiple_choice' && (!parsed.data.options || parsed.data.options.filter((o) => o.is_correct).length !== 1)) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { options: 'Exactly one correct option required' });
  }
  const qid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO questions (id, quiz_id, type, prompt, points, position, correct_answer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    qid, c.req.param('id'), parsed.data.type, parsed.data.prompt, parsed.data.points, parsed.data.position ?? 0, parsed.data.correct_answer ?? null, now, now);
  if (parsed.data.options) {
    let pos = 0;
    for (const o of parsed.data.options) {
      await execute(db, 'INSERT INTO question_options (id, question_id, label, is_correct, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId(), qid, o.label.slice(0, 1000), o.is_correct ? 1 : 0, pos++, now);
    }
  }
  return created(c, { id: qid });
});

assess.get('/quizzes/:id/questions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await quizOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const questions = await queryAll<{ id: string; type: string; prompt: string; points: number; position: number }>(db, 'SELECT id, type, prompt, points, position FROM questions WHERE quiz_id = ? ORDER BY position ASC', c.req.param('id'));
  const role = orgRole(user, orgId);
  const isStudent = role === 'student';
  const out: unknown[] = [];
  for (const q of questions) {
    const opts = await queryAll<{ id: string; label: string; position: number }>(db, 'SELECT id, label, position FROM question_options WHERE question_id = ? ORDER BY position ASC', q.id);
    // Never leak correctness to students via read API.
    out.push(isStudent ? { ...q, options: opts } : { ...q, options: await queryAll(db, 'SELECT * FROM question_options WHERE question_id = ? ORDER BY position ASC', q.id) });
  }
  return ok(c, out);
});

// Attempt: start + submit answers + auto-score
assess.post('/quizzes/:id/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const quiz = await queryFirst<{ id: string; max_attempts: number; organization_id: string }>(db, 'SELECT id, max_attempts, organization_id FROM quizzes WHERE id = ?', c.req.param('id'));
  if (!quiz) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, quiz.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const count = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', quiz.id, user.id))?.n ?? 0;
  if (count >= quiz.max_attempts) return fail(c, 400, 'ATTEMPT_LIMIT', t('attempt_limit', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO quiz_attempts (id, quiz_id, student_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', nid, quiz.id, user.id, 'in_progress', now, now, now);
  return created(c, { id: nid });
});

assess.post('/quiz-attempts/:attemptId/submit', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { answers?: { question_id: string; option_id?: string; answer_text?: string }[] } | null;
  if (!body?.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const attempt = await queryFirst<{ id: string; quiz_id: string; student_id: string; status: string }>(db, 'SELECT id, quiz_id, student_id, status FROM quiz_attempts WHERE id = ?', c.req.param('attemptId'));
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (attempt.student_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (attempt.status !== 'in_progress') return fail(c, 400, 'VALIDATION_ERROR', 'Attempt already submitted');
  const orgId = await quizOrg(db, attempt.quiz_id);
  if (!orgId) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const quiz = await queryFirst<{ passing_score: number }>(db, 'SELECT passing_score FROM quizzes WHERE id = ?', attempt.quiz_id);
  let earned = 0;
  let total = 0;
  const now = nowIso();
  for (const a of body.answers.slice(0, 200)) {
    if (!a.question_id) continue;
    const q = await queryFirst<{ id: string; type: string; points: number; correct_answer: string | null }>(db, 'SELECT id, type, points, correct_answer FROM questions WHERE id = ? AND quiz_id = ?', a.question_id, attempt.quiz_id);
    if (!q) continue;
    total += q.points;
    let correct = 0;
    if (q.type === 'multiple_choice' && a.option_id) {
      const opt = await queryFirst<{ is_correct: number }>(db, 'SELECT is_correct FROM question_options WHERE id = ? AND question_id = ?', a.option_id, q.id);
      correct = opt?.is_correct === 1 ? 1 : 0;
    } else if (q.type === 'true_false' && typeof a.answer_text === 'string') {
      correct = (a.answer_text.toLowerCase() === (q.correct_answer ?? '').toLowerCase()) ? 1 : 0;
    } else if (q.type === 'short_answer' && typeof a.answer_text === 'string') {
      correct = (a.answer_text.trim().toLowerCase() === (q.correct_answer ?? '').trim().toLowerCase()) ? 1 : 0;
    }
    const pts = correct ? q.points : 0;
    earned += pts;
    await execute(db, 'INSERT INTO quiz_answers (id, attempt_id, question_id, option_id, answer_text, is_correct, points_awarded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id, question_id) DO UPDATE SET option_id = excluded.option_id, answer_text = excluded.answer_text, is_correct = excluded.is_correct, points_awarded = excluded.points_awarded',
      newId(), attempt.id, q.id, a.option_id ?? null, (a.answer_text ?? '').slice(0, 5000), correct, pts, now);
  }
  const pct = total === 0 ? 0 : Math.round((earned / total) * 10000) / 100;
  const passed = pct >= (quiz?.passing_score ?? 70) ? 1 : 0;
  await execute(db, 'UPDATE quiz_attempts SET status = ?, score = ?, passed = ?, submitted_at = ?, updated_at = ? WHERE id = ?', 'graded', pct, passed, now, now, attempt.id);
  return ok(c, { score: pct, passed: passed === 1, earned, total });
});

// ---- Assignments ----
assess.post('/assignments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO assignments (id, course_id, organization_id, title, description, due_at, max_score, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, orgId, parsed.data.title, parsed.data.description ?? null, parsed.data.due_at ?? null, parsed.data.max_score, user.id, now, now);
  return created(c, { id: nid });
});

assess.get('/assignments', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const courseId = new URL(c.req.url).searchParams.get('course_id');
  if (!courseId) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { course_id: 'required' });
  const db = c.get('db');
  const orgId = await courseOrg(db, courseId);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(db, 'SELECT * FROM assignments WHERE course_id = ? ORDER BY created_at DESC', courseId);
  return ok(c, rows);
});

assess.post('/assignments/:id/submissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const asg = await queryFirst<{ id: string; organization_id: string; due_at: string | null }>(db, 'SELECT id, organization_id, due_at FROM assignments WHERE id = ?', c.req.param('id'));
  if (!asg) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, asg.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { body?: string } | null;
  if (!body?.body || body.body.length < 1) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const late = asg.due_at && new Date(asg.due_at).getTime() < Date.now() ? 'late' : 'submitted';
  const now = nowIso();
  await execute(db, 'INSERT INTO submissions (id, assignment_id, student_id, body, status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(assignment_id, student_id) DO UPDATE SET body = excluded.body, status = excluded.status, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at',
    newId(), asg.id, user.id, body.body.slice(0, 20000), late, now, now, now);
  return created(c, { submitted: true, status: late });
});

assess.post('/submissions/:id/grade', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = submissionGradeSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const sub = await queryFirst<{ id: string; assignment_id: string }>(db, 'SELECT id, assignment_id FROM submissions WHERE id = ?', c.req.param('id'));
  if (!sub) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const asg = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM assignments WHERE id = ?', sub.assignment_id);
  if (!asg || !canTeach(user, asg.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  await execute(db, 'UPDATE submissions SET score = ?, feedback = ?, status = ?, graded_by = ?, graded_at = ?, updated_at = ? WHERE id = ?',
    parsed.data.score, parsed.data.feedback ?? null, 'graded', user.id, now, now, sub.id);
  return ok(c, { graded: true });
});

// ---- Grades ----
assess.post('/grades', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = gradeSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const now = nowIso();
  await execute(db, 'INSERT INTO grades (id, course_id, student_id, category, score, max_score, feedback, graded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), parsed.data.course_id, parsed.data.student_id, parsed.data.category ?? 'general', parsed.data.score, parsed.data.max_score ?? 100, parsed.data.feedback ?? null, user.id, now, now);
  return created(c, { graded: true });
});

assess.get('/grades', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const courseId = url.searchParams.get('course_id');
  const studentId = url.searchParams.get('student_id') ?? user.id;
  const db = c.get('db');
  if (courseId) {
    const orgId = await courseOrg(db, courseId);
    if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    if (studentId !== user.id) {
      const role = orgRole(user, orgId);
      if (role === 'student') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
      if (role === 'parent') {
        const link = await queryFirst(db, 'SELECT id FROM parent_links WHERE parent_id = ? AND student_id = ?', user.id, studentId);
        if (!link) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
      }
    }
    const rows = await queryAll(db, 'SELECT * FROM grades WHERE course_id = ? AND student_id = ? ORDER BY created_at DESC', courseId, studentId);
    return ok(c, rows);
  }
  // All grades for a student across teacher's org courses: teachers only.
  const rows = await queryAll(db, 'SELECT * FROM grades WHERE student_id = ? ORDER BY created_at DESC LIMIT 200', studentId);
  if (studentId !== user.id) {
    // Verify requester shares org with at least one of these or is super admin.
    if (!user.isSuperAdmin && rows.length > 0) {
      const courseIds = [...new Set(rows.map((r) => (r as { course_id: string }).course_id))];
      let allowed = false;
      for (const cid of courseIds) {
        const oid = await courseOrg(db, cid);
        if (oid && canAccessOrg(user, oid) && orgRole(user, oid) !== 'student') { allowed = true; break; }
      }
      if (!allowed) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
  }
  return ok(c, rows);
});

export default assess;

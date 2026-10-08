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

// Grading queue: ungraded submissions + recent attempts needing review.
assess.get('/grading/queue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  if (!canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const submissions = await queryAll(db,
    `SELECT s.*, u.name as student_name, a.title as assignment_title FROM submissions s
     JOIN assignments a ON a.id = s.assignment_id JOIN users u ON u.id = s.student_id
     WHERE a.organization_id = ? AND s.status != 'graded' ORDER BY s.submitted_at ASC LIMIT 100`, orgId);
  const attempts = await queryAll(db,
    `SELECT qa.*, u.name as student_name, q.title as quiz_title FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id JOIN users u ON u.id = qa.student_id
     WHERE q.organization_id = ? AND qa.status IN ('submitted','graded') ORDER BY qa.submitted_at DESC LIMIT 100`, orgId);
  return ok(c, { submissions, attempts });
});

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
  await execute(db, 'INSERT INTO quizzes (id, course_id, lesson_id, organization_id, title, description, passing_score, max_attempts, time_limit_minutes, shuffle_questions, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, parsed.data.lesson_id ?? null, orgId, parsed.data.title, parsed.data.description ?? null,
    parsed.data.passing_score, parsed.data.max_attempts ?? 3, parsed.data.time_limit_minutes ?? 0, parsed.data.shuffle_questions ? 1 : 0, user.id, now, now);
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
  const quiz = await queryFirst<{ shuffle_questions: number }>(db, 'SELECT shuffle_questions FROM quizzes WHERE id = ?', c.req.param('id'));
  const list = [...questions];
  // Randomize order per fetch for students when the quiz enables shuffling.
  // Correctness is never exposed; only the presentation order changes.
  if (isStudent && quiz?.shuffle_questions === 1) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const out: unknown[] = [];
  for (const q of list) {
    const opts = await queryAll<{ id: string; label: string; position: number }>(db, 'SELECT id, label, position FROM question_options WHERE question_id = ? ORDER BY position ASC', q.id);
    // Never leak correctness to students via read API.
    out.push(isStudent ? { ...q, options: opts } : { ...q, options: await queryAll(db, 'SELECT * FROM question_options WHERE question_id = ? ORDER BY position ASC', q.id) });
  }
  return ok(c, out);
});

// Attempt: start + submit answers + auto-score
assess.get('/quizzes/:id/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await quizOrg(db, c.req.param('id'));
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student') {
    const mine = await queryAll(db, 'SELECT id, status, score, passed, started_at, submitted_at FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? ORDER BY started_at DESC', c.req.param('id'), user.id);
    return ok(c, mine);
  }
  if (role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT qa.*, u.name as student_name FROM quiz_attempts qa JOIN users u ON u.id = qa.student_id WHERE qa.quiz_id = ? ORDER BY qa.started_at DESC LIMIT 200', c.req.param('id'));
  return ok(c, rows);
});

assess.post('/quizzes/:id/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const quiz = await queryFirst<{ id: string; max_attempts: number; organization_id: string; time_limit_minutes: number }>(db, 'SELECT id, max_attempts, organization_id, time_limit_minutes FROM quizzes WHERE id = ?', c.req.param('id'));
  if (!quiz) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, quiz.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  // One active attempt per student: resume instead of duplicating.
  const active = await queryFirst<{ id: string }>(db, "SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status = 'in_progress'", quiz.id, user.id);
  if (active) return ok(c, { id: active.id, resumed: true });
  const count = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', quiz.id, user.id))?.n ?? 0;
  if (count >= quiz.max_attempts) return fail(c, 400, 'ATTEMPT_LIMIT', t('attempt_limit', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  const expiresAt = quiz.time_limit_minutes > 0 ? new Date(Date.now() + quiz.time_limit_minutes * 60000).toISOString() : null;
  await execute(db, 'INSERT INTO quiz_attempts (id, quiz_id, student_id, status, started_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', nid, quiz.id, user.id, 'in_progress', now, expiresAt, now, now);
  return created(c, { id: nid, expires_at: expiresAt });
});

assess.post('/quiz-attempts/:attemptId/submit', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { answers?: { question_id: string; option_id?: string; answer_text?: string }[] } | null;
  if (!body?.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const attempt = await queryFirst<{ id: string; quiz_id: string; student_id: string; status: string; expires_at: string | null }>(db, 'SELECT id, quiz_id, student_id, status, expires_at FROM quiz_attempts WHERE id = ?', c.req.param('attemptId'));
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (attempt.student_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (attempt.status !== 'in_progress') return fail(c, 400, 'VALIDATION_ERROR', 'Attempt already submitted');
  if (attempt.expires_at && new Date(attempt.expires_at).getTime() < Date.now()) {
    await execute(db, "UPDATE quiz_attempts SET status = 'expired', updated_at = ? WHERE id = ?", nowIso(), attempt.id);
    return fail(c, 400, 'ATTEMPT_EXPIRED', 'Time limit exceeded; start a new attempt if attempts remain');
  }
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
  await execute(db, 'INSERT INTO assignments (id, course_id, organization_id, title, description, due_at, max_score, allow_resubmit, allowed_types, max_size_bytes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, orgId, parsed.data.title, parsed.data.description ?? null, parsed.data.due_at ?? null, parsed.data.max_score,
    parsed.data.allow_resubmit === false ? 0 : 1, parsed.data.allowed_types ?? null, parsed.data.max_size_bytes ?? 26214400, user.id, now, now);
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

assess.get('/assignments/:id/submissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const asg = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM assignments WHERE id = ?', c.req.param('id'));
  if (!asg) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, asg.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, asg.organization_id);
  if (role === 'student') {
    const rows = await queryAll(db, 'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', c.req.param('id'), user.id);
    return ok(c, rows);
  }
  if (role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT s.*, u.name as student_name FROM submissions s JOIN users u ON u.id = s.student_id WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC', c.req.param('id'));
  return ok(c, rows);
});

assess.post('/assignments/:id/submissions', requireAuth(), async (c) => {  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const asg = await queryFirst<{ id: string; organization_id: string; due_at: string | null; allow_resubmit: number }>(db, 'SELECT id, organization_id, due_at, allow_resubmit FROM assignments WHERE id = ?', c.req.param('id'));
  if (!asg) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, asg.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { body?: string } | null;
  if (!body?.body || body.body.length < 1) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const prior = await queryFirst<{ status: string }>(db, 'SELECT status FROM submissions WHERE assignment_id = ? AND student_id = ?', asg.id, user.id);
  if (prior && (prior.status === 'graded' || !asg.allow_resubmit)) {
    return fail(c, 409, 'RESUBMIT_NOT_ALLOWED', 'Resubmission is not allowed for this assignment');
  }
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

// ---- Question management (edit / reorder / delete) ----
assess.patch('/questions/:questionId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const q = await queryFirst<{ quiz_id: string }>(db, 'SELECT quiz_id FROM questions WHERE id = ?', c.req.param('questionId'));
  if (!q) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await quizOrg(db, q.quiz_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { prompt?: string; points?: number; position?: number; correct_answer?: string } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof body.prompt === 'string' && body.prompt.length >= 1 && body.prompt.length <= 5000) { sets.push('prompt = ?'); params.push(body.prompt); }
  if (typeof body.points === 'number' && body.points >= 0 && body.points <= 1000) { sets.push('points = ?'); params.push(body.points); }
  if (typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0) { sets.push('position = ?'); params.push(body.position); }
  if (typeof body.correct_answer === 'string' && body.correct_answer.length <= 5000) { sets.push('correct_answer = ?'); params.push(body.correct_answer); }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('questionId'));
  await execute(db, `UPDATE questions SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

assess.delete('/questions/:questionId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const q = await queryFirst<{ quiz_id: string }>(db, 'SELECT quiz_id FROM questions WHERE id = ?', c.req.param('questionId'));
  if (!q) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await quizOrg(db, q.quiz_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'DELETE FROM questions WHERE id = ?', c.req.param('questionId'));
  return ok(c, { deleted: true });
});

assess.post('/quizzes/:id/questions/reorder', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await quizOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { ordered_ids?: string[] } | null;
  if (!body?.ordered_ids || !Array.isArray(body.ordered_ids) || body.ordered_ids.length > 500) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const existing = await queryAll<{ id: string }>(db, 'SELECT id FROM questions WHERE quiz_id = ?', c.req.param('id'));
  const valid = new Set(existing.map((x) => x.id));
  const ordered = body.ordered_ids.filter((id) => typeof id === 'string' && valid.has(id));
  let pos = 0;
  for (const id of ordered) {
    await execute(db, 'UPDATE questions SET position = ?, updated_at = ? WHERE id = ?', pos++, nowIso(), id);
  }
  return ok(c, { reordered: ordered.length });
});

// ---- Manual grading (short answer / review) ----
assess.post('/quiz-attempts/:attemptId/grade', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { question_id?: string; points_awarded?: number } | null;
  if (!body?.question_id || typeof body.points_awarded !== 'number' || body.points_awarded < 0) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const attempt = await queryFirst<{ id: string; quiz_id: string }>(db, 'SELECT id, quiz_id FROM quiz_attempts WHERE id = ?', c.req.param('attemptId'));
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await quizOrg(db, attempt.quiz_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const question = await queryFirst<{ points: number }>(db, 'SELECT points FROM questions WHERE id = ? AND quiz_id = ?', body.question_id, attempt.quiz_id);
  if (!question) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const capped = Math.min(body.points_awarded, question.points);
  await execute(db, 'UPDATE quiz_answers SET points_awarded = ?, is_correct = ? WHERE attempt_id = ? AND question_id = ?',
    capped, capped >= question.points ? 1 : 0, attempt.id, body.question_id);
  // Recompute attempt score deterministically from stored points.
  const totals = await queryFirst<{ earned: number | null; total: number | null }>(db,
    'SELECT SUM(qa.points_awarded) as earned, SUM(q.points) as total FROM quiz_answers qa JOIN questions q ON q.id = qa.question_id WHERE qa.attempt_id = ?',
    attempt.id);
  const quiz = await queryFirst<{ passing_score: number }>(db, 'SELECT passing_score FROM quizzes WHERE id = ?', attempt.quiz_id);
  const pct = !totals?.total ? 0 : Math.round(((totals.earned ?? 0) / totals.total) * 10000) / 100;
  await execute(db, 'UPDATE quiz_attempts SET score = ?, passed = ?, updated_at = ? WHERE id = ?',
    pct, pct >= (quiz?.passing_score ?? 70) ? 1 : 0, nowIso(), attempt.id);
  return ok(c, { graded: true, score: pct });
});

export default assess;

import { Hono } from 'hono';
import { bankSchema, bankQuestionSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, requireAuth } from '../middleware/common.js';
import { quizOrg, canTeach } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const banks = new Hono<{ Variables: AppVars }>();

banks.post('/question-banks', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = bankSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(c.get('db'), 'INSERT INTO question_banks (id, organization_id, course_id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.organization_id, parsed.data.course_id ?? null, parsed.data.name, parsed.data.description ?? null, user.id, now, now);
  return created(c, { id: nid });
});

banks.get('/question-banks', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM question_banks WHERE organization_id = ? ORDER BY created_at DESC LIMIT 200', orgId);
  return ok(c, rows);
});

banks.post('/question-banks/:id/questions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const bank = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM question_banks WHERE id = ?', c.req.param('id'));
  if (!bank || !canTeach(user, bank.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = await c.req.json().catch(() => null);
  const parsed = bankQuestionSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if ((parsed.data.type === 'multiple_choice' || parsed.data.type === 'single_choice') && (!parsed.data.options || parsed.data.options.filter((o) => o.is_correct).length < 1)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'At least one correct option required');
  }
  if ((parsed.data.type === 'matching' || parsed.data.type === 'ordering') && (!parsed.data.options || parsed.data.options.length < 2 || parsed.data.options.some((o) => !o.match_value))) {
    return fail(c, 400, 'VALIDATION_ERROR', 'Matching/ordering options require match_value on every option');
  }
  const qid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO bank_questions (id, bank_id, type, prompt, points, difficulty, category, tags, explanation, correct_answer, negative_points, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    qid, c.req.param('id'), parsed.data.type, parsed.data.prompt, parsed.data.points, parsed.data.difficulty ?? 'medium',
    parsed.data.category ?? null, parsed.data.tags ?? null, parsed.data.explanation ?? null, parsed.data.correct_answer ?? null,
    parsed.data.negative_points ?? 0, now, now);
  let pos = 0;
  for (const o of parsed.data.options ?? []) {
    await execute(db, 'INSERT INTO bank_options (id, bank_question_id, label, match_value, is_correct, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(), qid, o.label.slice(0, 1000), o.match_value ?? null, o.is_correct ? 1 : 0, pos++, now);
  }
  return created(c, { id: qid });
});

banks.get('/question-banks/:id/questions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const bank = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM question_banks WHERE id = ?', c.req.param('id'));
  if (!bank || !canAccessOrg(user, bank.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = (user.memberships.find((m) => m.organization_id === bank.organization_id)?.role ?? '') as string;
  void role;
  const questions = await queryAll<{ id: string; type: string; prompt: string; points: number; difficulty: string; category: string | null }>(db, 'SELECT id, type, prompt, points, difficulty, category FROM bank_questions WHERE bank_id = ? ORDER BY created_at DESC LIMIT 200', c.req.param('id'));
  return ok(c, questions);
});

// Copy a bank question into a quiz (snapshot; bank stays the source of truth).
banks.post('/question-banks/:bankId/questions/:qId/copy-to/:quizId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const bank = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM question_banks WHERE id = ?', c.req.param('bankId'));
  const orgId = await quizOrg(db, c.req.param('quizId'));
  if (!bank || !orgId || bank.organization_id !== orgId || !canTeach(user, orgId)) {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const bq = await queryFirst<{ id: string; type: string; prompt: string; points: number; difficulty: string; explanation: string | null; correct_answer: string | null; negative_points: number }>(
    db, 'SELECT id, type, prompt, points, difficulty, explanation, correct_answer, negative_points FROM bank_questions WHERE id = ? AND bank_id = ?', c.req.param('qId'), c.req.param('bankId'));
  if (!bq) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const now = nowIso();
  const nid = newId();
  const maxPos = (await queryFirst<{ v: number | null }>(db, 'SELECT MAX(position) as v FROM questions WHERE quiz_id = ?', c.req.param('quizId')))?.v ?? -1;
  await execute(db, 'INSERT INTO questions (id, quiz_id, type, prompt, points, position, correct_answer, difficulty, explanation, negative_points, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, c.req.param('quizId'), bq.type, bq.prompt, bq.points, maxPos + 1, bq.correct_answer, bq.difficulty, bq.explanation, bq.negative_points, now, now);
  const opts = await queryAll<{ label: string; match_value: string | null; is_correct: number; position: number }>(db, 'SELECT label, match_value, is_correct, position FROM bank_options WHERE bank_question_id = ? ORDER BY position ASC', bq.id);
  for (const o of opts) {
    const optId = newId();
    await execute(db, 'INSERT INTO question_options (id, question_id, label, is_correct, position, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      optId, nid, o.label, o.is_correct, o.position, now);
    if (o.match_value) {
      await execute(db, 'UPDATE question_options SET match_value = ? WHERE id = ?', o.match_value, optId).catch(() => undefined);
    }
  }
  return created(c, { id: nid });
});

// Pool: draw N random bank questions into the quiz when an attempt starts.
banks.post('/quizzes/:id/pools', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const orgId = await quizOrg(db, c.req.param('id'));
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { bank_id?: string; pick_count?: number } | null;
  if (!body?.bank_id || !body.pick_count || body.pick_count < 1 || body.pick_count > 100) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const bank = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM question_banks WHERE id = ?', body.bank_id);
  if (!bank || bank.organization_id !== orgId) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(db, 'INSERT INTO quiz_pools (id, quiz_id, bank_id, pick_count, created_at) VALUES (?, ?, ?, ?, ?)', newId(), c.req.param('id'), body.bank_id, body.pick_count, nowIso());
  return created(c, { added: true });
});

// Autosave in-progress answers (recovery; not a submission).
banks.put('/quiz-attempts/:attemptId/autosave', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const attempt = await queryFirst<{ student_id: string; status: string }>(db, 'SELECT student_id, status FROM quiz_attempts WHERE id = ?', c.req.param('attemptId'));
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (attempt.student_id !== user.id || attempt.status !== 'in_progress') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { question_id?: string; payload?: unknown } | null;
  if (!body?.question_id || body.payload === undefined) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  await execute(db, 'INSERT INTO attempt_autosaves (attempt_id, question_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(attempt_id, question_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at',
    c.req.param('attemptId'), body.question_id, JSON.stringify(body.payload).slice(0, 20000), nowIso());
  return ok(c, { saved: true });
});

banks.get('/quiz-attempts/:attemptId/autosave', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const attempt = await queryFirst<{ student_id: string }>(db, 'SELECT student_id FROM quiz_attempts WHERE id = ?', c.req.param('attemptId'));
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (attempt.student_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(db, 'SELECT question_id, payload, updated_at FROM attempt_autosaves WHERE attempt_id = ?', c.req.param('attemptId'));
  return ok(c, rows);
});

export default banks;

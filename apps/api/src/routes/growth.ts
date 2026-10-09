import { Hono } from 'hono';
import { aiJobSchema, exerciseSchema, invitationSchema } from '@lms/validation';import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach, isPrivileged, parseCsv, toCsv } from '../access.js';
import { hashPassword, randomToken, sha256Hex } from '../crypto.js';
import type { AppVars, AuthUser } from '../types.js';
import type { D1Like } from '../db.js';
import { t } from '../i18n.js';

const growth = new Hono<{ Variables: AppVars }>();

export async function logActivity(db: D1Like, entry: { organization_id?: string | null; user_id?: string | null; kind: string; entity?: string; entity_id?: string }): Promise<void> {
  try {
    await execute(db, 'INSERT INTO activity_log (id, organization_id, user_id, kind, entity, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(), entry.organization_id ?? null, entry.user_id ?? null, entry.kind, entry.entity ?? null, entry.entity_id ?? null, nowIso());
  } catch { /* never break primary actions */ }
}

// ================= AI framework (optional, BYOK, review-gated) =================
const AI_KINDS = new Set(['outline', 'lesson_draft', 'questions', 'summary']);

const AI_PROMPTS: Record<string, (input: string) => { system: string; user: string }> = {
  outline: (input) => ({ system: 'You draft course outlines. Reply with a numbered outline only.', user: `Draft a course outline for: ${input}` }),
  lesson_draft: (input) => ({ system: 'You draft lesson content in markdown. Mark uncertain facts with [verify].', user: `Draft a lesson about: ${input}` }),
  questions: (input) => ({ system: 'You write quiz questions with answers marked. Keep it short.', user: `Write 5 quiz questions about: ${input}` }),
  summary: (input) => ({ system: 'You summarize study material into key points.', user: `Summarize: ${input}` }),
};

growth.get('/ai/config', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !isPrivileged(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const row = await queryFirst<{ provider: string; model: string | null; monthly_limit: number; used_count: number; retention_days: number }>(
    c.get('db'), 'SELECT provider, model, monthly_limit, used_count, retention_days FROM ai_configs WHERE organization_id = ?', orgId);
  return ok(c, row ?? { provider: 'disabled', model: null, monthly_limit: 0, used_count: 0, retention_days: 30 });
});

growth.put('/ai/config', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; provider?: string; model?: string; base_url?: string; api_key?: string; monthly_limit?: number } | null;
  if (!body?.organization_id || !body?.provider) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!isPrivileged(user, body.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (!['disabled', 'mock', 'openai-compatible'].includes(body.provider)) return fail(c, 400, 'VALIDATION_ERROR', 'Unknown provider');
  if (body.provider === 'openai-compatible' && (!body.base_url || !body.api_key)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'openai-compatible requires base_url and api_key (BYOK)');
  }
  const now = nowIso();
  // API keys live in the org's own database (platform-encrypted at rest);
  // production deployments should prefer secret bindings — see docs/ai.md.
  await execute(c.get('db'), 'INSERT INTO ai_configs (organization_id, provider, model, api_key_ref, monthly_limit, used_count, retention_days, updated_at) VALUES (?, ?, ?, ?, ?, 0, 30, ?) ON CONFLICT(organization_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, api_key_ref = excluded.api_key_ref, monthly_limit = excluded.monthly_limit, updated_at = excluded.updated_at',
    body.organization_id, body.provider, body.model ?? null, body.api_key ? `${body.base_url ?? ''}::${body.api_key}` : null, body.monthly_limit ?? 100, now);
  await audit(c, 'ai.configured', { organizationId: body.organization_id, metadata: { provider: body.provider } });
  return ok(c, { saved: true });
});

function mockOutput(kind: string, input: string): string {
  const src = input.slice(0, 200);
  if (kind === 'outline') return `[AI draft — requires instructor review]\n1. Introduction to ${src}\n2. Core concepts\n3. Guided practice\n4. Assessment`;
  if (kind === 'questions') return `[AI draft — requires instructor review]\nQ1. What is the main idea of ${src}? (short answer)\nQ2. True/false: key statement about ${src}.`;
  if (kind === 'summary') return `[AI draft — requires instructor review]\nKey points about ${src}:\n- Point one\n- Point two`;
  return `[AI draft — requires instructor review]\nLesson draft about ${src}.\n[verify] Fill in examples before publishing.`;
}

growth.post('/ai/jobs', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = aiJobSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!AI_KINDS.has(parsed.data.kind)) return fail(c, 400, 'VALIDATION_ERROR', 'Unknown job kind');
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const cfg = await queryFirst<{ provider: string; model: string | null; api_key_ref: string | null; monthly_limit: number; used_count: number }>(
    db, 'SELECT provider, model, api_key_ref, monthly_limit, used_count FROM ai_configs WHERE organization_id = ?', parsed.data.organization_id);
  if (!cfg || cfg.provider === 'disabled') return fail(c, 400, 'AI_DISABLED', 'AI is not configured for this organization');
  if (cfg.monthly_limit > 0 && cfg.used_count >= cfg.monthly_limit) return fail(c, 400, 'AI_LIMIT', 'Monthly AI usage limit reached');
  const input = (parsed.data.input_ref ?? '').slice(0, 4000);
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO ai_jobs (id, organization_id, kind, status, input_ref, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', nid, parsed.data.organization_id, parsed.data.kind, 'pending', input, user.id, now, now);
  await execute(db, 'UPDATE ai_configs SET used_count = used_count + 1 WHERE organization_id = ?', parsed.data.organization_id);
  if (cfg.provider === 'mock') {
    const output = mockOutput(parsed.data.kind, input);
    await execute(db, "UPDATE ai_jobs SET status = 'completed', output_ref = ?, updated_at = ? WHERE id = ?", output, now, nid);
    return created(c, { id: nid, status: 'completed', output, note: 'Mock provider output. Instructor review required before publishing.' });
  }
  // openai-compatible (BYOK): bounded synchronous call with timeout.
  try {
    const [baseUrl, apiKey] = (cfg.api_key_ref ?? '::').split('::');
    const prompts = AI_PROMPTS[parsed.data.kind](input);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: cfg.model ?? 'gpt-4o-mini', messages: [{ role: 'system', content: prompts.system }, { role: 'user', content: prompts.user }], max_tokens: 1200 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const output = (j.choices?.[0]?.message?.content ?? '').slice(0, 12000);
    if (!output) throw new Error('Empty provider response');
    await execute(db, "UPDATE ai_jobs SET status = 'completed', output_ref = ?, updated_at = ? WHERE id = ?", `[AI-generated — requires instructor review]\n${output}`, now, nid);
    return created(c, { id: nid, status: 'completed', note: 'Instructor review required before publishing.' });
  } catch (e) {
    await execute(db, "UPDATE ai_jobs SET status = 'failed', output_ref = ?, updated_at = ? WHERE id = ?", `Provider error: ${e instanceof Error ? e.message : 'unknown'}`.slice(0, 500), now, nid);
    return fail(c, 502, 'AI_PROVIDER_ERROR', 'AI provider call failed; no charges applied beyond rate counting');
  }
});

growth.post('/ai/jobs/:id/review', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const job = await queryFirst<{ organization_id: string; status: string }>(db, 'SELECT organization_id, status FROM ai_jobs WHERE id = ?', c.req.param('id'));
  if (!job || !canTeach(user, job.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (job.status !== 'completed') return fail(c, 400, 'VALIDATION_ERROR', 'Only completed outputs can be reviewed');
  const body = (await c.req.json().catch(() => null)) as { approve?: boolean } | null;
  await execute(db, 'UPDATE ai_jobs SET reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?', user.id, nowIso(), nowIso(), c.req.param('id'));
  await audit(c, body?.approve ? 'ai.approved' : 'ai.rejected', { entity: 'ai_job', entityId: c.req.param('id'), organizationId: job.organization_id });
  return ok(c, { reviewed: true, approved: body?.approve === true });
});

growth.get('/ai/jobs', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT id, kind, status, created_by, created_at, reviewed_at FROM ai_jobs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100', orgId);
  return ok(c, rows);
});

// ================= Coding exercises =================
growth.post('/exercises', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = exerciseSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const orgId = await courseOrg(db, parsed.data.course_id);
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO exercises (id, course_id, lesson_id, title, statement, language, examples, execution_mode, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.course_id, parsed.data.lesson_id ?? null, parsed.data.title, parsed.data.statement, parsed.data.language ?? 'javascript', parsed.data.examples ?? null, 'static', user.id, now, now);
  return created(c, { id: nid });
});

growth.get('/exercises', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const courseId = new URL(c.req.url).searchParams.get('course_id');
  if (!courseId) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), { course_id: 'required' });
  const db = c.get('db');
  const orgId = await courseOrg(db, courseId);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  // Never leak example solutions/expected outputs beyond the statement.
  const rows = await queryAll(db, 'SELECT id, title, language, execution_mode, max_attempts FROM exercises WHERE course_id = ? ORDER BY created_at ASC', courseId);
  return ok(c, rows);
});

growth.post('/exercises/:id/submissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const ex = await queryFirst<{ course_id: string; execution_mode: string; max_attempts: number }>(db, 'SELECT course_id, execution_mode, max_attempts FROM exercises WHERE id = ?', c.req.param('id'));
  if (!ex) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = await courseOrg(db, ex.course_id);
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { code?: string; execute?: boolean } | null;
  if (!body?.code || body.code.length > 100000) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (body.execute) {
    // Live execution requires a configured, tested sandbox integration.
    // None ships in this release: refuse instead of running learner code anywhere privileged.
    return fail(c, 400, 'EXECUTION_UNAVAILABLE', 'Live code execution is disabled: no sandbox provider is configured. Submit for instructor review instead. See docs/exercises.md');
  }
  const count = (await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM exercise_submissions WHERE exercise_id = ? AND student_id = ?', c.req.param('id'), user.id))?.n ?? 0;
  if (count >= ex.max_attempts) return fail(c, 400, 'ATTEMPT_LIMIT', t('attempt_limit', c.get('lang')));
  const nid = newId();
  await execute(db, 'INSERT INTO exercise_submissions (id, exercise_id, student_id, code, created_at) VALUES (?, ?, ?, ?, ?)', nid, c.req.param('id'), user.id, body.code.slice(0, 100000), nowIso());
  await logActivity(db, { organization_id: orgId, user_id: user.id, kind: 'exercise.submit', entity: 'exercise', entity_id: c.req.param('id') });
  return created(c, { id: nid, status: 'submitted', note: 'Stored for instructor review; not auto-executed' });
});

growth.post('/exercise-submissions/:id/feedback', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sub = await queryFirst<{ exercise_id: string }>(db, 'SELECT exercise_id FROM exercise_submissions WHERE id = ?', c.req.param('id'));
  if (!sub) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const ex = await queryFirst<{ course_id: string }>(db, 'SELECT course_id FROM exercises WHERE id = ?', sub.exercise_id);
  const orgId = ex ? await courseOrg(db, ex.course_id) : null;
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { feedback?: string; status?: string } | null;
  if (!body?.feedback || !['reviewed', 'approved', 'needs_work'].includes(body.status ?? '')) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  await execute(db, 'UPDATE exercise_submissions SET feedback = ?, status = ? WHERE id = ?', body.feedback.slice(0, 10000), body.status ?? 'reviewed', c.req.param('id'));
  return ok(c, { reviewed: true });
});

// ================= Email queue =================
growth.post('/email/queue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; to?: string; subject?: string; body?: string } | null;
  if (!body?.to || !body?.subject || !body?.body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.to)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid recipient');
  const orgId = body.organization_id ?? user.memberships[0]?.organization_id;
  if (!orgId || !canTeach(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  await execute(c.get('db'), 'INSERT INTO email_queue (id, organization_id, to_email, subject, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nid, orgId, body.to.toLowerCase(), body.subject.slice(0, 200), body.body.slice(0, 50000), nowIso(), nowIso());
  return created(c, { id: nid, status: 'queued' });
});

growth.get('/email/queue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !isPrivileged(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const status = url.searchParams.get('status');
  const rows = await queryAll(c.get('db'),
    `SELECT id, to_email, subject, status, attempts, created_at FROM email_queue WHERE organization_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC LIMIT 200`,
    ...(status ? [orgId, status] : [orgId]));
  return ok(c, rows);
});

growth.post('/email/queue/:id/send', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const msg = await queryFirst<{ organization_id: string | null; to_email: string; subject: string; body_html: string; status: string; attempts: number }>(
    db, 'SELECT organization_id, to_email, subject, body_html, status, attempts FROM email_queue WHERE id = ?', c.req.param('id'));
  if (!msg || !msg.organization_id || !isPrivileged(user, msg.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (msg.status === 'sent') return ok(c, { already_sent: true });
  if (msg.attempts >= 5) return fail(c, 400, 'RETRY_EXHAUSTED', 'Maximum delivery attempts reached');
  const org = await queryFirst<{ settings: string | null }>(db, 'SELECT settings FROM organizations WHERE id = ?', msg.organization_id);
  let settings: Record<string, string> = {};
  try { settings = JSON.parse(org?.settings ?? '{}') as Record<string, string>; } catch { /* none */ }
  const now = nowIso();
  if (!settings.email_api_url || !settings.email_api_key) {
    // Dev/log driver: record as sent for local development honesty.
    await execute(db, "UPDATE email_queue SET status = 'sent', provider_msg_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", `log-${Date.now()}`, now, c.req.param('id'));
    return ok(c, { sent: true, driver: 'log', note: 'No email provider configured; recorded via log driver for development' });
  }
  try {
    const res = await fetch(settings.email_api_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.email_api_key}` },
      body: JSON.stringify({ to: msg.to_email, subject: msg.subject, html: msg.body_html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { id?: string };
    await execute(db, "UPDATE email_queue SET status = 'sent', provider_msg_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", String(j.id ?? `http-${Date.now()}`), now, c.req.param('id'));
    return ok(c, { sent: true, driver: 'http' });
  } catch (e) {
    await execute(db, "UPDATE email_queue SET status = 'failed', attempts = attempts + 1, updated_at = ? WHERE id = ?", now, c.req.param('id'));
    return fail(c, 502, 'EMAIL_FAILED', e instanceof Error ? e.message : 'Delivery failed');
  }
});

// ================= Invitations =================
growth.post('/invitations', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = invitationSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const role = orgRole(user, parsed.data.organization_id);
  if (role !== 'super_admin' && role !== 'organization_admin') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if ((parsed.data.role as string) === 'super_admin') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const token = randomToken(32);
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO invitations (id, organization_id, email, role, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.organization_id, parsed.data.email.toLowerCase(), parsed.data.role, await sha256Hex(token), new Date(Date.now() + 7 * 86400000).toISOString(), user.id, now);
  await audit(c, 'invitation.created', { entity: 'invitation', entityId: nid, organizationId: parsed.data.organization_id });
  // The admin forwards this URL; the token itself is never stored raw.
  return created(c, { id: nid, invite_url: `/invite/${token}`, expires_in_days: 7 });
});

growth.post('/invitations/accept', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: string; name?: string; password?: string } | null;
  if (!body?.token || !body?.name || !body?.password || body.password.length < 8) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const db = c.get('db');
  const inv = await queryFirst<{ id: string; organization_id: string; email: string; role: string; expires_at: string; accepted_at: string | null }>(
    db, 'SELECT id, organization_id, email, role, expires_at, accepted_at FROM invitations WHERE token_hash = ?', await sha256Hex(body.token));
  if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) {
    return fail(c, 400, 'INVALID_INVITE', 'Invitation is invalid, used, or expired');
  }
  const existing = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', inv.email);
  const now = nowIso();
  const userId = existing?.id ?? newId();
  if (!existing) {
    await execute(db, 'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      userId, inv.email, await hashPassword(body.password), body.name.slice(0, 120), 'active', now, now);
  }
  await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role',
    newId(), inv.organization_id, userId, inv.role, now, now);
  await execute(db, 'UPDATE invitations SET accepted_at = ? WHERE id = ?', now, inv.id);
  await audit(c, 'invitation.accepted', { entity: 'invitation', entityId: inv.id, organizationId: inv.organization_id });
  return created(c, { accepted: true });
});

// ================= Org units =================
growth.post('/org-units', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; name?: string; parent_id?: string } | null;
  if (!body?.organization_id || !body?.name) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!isPrivileged(user, body.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  await execute(c.get('db'), 'INSERT INTO org_units (id, organization_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)', nid, body.organization_id, body.parent_id ?? null, body.name.slice(0, 150), nowIso());
  return created(c, { id: nid });
});

growth.get('/org-units', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM org_units WHERE organization_id = ? ORDER BY name ASC', orgId);
  return ok(c, rows);
});

growth.post('/org-units/:id/members', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const unit = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM org_units WHERE id = ?', c.req.param('id'));
  if (!unit || !isPrivileged(user, unit.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { user_id?: string } | null;
  if (!body?.user_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  await execute(db, 'INSERT OR IGNORE INTO org_unit_members (unit_id, user_id) VALUES (?, ?)', c.req.param('id'), body.user_id);
  return created(c, { added: true });
});

// ================= CSV imports (dry-run, row errors, partial-success) =================
const IMPORT_SPECS: Record<string, { required: string[] }> = {
  users: { required: ['email', 'name'] },
  enrollments: { required: ['student_email', 'course_code'] },
  grades: { required: ['student_email', 'course_code', 'score'] },
  attendance: { required: ['student_email', 'session_id', 'status'] },
};

growth.post('/imports', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const contentType = c.req.header('content-type') ?? '';
  let kind = '';
  let orgId = '';
  let dryRun = true;
  let rawRows: string[][] = [];
  let header: string[] = [];
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    kind = String(form?.get('kind') ?? '');
    orgId = String(form?.get('organization_id') ?? '');
    dryRun = String(form?.get('dry_run') ?? 'true') !== 'false';
    const file = form?.get('file');
    if (!(file instanceof File)) return fail(c, 400, 'VALIDATION_ERROR', 'file is required');
    if (file.size > 5 * 1024 * 1024) return fail(c, 400, 'VALIDATION_ERROR', 'File exceeds 5MB');
    const parsed = parseCsv(await file.text());
    if (parsed.errors.length && !parsed.rows.length) return fail(c, 400, 'VALIDATION_ERROR', parsed.errors.join('; '));
    header = parsed.header;
    rawRows = parsed.rows;
  } else {
    const body = (await c.req.json().catch(() => null)) as { kind?: string; organization_id?: string; dry_run?: boolean; rows?: Record<string, string>[] } | null;
    if (!body?.kind || !body?.organization_id || !Array.isArray(body.rows)) {
      return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
    }
    kind = body.kind;
    orgId = body.organization_id;
    dryRun = body.dry_run !== false;
    header = [...new Set(body.rows.flatMap((r) => Object.keys(r)))];
    rawRows = body.rows.map((r) => header.map((h) => r[h] ?? ''));
  }
  const spec = IMPORT_SPECS[kind];
  if (!spec || !orgId) return fail(c, 400, 'VALIDATION_ERROR', 'Unknown import kind or missing organization');
  if (!isPrivileged(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const missing = spec.required.filter((r) => !header.includes(r));
  if (missing.length) return fail(c, 400, 'VALIDATION_ERROR', `Missing columns: ${missing.join(', ')}`);
  if (rawRows.length > 5000) return fail(c, 400, 'VALIDATION_ERROR', 'Maximum 5000 rows per import');
  const errors: { row: number; errors: string[] }[] = [];
  const valid: Record<string, string>[] = [];
  rawRows.forEach((cells, i) => {
    const rowNum = i + 2;
    const row: Record<string, string> = {};
    header.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
    const rowErrors: string[] = [];
    for (const req of spec.required) {
      if (!row[req]) rowErrors.push(`${req} is required`);
    }
    // Formula-injection guard: never silently import executable-looking cells.
    for (const [k, v] of Object.entries(row)) {
      if (/^[=+\-@]/.test(v)) rowErrors.push(`${k} looks like a spreadsheet formula and was rejected`);
    }
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) rowErrors.push('email is invalid');
    if (row.student_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.student_email)) rowErrors.push('student_email is invalid');
    if (row.score !== undefined && row.score !== '' && Number.isNaN(Number(row.score))) rowErrors.push('score must be numeric');
    if (row.status && !['present', 'absent', 'late', 'excused'].includes(row.status)) rowErrors.push('status must be present|absent|late|excused');
    if (rowErrors.length) errors.push({ row: rowNum, errors: rowErrors });
    else valid.push(row);
  });
  const now = nowIso();
  const jobId = newId();
  await execute(db, 'INSERT INTO import_jobs (id, organization_id, kind, status, total_rows, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    jobId, orgId, kind, dryRun ? 'dry_run' : 'pending', rawRows.length, user.id, now, now);
  if (dryRun) {
    await execute(db, 'UPDATE import_jobs SET error_report = ?, updated_at = ? WHERE id = ?', JSON.stringify({ errors }).slice(0, 50000), now, jobId);
    return ok(c, { job_id: jobId, dry_run: true, total: rawRows.length, valid: valid.length, errors });
  }
  // Process valid rows; record explicit partial success (never silent).
  let processed = 0;
  const processErrors = [...errors];
  for (let i = 0; i < valid.length; i++) {
    const row = valid[i];
    try {
      if (kind === 'users') {
        const exists = await queryFirst(db, 'SELECT id FROM users WHERE email = ?', row.email.toLowerCase());
        if (exists) {
          processErrors.push({ row: i + 2, errors: ['duplicate email — skipped'] });
          continue;
        }
        const uid = newId();
        await execute(db, 'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          uid, row.email.toLowerCase(), await hashPassword(row.password && row.password.length >= 8 ? row.password : randomToken(12)), row.name.slice(0, 120), 'active', now, now);
        await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          newId(), orgId, uid, ['teacher', 'student', 'parent', 'staff'].includes(row.role ?? '') ? (row.role as string) : 'student', now, now);
      } else if (kind === 'enrollments') {
        const stu = await queryFirst<{ id: string }>(db, 'SELECT u.id FROM users u JOIN organization_members om ON om.user_id = u.id WHERE u.email = ? AND om.organization_id = ?', row.student_email.toLowerCase(), orgId);
        const course = await queryFirst<{ id: string }>(db, 'SELECT id FROM courses WHERE code = ? AND organization_id = ? AND deleted_at IS NULL', row.course_code, orgId);
        if (!stu || !course) {
          processErrors.push({ row: i + 2, errors: [!stu ? 'student not found in organization' : 'course not found'] });
          continue;
        }
        await execute(db, 'INSERT OR IGNORE INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), course.id, stu.id, 'active', now, now, now);
      } else if (kind === 'grades') {
        const stu = await queryFirst<{ id: string }>(db, 'SELECT u.id FROM users u JOIN organization_members om ON om.user_id = u.id WHERE u.email = ? AND om.organization_id = ?', row.student_email.toLowerCase(), orgId);
        const course = await queryFirst<{ id: string }>(db, 'SELECT id FROM courses WHERE code = ? AND organization_id = ? AND deleted_at IS NULL', row.course_code, orgId);
        if (!stu || !course) {
          processErrors.push({ row: i + 2, errors: [!stu ? 'student not found in organization' : 'course not found'] });
          continue;
        }
        await execute(db, 'INSERT INTO grades (id, course_id, student_id, category, score, max_score, graded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId(), course.id, stu.id, row.category || 'import', Number(row.score), Number(row.max_score || 100), user.id, now, now);
      } else if (kind === 'attendance') {
        const stu = await queryFirst<{ id: string }>(db, 'SELECT u.id FROM users u JOIN organization_members om ON om.user_id = u.id WHERE u.email = ? AND om.organization_id = ?', row.student_email.toLowerCase(), orgId);
        const sess = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM attendance_sessions WHERE id = ?', row.session_id);
        if (!stu || !sess || sess.organization_id !== orgId) {
          processErrors.push({ row: i + 2, errors: ['student or session not found in organization'] });
          continue;
        }
        await execute(db, 'INSERT INTO attendance_records (id, session_id, student_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status',
          newId(), row.session_id, stu.id, row.status, now, now);
      }
      processed++;
    } catch (e) {
      processErrors.push({ row: i + 2, errors: [e instanceof Error ? e.message : 'Processing failed'] });
    }
  }
  await execute(db, 'UPDATE import_jobs SET status = ?, processed_rows = ?, error_report = ?, updated_at = ? WHERE id = ?',
    processErrors.length > errors.length ? 'partial' : 'done', processed, JSON.stringify({ errors: processErrors }).slice(0, 50000), now, jobId);
  await audit(c, 'import.processed', { entity: 'import_job', entityId: jobId, organizationId: orgId, metadata: { kind, processed, error_count: processErrors.length } });
  return ok(c, { job_id: jobId, processed, total: rawRows.length, errors: processErrors });
});

growth.get('/imports', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !isPrivileged(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT id, kind, status, total_rows, processed_rows, created_at FROM import_jobs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100', orgId);
  return ok(c, rows);
});

growth.get('/imports/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const job = await queryFirst<{ organization_id: string; error_report: string | null }>(c.get('db'), 'SELECT organization_id, error_report FROM import_jobs WHERE id = ?', c.req.param('id'));
  if (!job || !isPrivileged(user, job.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const full = await queryFirst(c.get('db'), 'SELECT * FROM import_jobs WHERE id = ?', c.req.param('id'));
  let report: unknown = null;
  try { report = job.error_report ? JSON.parse(job.error_report) : null; } catch { report = null; }
  return ok(c, { job: full, error_report: report });
});

// ================= Engagement + CSV export =================
growth.get('/reports/engagement', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? '14') || 14));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = c.get('db');
  const byDay = await queryAll<{ day: string; dau: number; actions: number }>(db,
    "SELECT substr(created_at, 1, 10) as day, COUNT(DISTINCT user_id) as dau, COUNT(*) as actions FROM activity_log WHERE organization_id = ? AND created_at >= ? GROUP BY day ORDER BY day ASC", orgId, since);
  const byKind = await queryAll<{ kind: string; n: number }>(db,
    'SELECT kind, COUNT(*) as n FROM activity_log WHERE organization_id = ? AND created_at >= ? GROUP BY kind ORDER BY n DESC LIMIT 20', orgId, since);
  const abandonment = await queryAll<{ course_id: string; title: string; enrolled: number; active_7d: number }>(db,
    `SELECT e.course_id, co.title, COUNT(DISTINCT e.student_id) as enrolled,
     COUNT(DISTINCT CASE WHEN cp.last_activity_at >= ? THEN e.student_id END) as active_7d
     FROM enrollments e JOIN courses co ON co.id = e.course_id
     LEFT JOIN course_progress cp ON cp.course_id = e.course_id AND cp.student_id = e.student_id
     WHERE co.organization_id = ? GROUP BY e.course_id`, new Date(Date.now() - 7 * 86400000).toISOString(), orgId);
  return ok(c, { by_day: byDay, by_kind: byKind, abandonment });
});

growth.get('/reports/export', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const kind = url.searchParams.get('kind');
  const orgId = url.searchParams.get('organization_id');
  const courseId = url.searchParams.get('course_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  let csv = '';
  let filename = 'export.csv';
  if (kind === 'grades' && courseId) {
    const courseOrgId = await courseOrg(db, courseId);
    if (courseOrgId !== orgId) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const rows = await queryAll<{ name: string; email: string; category: string; score: number; max_score: number }>(db,
      'SELECT u.name, u.email, g.category, g.score, g.max_score FROM grades g JOIN users u ON u.id = g.student_id WHERE g.course_id = ? ORDER BY u.name ASC', courseId);
    csv = toCsv(['name', 'email', 'category', 'score', 'max_score'], rows.map((r) => [r.name, r.email, r.category, r.score, r.max_score]));
    filename = 'grades.csv';
  } else if (kind === 'enrollments' && courseId) {
    const courseOrgId = await courseOrg(db, courseId);
    if (courseOrgId !== orgId) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const rows = await queryAll<{ name: string; email: string; status: string; progress_percent: number }>(db,
      'SELECT u.name, u.email, e.status, e.progress_percent FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ?', courseId);
    csv = toCsv(['name', 'email', 'status', 'progress_percent'], rows.map((r) => [r.name, r.email, r.status, r.progress_percent]));
    filename = 'enrollments.csv';
  } else if (kind === 'attendance') {
    const rows = await queryAll<{ session: string; date: string; student: string; status: string }>(db,
      'SELECT s.title as session, s.session_date as date, u.name as student, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id JOIN users u ON u.id = r.student_id WHERE s.organization_id = ? ORDER BY s.session_date DESC LIMIT 2000', orgId);
    csv = toCsv(['session', 'date', 'student', 'status'], rows.map((r) => [r.session, r.date, r.student, r.status]));
    filename = 'attendance.csv';
  } else {
    return fail(c, 400, 'VALIDATION_ERROR', 'kind must be grades|enrollments|attendance (grades/enrollments require course_id)');
  }
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  return c.body(csv, 200);
});

export default growth;

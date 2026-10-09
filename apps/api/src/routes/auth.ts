import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { loginSchema, registerSchema, refreshSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { hashPassword, randomToken, sha256Hex, signAccessToken, verifyPassword } from '../crypto.js';
import { created, fail, ok } from '../respond.js';
import { requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { logActivity } from './growth.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const auth = new Hono<{ Variables: AppVars }>();

const REFRESH_COOKIE = 'lms_refresh';

auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const { email, password, name, organization_id, locale } = parsed.data;
  const db = c.get('db');
  // Registration toggle (setup flow bypasses this endpoint entirely).
  const reg = await queryFirst<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'registration_enabled'");
  if (reg && reg.value === 'false') {
    return fail(c, 403, 'REGISTRATION_DISABLED', 'Registration is currently disabled');
  }
  const existing = await queryFirst(db, 'SELECT id FROM users WHERE email = ?', email.toLowerCase());
  if (existing) return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  const id = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO users (id, email, password_hash, name, status, locale, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, email.toLowerCase(), await hashPassword(password), name, 'active', locale ?? 'en', 'Asia/Jakarta', now, now
  );
  let role = 'student';
  if (organization_id) {
    const org = await queryFirst(db, 'SELECT id FROM organizations WHERE id = ?', organization_id);
    if (!org) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
    await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), organization_id, id, 'student', now, now);
  } else {
    // Auto-create personal org membership? No: assign super_admin only if first user ever.
    const count = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM users');
    if ((count?.n ?? 0) === 1) {
      role = 'super_admin';
      const orgs = await queryAll<{ id: string }>(db, 'SELECT id FROM organizations LIMIT 1');
      if (orgs[0]) {
        await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), orgs[0].id, id, 'super_admin', now, now);
      }
    }
  }
  void role;
  const token = await signAccessToken(c.get('env').JWT_SECRET, id, email.toLowerCase());
  const refresh = randomToken();
  const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
  await execute(db, 'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', newId(), id, await sha256Hex(refresh), exp, now);
  // Email verification loop: token row always created; delivery queued only
  // when a provider is configured (otherwise it stays pending — never faked).
  const verifyToken = randomToken(32);
  await execute(db, 'INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(), id, await sha256Hex(verifyToken), new Date(Date.now() + 24 * 3600_000).toISOString(), now);
  return created(c, { access_token: token, refresh_token: refresh, email_verified: false, user: { id, email: email.toLowerCase(), name } });
});

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const row = await queryFirst<{ id: string; email: string; password_hash: string; name: string; status: string }>(
    db, 'SELECT id, email, password_hash, name, status FROM users WHERE email = ? AND deleted_at IS NULL', parsed.data.email.toLowerCase()
  );
  if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
    return fail(c, 401, 'INVALID_CREDENTIALS', t('invalid_credentials', c.get('lang')));
  }
  if (row.status !== 'active') return fail(c, 403, 'ACCOUNT_INACTIVE', t('inactive_account', c.get('lang')));
  const now = nowIso();
  await execute(db, 'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', now, now, row.id);
  const memberships = await queryAll<{ organization_id: string; role: string }>(db, 'SELECT organization_id, role FROM organization_members WHERE user_id = ?', row.id);
  const token = await signAccessToken(c.get('env').JWT_SECRET, row.id, row.email);
  const refresh = randomToken();
  const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
  await execute(db, 'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', newId(), row.id, await sha256Hex(refresh), exp, now);
  if (c.req.query('cookie') === '1') {
    setCookie(c, REFRESH_COOKIE, refresh, {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400,
      ...(c.get('env').COOKIE_SECURE ? { secure: true } : {}),
    });
  }
  await audit(c, 'auth.login', { entity: 'user', entityId: row.id });
  await logActivity(db, { user_id: row.id, kind: 'auth.login', entity: 'user', entity_id: row.id });
  const verified = await queryFirst(db, 'SELECT id FROM email_verifications WHERE user_id = ? AND verified_at IS NOT NULL LIMIT 1', row.id);
  return ok(c, { access_token: token, refresh_token: refresh, email_verified: !!verified, user: { id: row.id, email: row.email, name: row.name, memberships } });
});

auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null);
  const cookieToken = getCookie(c, REFRESH_COOKIE);
  const candidate = (body as { refresh_token?: string } | null)?.refresh_token ?? cookieToken;
  const parsed = refreshSchema.safeParse({ refresh_token: candidate ?? '' });
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  const db = c.get('db');
  const hash = await sha256Hex(parsed.data.refresh_token);
  const row = await queryFirst<{ id: string; user_id: string; expires_at: string; revoked_at: string | null; replaced_by: string | null }>(
    db, 'SELECT id, user_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = ?', hash
  );
  if (!row) {
    return fail(c, 401, 'INVALID_REFRESH', t('unauthorized', c.get('lang')));
  }
  // Reuse detection: a rotated (replaced) token presented again means the
  // old token was stolen — revoke the whole session family.
  if (row.revoked_at && row.replaced_by) {
    await execute(db, 'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), row.user_id);
    await audit(c, 'auth.reuse_detected', { entity: 'user', entityId: row.user_id });
    return fail(c, 401, 'REUSE_DETECTED', 'Session reuse detected; all sessions revoked. Please log in again.');
  }
  if (row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    return fail(c, 401, 'INVALID_REFRESH', t('unauthorized', c.get('lang')));
  }
  const user = await queryFirst<{ id: string; email: string; status: string }>(db, 'SELECT id, email, status FROM users WHERE id = ? AND deleted_at IS NULL', row.user_id);
  if (!user || user.status !== 'active') return fail(c, 401, 'INVALID_REFRESH', t('unauthorized', c.get('lang')));
  const token = await signAccessToken(c.get('env').JWT_SECRET, user.id, user.email);
  const refresh = randomToken();
  const exp = new Date(Date.now() + 30 * 86400_000).toISOString();
  const replacementId = newId();
  await execute(db, 'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', replacementId, user.id, await sha256Hex(refresh), exp, nowIso());
  await execute(db, 'UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?', nowIso(), replacementId, row.id);
  if (cookieToken || c.req.query('cookie') === '1') {
    setCookie(c, REFRESH_COOKIE, refresh, {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86400,
      ...(c.get('env').COOKIE_SECURE ? { secure: true } : {}),
    });
  }
  return ok(c, { access_token: token, refresh_token: refresh });
});

auth.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rt = (body as { refresh_token?: string })?.refresh_token ?? getCookie(c, REFRESH_COOKIE);
  if (rt) {
    await execute(c.get('db'), 'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?', nowIso(), await sha256Hex(rt));
  }
  deleteCookie(c, REFRESH_COOKIE, { path: '/' });
  await audit(c, 'auth.logout', {});
  return ok(c, { logged_out: true });
});

auth.get('/me', requireAuth(), async (c) => {
  const user = c.get('user');
  return ok(c, { user });
});

// Active refresh sessions for the current user (revocation support).
auth.get('/sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const rows = await queryAll<{ id: string; created_at: string; expires_at: string }>(
    c.get('db'),
    'SELECT id, created_at, expires_at FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
    user.id, nowIso()
  );
  return ok(c, rows);
});

auth.delete('/sessions/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst<{ user_id: string }>(c.get('db'), 'SELECT user_id FROM refresh_tokens WHERE id = ?', c.req.param('id'));
  if (!row) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (row.user_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(c.get('db'), 'UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', nowIso(), c.req.param('id'));
  await audit(c, 'auth.session_revoked', { entity: 'refresh_token', entityId: c.req.param('id') });
  return ok(c, { revoked: true });
});

auth.post('/sessions/revoke-all', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  await execute(c.get('db'), 'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), user.id);
  deleteCookie(c, REFRESH_COOKIE, { path: '/' });
  await audit(c, 'auth.sessions_revoked_all', {});
  return ok(c, { revoked_all: true });
});

auth.post('/password/change', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { current_password?: string; new_password?: string } | null;
  if (!body?.current_password || !body?.new_password || body.new_password.length < 8 || body.new_password.length > 128) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const db = c.get('db');
  const row = await queryFirst<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!row || !(await verifyPassword(body.current_password, row.password_hash))) {
    return fail(c, 401, 'INVALID_CREDENTIALS', t('invalid_credentials', c.get('lang')));
  }
  await execute(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(body.new_password), nowIso(), user.id);
  // Invalidate all other sessions; keep it simple and revoke all.
  await execute(db, 'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), user.id);
  await audit(c, 'auth.password_changed', { entity: 'user', entityId: user.id });
  return ok(c, { changed: true });
});

auth.post('/password/forgot', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = (body as { email?: string } | null)?.email?.toLowerCase();
  if (!email) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const user = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', email);
  // Always return success to avoid account enumeration. Per-account throttle:
  // silently skip creating new tokens beyond 3/hour (response identical).
  if (user) {
    const recent = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM password_resets WHERE user_id = ? AND created_at > ? AND used_at IS NULL', user.id, new Date(Date.now() - 3600_000).toISOString());
    if ((recent?.n ?? 0) < 3) {
      const token = randomToken(32);
      const exp = new Date(Date.now() + 3600_000).toISOString();
      await execute(db, 'INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', newId(), user.id, await sha256Hex(token), exp, nowIso());
    }
  }
  return ok(c, { message: 'If the account exists, a reset link was created.' });
});

auth.post('/password/reset', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: string; password?: string } | null;
  if (!body?.token || !body?.password || body.password.length < 8) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const db = c.get('db');
  const hash = await sha256Hex(body.token);
  const row = await queryFirst<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    db, 'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', hash
  );
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return fail(c, 400, 'INVALID_TOKEN', t('validation_failed', c.get('lang')));
  }
  await execute(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(body.password), nowIso(), row.user_id);
  await execute(db, 'UPDATE password_resets SET used_at = ? WHERE id = ?', nowIso(), row.id);
  return ok(c, { reset: true });
});

auth.get('/verify-status', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const row = await queryFirst<{ verified_at: string | null }>(c.get('db'), 'SELECT verified_at FROM email_verifications WHERE user_id = ? AND verified_at IS NOT NULL LIMIT 1', user.id);
  return ok(c, { email_verified: !!row });
});

// Throttled re-send (same enumeration-safe posture as forgot/reset).
auth.post('/verify-email/request', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const recent = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM email_verifications WHERE user_id = ? AND created_at > ? AND verified_at IS NULL', user.id, new Date(Date.now() - 3600_000).toISOString());
  if ((recent?.n ?? 0) >= 3) {
    return fail(c, 429, 'RATE_LIMITED', t('too_many_requests', c.get('lang')));
  }
  const verifyToken = randomToken(32);
  await execute(db, 'INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(), user.id, await sha256Hex(verifyToken), new Date(Date.now() + 24 * 3600_000).toISOString(), nowIso());
  return ok(c, { requested: true });
});

auth.post('/verify-email', async (c) => {  const body = (await c.req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const hash = await sha256Hex(body.token);
  const row = await queryFirst<{ id: string; user_id: string; expires_at: string; verified_at: string | null }>(
    db, 'SELECT id, user_id, expires_at, verified_at FROM email_verifications WHERE token_hash = ?', hash
  );
  if (!row || row.verified_at || new Date(row.expires_at).getTime() < Date.now()) {
    return fail(c, 400, 'INVALID_TOKEN', t('validation_failed', c.get('lang')));
  }
  await execute(db, 'UPDATE email_verifications SET verified_at = ? WHERE id = ?', nowIso(), row.id);
  return ok(c, { verified: true });
});

export default auth;

import { createMiddleware } from 'hono/factory';
import { verifyAccessToken } from '../crypto.js';
import { queryAll, queryFirst } from '../db.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

export function requestId() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const id = crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });
}

export function language() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const url = new URL(c.req.url);
    const q = url.searchParams.get('lang');
    const h = c.req.header('accept-language');
    const lang = (q === 'id' || q === 'en' ? q : (h ?? '').toLowerCase().startsWith('id') ? 'id' : 'en') as 'en' | 'id';
    c.set('lang', lang);
    await next();
  });
}

// In-memory fallback rate limiter. In production with KV binding, counts are stored in KV.
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const env = c.get('env');
    const max = env.RATE_LIMIT_MAX ?? 120;
    const win = env.RATE_LIMIT_WINDOW_MS ?? 60_000;
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';
    const key = `rl:${ip}:${Math.floor(Date.now() / win)}`;
    if (env.KV) {
      const raw = await env.KV.get(key);
      const count = (raw ? Number(raw) : 0) + 1;
      await env.KV.put(key, String(count), { expirationTtl: Math.ceil(win / 1000) });
      if (count > max) {
        return c.json(
          { success: false, error: { code: 'RATE_LIMITED', message: t('too_many_requests', c.get('lang')) } },
          429
        );
      }
    } else {
      const now = Date.now();
      const b = buckets.get(key);
      if (!b || b.reset < now) buckets.set(key, { count: 1, reset: now + win });
      else {
        b.count += 1;
        if (b.count > max) {
          return c.json(
            { success: false, error: { code: 'RATE_LIMITED', message: t('too_many_requests', c.get('lang')) } },
            429
          );
        }
      }
    }
    await next();
  });
}

export function authOptional() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const header = c.req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7);
      const claims = await verifyAccessToken(c.get('env').JWT_SECRET, token);
      if (claims) {
        const db = c.get('db');
        const row = await queryFirst<{ id: string; email: string; name: string; status: string }>(
          db,
          'SELECT id, email, name, status FROM users WHERE id = ? AND deleted_at IS NULL',
          claims.sub
        );
        if (row) {
          const memberships = await queryAll<{ organization_id: string; role: string }>(
            db,
            'SELECT organization_id, role FROM organization_members WHERE user_id = ?',
            row.id
          );
          const user: AuthUser = {
            id: row.id,
            email: row.email,
            name: row.name,
            status: row.status,
            memberships,
            isSuperAdmin: memberships.some((m) => m.role === 'super_admin'),
          };
          c.set('user', user);
        }
      }
    }
    if (!c.get('user')) c.set('user', null);
    await next();
  });
}

export function requireAuth() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const user = c.get('user') as AuthUser | null;
    if (!user) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: t('unauthorized', c.get('lang')) } }, 401);
    }
    if (user.status !== 'active') {
      return c.json(
        { success: false, error: { code: 'ACCOUNT_INACTIVE', message: t('inactive_account', c.get('lang')) } },
        403
      );
    }
    await next();
  });
}

export function orgRole(user: AuthUser | null, orgId: string): string | null {
  if (!user) return null;
  if (user.isSuperAdmin) return 'super_admin';
  return user.memberships.find((m) => m.organization_id === orgId)?.role ?? null;
}

export function canAccessOrg(user: AuthUser | null, orgId: string): boolean {
  return orgRole(user, orgId) !== null;
}

export function requireOrgRoles(...roles: string[]) {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const user = c.get('user') as AuthUser | null;
    const orgId =
      c.req.param('orgId') ?? c.req.param('id') ?? new URL(c.req.url).searchParams.get('organization_id');
    if (!orgId || !canAccessOrg(user, orgId)) {
      return c.json({ success: false, error: { code: 'TENANT_DENIED', message: t('tenant_denied', c.get('lang')) } }, 403);
    }
    const role = orgRole(user, orgId);
    if (role !== 'super_admin' && !roles.includes(role ?? '')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: t('forbidden', c.get('lang')) } }, 403);
    }
    await next();
  });
}

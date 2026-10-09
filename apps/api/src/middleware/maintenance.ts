import { createMiddleware } from 'hono/factory';
import { queryFirst } from '../db.js';
import type { AppVars, AuthUser } from '../types.js';

// Maintenance mode: when settings.maintenance_mode === 'true', only safe
// reads (GET/HEAD/OPTIONS) and super_admin writes pass; everything else gets
// 503 + Retry-After. Setting cached briefly to avoid a DB read per request.
let cached: { value: boolean; at: number } | null = null;

export function maintenance() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const now = Date.now();
    if (!cached || now - cached.at > 10_000) {
      try {
        const row = await queryFirst<{ value: string }>(
          c.get('db'),
          "SELECT value FROM settings WHERE key = 'maintenance_mode'"
        );
        cached = { value: row?.value === 'true', at: now };
      } catch {
        cached = { value: false, at: now };
      }
    }
    if (!cached.value) {
      await next();
      return;
    }
    const user = c.get('user') as AuthUser | null;
    if (user?.isSuperAdmin) {
      await next();
      return;
    }
    c.header('Retry-After', '300');
    return c.json(
      {
        success: false,
        error: { code: 'MAINTENANCE', message: 'Service temporarily under maintenance' },
      },
      503
    );
  });
}

export function invalidateMaintenanceCache(): void {
  cached = null;
}

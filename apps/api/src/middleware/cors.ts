import { createMiddleware } from 'hono/factory';
import type { AppVars } from '../types.js';

// Configurable CORS. Production must set ALLOWED_ORIGINS (comma-separated).
// Never emits `Access-Control-Allow-Origin: *` together with credentials.
export function cors() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    const env = c.get('env');
    const origin = c.req.header('origin');
    const configured = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const isDevLocalhost =
      origin && /^(http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/.test(origin);

    let allow: string | null = null;
    if (origin && configured.includes(origin)) allow = origin;
    else if (origin && configured.length === 0 && isDevLocalhost) allow = origin;

    if (c.req.method === 'OPTIONS') {
      if (allow) {
        c.header('Access-Control-Allow-Origin', allow);
        c.header('Vary', 'Origin');
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
        c.header('Access-Control-Max-Age', '86400');
      }
      return c.body(null, 204);
    }

    await next();
    if (allow) {
      c.header('Access-Control-Allow-Origin', allow);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Credentials', 'true');
    }
  });
}

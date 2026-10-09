import { createMiddleware } from 'hono/factory';
import type { AppVars } from '../types.js';

// Baseline security headers for API responses. Deliberately no global
// frame-blocking: the SCORM player embeds same-origin content in a sandboxed
// iframe, and that route sets its own stricter sandbox CSP.
export function securityHeaders() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });
}

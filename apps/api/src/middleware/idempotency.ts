import { createMiddleware } from 'hono/factory';
import { newId, nowIso } from '@lms/shared';
import { execute, queryFirst } from '../db.js';
import type { AppVars, AuthUser } from '../types.js';

// Idempotency for safe retries (offline sync, double-submit protection).
// Client sends `Idempotency-Key` (uuid). First response is stored; replays
// with the same key + same user return the stored response instead of
// re-executing. Keys are per-user so one user can never replay another's.
export function idempotency() {
  return createMiddleware<{ Variables: AppVars }>(async (c, next) => {
    if (c.req.method !== 'POST') {
      await next();
      return;
    }
    const key = c.req.header('Idempotency-Key') ?? c.req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 128) {
      await next();
      return;
    }
    const user = c.get('user') as AuthUser | null;
    if (!user) {
      await next();
      return;
    }
    const db = c.get('db');
    const existing = await queryFirst<{ status_code: number; response_body: string }>(
      db,
      'SELECT status_code, response_body FROM idempotency_keys WHERE key = ? AND user_id = ?',
      key,
      user.id
    );
    if (existing) {
      c.header('Idempotent-Replayed', 'true');
      return c.json(JSON.parse(existing.response_body) as unknown as Record<string, unknown>, existing.status_code as 200);
    }
    await next();
    // Capture successful JSON responses for replay.
    const res = c.res.clone();
    if (res.ok) {
      try {
        const body = await res.text();
        await execute(
          db,
          'INSERT OR IGNORE INTO idempotency_keys (key, user_id, endpoint, status_code, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          key,
          user.id,
          new URL(c.req.url).pathname.slice(0, 200),
          res.status,
          body.slice(0, 20000),
          nowIso()
        );
      } catch {
        // Never fail the request because of idempotency bookkeeping.
      }
    }
    void newId;
  });
}

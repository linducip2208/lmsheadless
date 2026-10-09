import type { Context } from 'hono';
import { newId, nowIso } from '@lms/shared';
import { execute } from './db.js';
import type { AppVars, AuthUser } from './types.js';

// Audit logging for important actions. Never logs secrets: metadata is a
// caller-provided safe object (no passwords/tokens).
export async function audit(
  c: Context<{ Variables: AppVars }>,
  action: string,
  opts: {
    entity?: string;
    entityId?: string;
    organizationId?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const user = c.get('user') as AuthUser | null;
  try {
    await execute(
      c.get('db'),
      'INSERT INTO audit_logs (id, actor_id, organization_id, action, entity, entity_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      user?.id ?? null,
      opts.organizationId ?? null,
      action,
      opts.entity ?? null,
      opts.entityId ?? null,
      opts.metadata ? JSON.stringify(opts.metadata).slice(0, 4000) : null,
      c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
      nowIso()
    );
  } catch {
    // Audit must never break the primary action.
  }
}

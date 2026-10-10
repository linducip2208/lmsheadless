import { Hono } from 'hono';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const xapi = new Hono<{ Variables: AppVars }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// xAPI 2.0.0 subset. Actors are always the authenticated user (senders cannot
// forge other learners' statements); org resolved from context or membership.
xapi.post('/xapi/statements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    id?: string;
    actor?: { name?: string; mbox?: string };
    verb?: { id?: string; display?: Record<string, string> };
    object?: { id?: string; definition?: { name?: Record<string, string> } };
    result?: { score?: { scaled?: number; raw?: number }; success?: boolean; completion?: boolean };
    context?: unknown;
    timestamp?: string;
    organization_id?: string;
  } | null;
  if (!body?.verb?.id || !body?.object?.id) {
    return fail(c, 400, 'VALIDATION_ERROR', 'verb.id and object.id are required');
  }
  if (body.id && !UUID_RE.test(body.id)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'statement id must be a UUID');
  }
  if (
    typeof body.verb.id !== 'string' ||
    body.verb.id.length > 500 ||
    typeof body.object.id !== 'string' ||
    body.object.id.length > 2000
  ) {
    return fail(c, 400, 'VALIDATION_ERROR', 'verb/object ids out of range');
  }
  const scaled = body.result?.score?.scaled;
  if (scaled !== undefined && (typeof scaled !== 'number' || scaled < -1 || scaled > 1)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'score.scaled must be between -1 and 1');
  }
  let ts = nowIso();
  if (body.timestamp) {
    const parsed = new Date(body.timestamp).getTime();
    if (!Number.isFinite(parsed)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid timestamp');
    if (parsed > Date.now() + 60000)
      return fail(c, 400, 'VALIDATION_ERROR', 'timestamp cannot be in the future');
    ts = new Date(parsed).toISOString();
  }
  const orgId =
    typeof body.organization_id === 'string'
      ? body.organization_id
      : (user.memberships[0]?.organization_id ?? null);
  if (orgId && !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const db = c.get('db');
  const statementId = body.id ?? crypto.randomUUID();
  // The actor is ALWAYS the authenticated user: client-supplied actor identity
  // is ignored to prevent statement forgery (documented LRS authority rule).
  const now = nowIso();
  try {
    await execute(
      db,
      'INSERT INTO xapi_statements (id, statement_id, organization_id, actor_id, actor_name, verb, object_id, object_name, result_score, result_success, result_completion, context, timestamp, stored_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      statementId,
      orgId,
      user.id,
      user.name.slice(0, 200),
      body.verb.id.slice(0, 500),
      body.object.id.slice(0, 2000),
      (body.object.definition?.name ? JSON.stringify(body.object.definition.name) : null)?.slice(
        0,
        1000
      ) ?? null,
      scaled ?? (typeof body.result?.score?.raw === 'number' ? body.result.score.raw : null),
      body.result?.success === undefined ? null : body.result.success ? 1 : 0,
      body.result?.completion === undefined ? null : body.result.completion ? 1 : 0,
      body.context === undefined ? null : JSON.stringify(body.context).slice(0, 8000),
      ts,
      now,
      now
    );
  } catch {
    // Duplicate statement id → idempotent replay, return the original id.
    const existing = await queryFirst<{ statement_id: string }>(
      db,
      'SELECT statement_id FROM xapi_statements WHERE statement_id = ?',
      statementId
    );
    if (existing) return ok(c, { id: statementId, duplicate: true });
    throw new Error('Statement store failed');
  }
  return created(c, { id: statementId });
});

xapi.get('/xapi/statements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const db = c.get('db');
  const orgId = url.searchParams.get('organization_id');
  const actorId = url.searchParams.get('actor_id');
  const verb = url.searchParams.get('verb');
  const objectId = url.searchParams.get('object_id');
  const since = url.searchParams.get('since');
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20)
  );
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (orgId) {
    if (!canAccessOrg(user, orgId))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const role = orgRole(user, orgId);
    if (role === 'student' || role === 'parent') {
      where.push('actor_id = ?');
      params.push(user.id);
    } else {
      where.push('organization_id = ?');
      params.push(orgId);
    }
  } else {
    // No org scope: users see only their own statements.
    if (!user.isSuperAdmin) {
      where.push('actor_id = ?');
      params.push(user.id);
    }
  }
  if (actorId) {
    // Reading another learner's statements requires a teaching role somewhere shared.
    if (actorId !== user.id && !user.isSuperAdmin) {
      const shared = await queryFirst(
        db,
        'SELECT om.organization_id FROM organization_members om JOIN organization_members om2 ON om2.organization_id = om.organization_id WHERE om.user_id = ? AND om2.user_id = ? LIMIT 1',
        user.id,
        actorId
      );
      if (!shared) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
      const role = orgRole(user, (shared as { organization_id: string }).organization_id);
      if (role === 'student' || role === 'parent')
        return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
    }
    where.push('actor_id = ?');
    params.push(actorId);
  }
  if (verb) {
    where.push('verb = ?');
    params.push(verb.slice(0, 500));
  }
  if (objectId) {
    where.push('object_id = ?');
    params.push(objectId.slice(0, 2000));
  }
  if (since) {
    const ms = new Date(since).getTime();
    if (!Number.isFinite(ms)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid since timestamp');
    where.push('stored_at >= ?');
    params.push(new Date(ms).toISOString());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    (
      await queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) as n FROM xapi_statements ${clause}`,
        ...params
      )
    )?.n ?? 0;
  const rows = await queryAll(
    db,
    `SELECT statement_id as id, actor_name, verb, object_id, object_name, result_score, result_success, result_completion, timestamp, stored_at FROM xapi_statements ${clause} ORDER BY stored_at DESC LIMIT ? OFFSET ?`,
    ...params,
    perPage,
    (page - 1) * perPage
  );
  return ok(c, rows, paginationMeta(total, page, perPage));
});

// Retention purge (org admin; audited with counts, never silent).
xapi.delete('/xapi/statements', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  const before = url.searchParams.get('before');
  if (!orgId || !before)
    return fail(c, 400, 'VALIDATION_ERROR', 'organization_id and before (ISO date) are required');
  if (!canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (!user.isSuperAdmin && role !== 'organization_admin') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const ms = new Date(before).getTime();
  if (!Number.isFinite(ms)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid before timestamp');
  const db = c.get('db');
  const count =
    (
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM xapi_statements WHERE organization_id = ? AND stored_at < ?',
        orgId,
        new Date(ms).toISOString()
      )
    )?.n ?? 0;
  await execute(
    db,
    'DELETE FROM xapi_statements WHERE organization_id = ? AND stored_at < ?',
    orgId,
    new Date(ms).toISOString()
  );
  await audit(c, 'xapi.purged', { organizationId: orgId, metadata: { deleted: count, before } });
  return ok(c, { deleted: count });
});

xapi.get('/xapi/export', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (!user.isSuperAdmin && role !== 'organization_admin' && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  // Paginated export (previously a silent LIMIT 5000 truncation).
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(
    5000,
    Math.max(1, Number(url.searchParams.get('per_page') ?? '1000') || 1000)
  );
  const total =
    (
      await queryFirst<{ n: number }>(
        c.get('db'),
        'SELECT COUNT(*) as n FROM xapi_statements WHERE organization_id = ?',
        orgId
      )
    )?.n ?? 0;
  const rows = await queryAll(
    c.get('db'),
    'SELECT * FROM xapi_statements WHERE organization_id = ? ORDER BY stored_at ASC LIMIT ? OFFSET ?',
    orgId,
    perPage,
    (page - 1) * perPage
  );
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="xapi-statements.json"');
  return c.body(JSON.stringify({ data: rows, meta: { total, page, per_page: perPage } }), 200);
});

export default xapi;

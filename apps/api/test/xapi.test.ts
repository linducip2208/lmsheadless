import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

const VERB = 'http://adlnet.gov/expapi/verbs/completed';
const OBJ = 'https://lms.test/activities/lesson-1';

describe('xAPI LRS', () => {
  it('validates, stores, deduplicates, and scopes statements', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'xapi');
    await mkUser(db, 't@xapi.com', 'teacher', org);
    await mkUser(db, 's@xapi.com', 'student', org);
    await mkUser(db, 's2@xapi.com', 'student', org);
    const tokT = (await login(app, 't@xapi.com')).access_token;
    const tokS = (await login(app, 's@xapi.com')).access_token;
    // Unauthenticated writes rejected.
    const anon = await app.request('/api/v1/xapi/statements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verb: { id: VERB }, object: { id: OBJ } }),
    });
    expect(anon.status).toBe(401);
    // Missing verb/object rejected.
    const bad = await app.request('/api/v1/xapi/statements', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
    // Bad UUID + bad score + future timestamp rejected.
    for (const payload of [
      { id: 'not-a-uuid', verb: { id: VERB }, object: { id: OBJ } },
      { verb: { id: VERB }, object: { id: OBJ }, result: { score: { scaled: 5 } } },
      {
        verb: { id: VERB },
        object: { id: OBJ },
        timestamp: new Date(Date.now() + 3600000).toISOString(),
      },
    ]) {
      const r = await app.request('/api/v1/xapi/statements', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify(payload),
      });
      expect(r.status).toBe(400);
    }
    // Valid statement: actor forced to the authenticated user (no forgery).
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const good = (await (
      await app.request('/api/v1/xapi/statements', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          id,
          actor: { name: 'Mallory', mbox: 'mailto:evil@x.com' },
          verb: { id: VERB },
          object: { id: OBJ },
          result: { success: true, completion: true },
          organization_id: org,
        }),
      })
    ).json()) as { data: { id: string } };
    expect(good.data.id).toBe(id);
    // Duplicate id → idempotent replay.
    const dup = (await (
      await app.request('/api/v1/xapi/statements', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ id, verb: { id: VERB }, object: { id: OBJ }, organization_id: org }),
      })
    ).json()) as { data: { id: string; duplicate: boolean } };
    expect(dup.data.duplicate).toBe(true);
    // Teacher reads org statements; student sees only own.
    const tall = (await (
      await app.request(`/api/v1/xapi/statements?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: unknown[]; meta: { total: number } };
    expect(tall.meta.total).toBe(1);
    const s2tok = (await login(app, 's2@xapi.com')).access_token;
    const s2view = (await (
      await app.request(`/api/v1/xapi/statements?organization_id=${org}`, {
        headers: authHeader(s2tok),
      })
    ).json()) as { data: unknown[] };
    expect(s2view.data.length).toBe(0);
    // Student cannot pull another learner's statements.
    const s2user = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('s2@xapi.com')
      .first<{ id: string }>();
    const s1user = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind('s@xapi.com')
      .first<{ id: string }>();
    const cross = await app.request(`/api/v1/xapi/statements?actor_id=${s1user?.id}`, {
      headers: authHeader(s2tok),
    });
    expect(cross.status).toBe(403);
    // Teacher can filter by actor within an organization scope.
    const byActor = (await (
      await app.request(`/api/v1/xapi/statements?organization_id=${org}&actor_id=${s1user?.id}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: unknown[] };
    expect(byActor.data.length).toBe(1);
    // Forbidden actor forgery in stored row: actor_name is the real user.
    const stored = await db
      .prepare('SELECT actor_name FROM xapi_statements WHERE statement_id = ?')
      .bind(id)
      .first<{ actor_name: string }>();
    expect(stored?.actor_name).not.toBe('Mallory');
    // Export + retention purge (admin only).
    const exp = await app.request(`/api/v1/xapi/export?organization_id=${org}`, {
      headers: authHeader(tokT),
    });
    expect(exp.status).toBe(403);
    const tokA = await login(app, 't@xapi.com').catch(() => null);
    void tokA;
    await mkUser(db, 'adm@xapi.com', 'organization_admin', org);
    const tokAdm = (await login(app, 'adm@xapi.com')).access_token;
    const exp2 = await app.request(`/api/v1/xapi/export?organization_id=${org}`, {
      headers: authHeader(tokAdm),
    });
    expect(exp2.status).toBe(200);
    const purgeDeny = await app.request(
      `/api/v1/xapi/statements?organization_id=${org}&before=${new Date().toISOString()}`,
      { method: 'DELETE', headers: authHeader(tokT) }
    );
    expect(purgeDeny.status).toBe(403);
    const purge = (await (
      await app.request(
        `/api/v1/xapi/statements?organization_id=${org}&before=${new Date(Date.now() + 60000).toISOString()}`,
        { method: 'DELETE', headers: authHeader(tokAdm) }
      )
    ).json()) as { data: { deleted: number } };
    expect(purge.data.deleted).toBe(1);
    void s2user;
  });
});

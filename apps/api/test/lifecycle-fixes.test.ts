import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('AI retention purge + key hygiene', () => {
  it('purges expired conversations, keeps fresh ones, never exposes keys', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ret');
    const t = await mkUser(db, 't@ret.test', 'teacher', org);
    const s = await mkUser(db, 's@ret.test', 'student', org);
    await mkUser(db, 'a@ret.test', 'organization_admin', org);
    const tokS = (await login(app, 's@ret.test')).access_token;
    const tokA = (await login(app, 'a@ret.test')).access_token;
    const tokT = (await login(app, 't@ret.test')).access_token;
    const c = await mkCourse(db, org, t, 'RET1');
    await app.request('/api/v1/ai/config', {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({
        organization_id: org,
        provider: 'mock',
        monthly_limit: 100,
        base_url: 'https://x.test',
        api_key: 'SHOULD-NEVER-LEAK',
      }),
    });
    // Config read must never contain key material.
    const cfg = (await (
      await app.request(`/api/v1/ai/config?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: Record<string, unknown> };
    expect(JSON.stringify(cfg.data)).not.toContain('SHOULD-NEVER-LEAK');
    expect(cfg.data).not.toHaveProperty('api_key_ref');
    // Seed one old and one fresh conversation for the student.
    const oldConv = newId();
    const freshConv = newId();
    const ancient = new Date(Date.now() - 90 * 86400000).toISOString();
    for (const [cid, ts] of [
      [oldConv, ancient],
      [freshConv, nowIso()],
    ] as const) {
      await execute(
        db,
        'INSERT INTO ai_conversations (id, organization_id, user_id, course_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        cid,
        org,
        s,
        c,
        ts,
        ts
      );
      await execute(
        db,
        'INSERT INTO ai_messages (id, conversation_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
        newId(),
        cid,
        'user',
        'hello',
        ts
      );
    }
    // Non-privileged purge denied.
    const deny = await app.request('/api/v1/ai/retention/purge', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ organization_id: org }),
    });
    expect(deny.status).toBe(403);
    const purged = (await (
      await app.request('/api/v1/ai/retention/purge', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org }),
      })
    ).json()) as { data: { messages: number; conversations: number } };
    expect(purged.data.messages).toBe(1);
    expect(purged.data.conversations).toBe(1);
    const remaining = await queryAll<{ id: string }>(db, 'SELECT id FROM ai_conversations');
    expect(remaining.map((r) => r.id)).toEqual([freshConv]);
    void tokT;
  });
});

describe('certificate re-issue after revocation', () => {
  it('re-completion mints a fresh number instead of violating UNIQUE', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'reiss');
    const t = await mkUser(db, 't@reiss.test', 'teacher', org);
    const s = await mkUser(db, 's@reiss.test', 'student', org);
    const tokT = (await login(app, 't@reiss.test')).access_token;
    const tokS = (await login(app, 's@reiss.test')).access_token;
    const c = await mkCourse(db, org, t, 'RE1');
    const sec = (await (
      await app.request(`/api/v1/courses/${c}/sections`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'S' }),
      })
    ).json()) as { data: { id: string } };
    const les = (await (
      await app.request(`/api/v1/courses/sections/${sec.data.id}/lessons`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ title: 'L1', content_type: 'text', body: 'content here yes' }),
      })
    ).json()) as { data: { id: string } };
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c }),
    });
    const complete = () =>
      app.request(`/api/v1/lessons/${les.data.id}/complete`, {
        method: 'POST',
        headers: H(tokS),
      });
    expect((await complete()).status).toBe(200);
    // Revoke via admin API, then complete again (idempotent progress path).
    const issued = (await (
      await app.request(`/api/v1/certificates?student_id=${s}&organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { id: string; certificate_number: string }[] };
    expect(issued.data.length).toBe(1);
    const revoke = await app.request(`/api/v1/certificates/${issued.data[0].id}/revoke`, {
      method: 'POST',
      headers: H(tokT),
    });
    expect(revoke.status).toBe(200);
    expect((await complete()).status).toBe(200);
    const after = (await (
      await app.request(`/api/v1/certificates?student_id=${s}&organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { certificate_number: string }[] };
    // Revoked row retained for audit + one fresh number (no UNIQUE violation).
    expect(after.data.length).toBe(2);
    const numbers = new Set(after.data.map((x) => x.certificate_number));
    expect(numbers.size).toBe(2);
    expect(numbers.has(issued.data[0].certificate_number)).toBe(true);
  });
});

describe('xapi export pagination', () => {
  it('returns paged data with totals instead of silent truncation', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'xpage');
    await mkUser(db, 's@xpage.test', 'student', org);
    await mkUser(db, 'adm@xpage.test', 'organization_admin', org);
    const tokS = (await login(app, 's@xpage.test')).access_token;
    const tokA = (await login(app, 'adm@xpage.test')).access_token;
    for (let i = 0; i < 3; i++) {
      await app.request('/api/v1/xapi/statements', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          id: newId(),
          verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
          object: { id: `https://school.test/lesson/${i}` },
          organization_id: org,
        }),
      });
    }
    const page1 = (await (
      await app.request(`/api/v1/xapi/export?organization_id=${org}&per_page=2&page=1`, {
        headers: authHeader(tokA),
      })
    ).json()) as { data: unknown[]; meta: { total: number; page: number; per_page: number } };
    expect(page1.meta.total).toBe(3);
    expect(page1.data.length).toBe(2);
    const page2 = (await (
      await app.request(`/api/v1/xapi/export?organization_id=${org}&per_page=2&page=2`, {
        headers: authHeader(tokA),
      })
    ).json()) as { data: unknown[]; meta: { total: number } };
    expect(page2.meta.total).toBe(3);
    expect(page2.data.length).toBe(1);
  });
});
